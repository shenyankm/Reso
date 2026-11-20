package app.reso.local

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.math.roundToInt

class MainActivity : TauriActivity() {
  private val meeting = MeetingLink()
  private val meetingWorker = Executors.newSingleThreadExecutor()
  private var pendingMeetingPermission: Pair<JSONObject, JavaScriptReplyProxy>? = null
  private val localNetworkPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    val (request, reply) = pendingMeetingPermission ?: return@registerForActivityResult
    pendingMeetingPermission = null
    if (granted) runMeeting(request, reply)
    else sendMeetingReply(request, reply, JSONObject().put("error", "请允许本地网络访问后再连接两台手机"))
  }
  private var reminderPermissionReply: JavaScriptReplyProxy? = null
  private val reminderPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
    val reply = reminderPermissionReply
    reminderPermissionReply = null
    reply?.postMessage(if (FollowupReminders.allowed(this)) "allowed" else "denied")
  }

  private data class PendingExport(val bytes: ByteArray, val reply: JavaScriptReplyProxy)
  private var pendingExport: PendingExport? = null
  private val exportFile = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
    val pending = pendingExport
    if (pending != null) {
      if (uri == null) finishExport("cancelled") else Thread {
        val status = try {
          contentResolver.openOutputStream(uri, "wt").use { output ->
            checkNotNull(output).write(pending.bytes)
          }
          "saved"
        } catch (_: Exception) { "error" }
        runOnUiThread { finishExport(status) }
      }.start()
    }
  }

  private fun finishExport(status: String) {
    val pending = pendingExport ?: return
    pendingExport = null
    runCatching { pending.reply.postMessage("{\"status\":\"$status\"}") }
  }

  private fun sendMeetingReply(request: JSONObject, reply: JavaScriptReplyProxy, result: JSONObject) {
    result.put("id", request.optInt("id", -1))
    runOnUiThread { runCatching { reply.postMessage(result.toString()) } }
  }

  private fun runMeeting(request: JSONObject, reply: JavaScriptReplyProxy) {
    meetingWorker.execute {
      val result = runCatching { meeting.request(request) }.getOrElse {
        JSONObject().put("error", "连接未完成，请检查两台设备的 Wi-Fi 和配对码")
      }
      sendMeetingReply(request, reply, result)
    }
  }

  private fun receiveMeeting(request: JSONObject, reply: JavaScriptReplyProxy) {
    val action = request.optString("action")
    val needsNetwork = action != "publish" && action != "close"
    if (needsNetwork && Build.VERSION.SDK_INT >= 37 &&
      checkSelfPermission(Manifest.permission.ACCESS_LOCAL_NETWORK) != PackageManager.PERMISSION_GRANTED) {
      if ((action == "open" || action == "connect") && pendingMeetingPermission == null) {
        pendingMeetingPermission = request to reply
        localNetworkPermission.launch(Manifest.permission.ACCESS_LOCAL_NETWORK)
      } else sendMeetingReply(request, reply, JSONObject().put("error", "请在系统设置中允许访问本地网络"))
    } else runMeeting(request, reply)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, windowInsets ->
      val types = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
      val insets = windowInsets.getInsets(types)
      view.setPadding(insets.left, insets.top, insets.right, insets.bottom)
      WindowInsetsCompat.Builder(windowInsets).setInsets(types, Insets.NONE).build()
    }
    ViewCompat.requestApplyInsets(content)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      if (BuildConfig.APPLICATION_ID == "app.reso.local.roadshow") {
        WebViewCompat.addWebMessageListener(webView, "ResoMeeting", setOf("http://tauri.localhost", "https://tauri.localhost")) { _, message, _, main, reply ->
          val input = message.data?.takeIf { main && it.length <= 1_024 }
          val request = input?.let { runCatching { JSONObject(it) }.getOrNull() }
          if (request != null) runOnUiThread { receiveMeeting(request, reply) }
        }
      }
      // E2E uses a separate origin so it never replaces the user service mapping.
      val exportOrigins = mutableSetOf("http://localhost:5173", "https://openwook.cloud")
      if (BuildConfig.DEBUG) exportOrigins.add("http://127.0.0.1:5189")
      if (BuildConfig.APPLICATION_ID != "app.reso.local.roadshow") {
        WebViewCompat.addWebMessageListener(webView, "ResoReminders", exportOrigins) { _, message, _, main, reply ->
          val input = message.data?.takeIf { main && it.length <= 16_384 }
          val request = input?.let { runCatching { JSONObject(it) }.getOrNull() }
          if (request != null) runOnUiThread {
            when (request.optString("action")) {
              "permission" -> when {
                FollowupReminders.allowed(this) -> reply.postMessage("allowed")
                Build.VERSION.SDK_INT >= 33 && reminderPermissionReply == null -> {
                  reminderPermissionReply = reply
                  reminderPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
                else -> reply.postMessage("denied")
              }
              "sync" -> runCatching {
                FollowupReminders.sync(this, request.getString("account"), request.getJSONArray("entries"))
              }
            }
          }
        }
      }
      WebViewCompat.addWebMessageListener(webView, "ResoExport", exportOrigins) { _, message, _, isMainFrame, reply ->
        if (!isMainFrame || pendingExport != null) {
          reply.postMessage("{\"status\":\"error\"}")
        } else try {
          val text = checkNotNull(message.data)
          if (text.length > 8 * 1024 * 1024) {
            reply.postMessage("{\"status\":\"too_large\"}")
          } else {
            val bytes = text.toByteArray(Charsets.UTF_8)
            if (bytes.size > 8 * 1024 * 1024) reply.postMessage("{\"status\":\"too_large\"}") else {
              UUID.fromString(JSONObject(text).getJSONObject("event").getString("id"))
              pendingExport = PendingExport(bytes, reply)
              exportFile.launch("reso-event.json")
            }
          }
        } catch (_: Exception) {
          pendingExport = null
          reply.postMessage("{\"status\":\"error\"}")
        }
      }
    }
    webView.settings.textZoom = (resources.configuration.fontScale * 100).roundToInt()
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript("(() => { const event = new Event('reso-back', {cancelable:true}); window.dispatchEvent(event); return event.defaultPrevented; })()") { handled ->
          if (handled != "true") moveTaskToBack(true)
        }
      }
    })
  }

  override fun onDestroy() {
    meetingWorker.shutdownNow()
    meeting.close()
    super.onDestroy()
  }
}
