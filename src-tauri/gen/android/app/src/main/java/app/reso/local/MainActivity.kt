package app.reso.local

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
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.math.roundToInt

class MainActivity : TauriActivity() {
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
      // E2E uses a separate origin so it never replaces the user service mapping.
      val exportOrigins = mutableSetOf("http://localhost:5173", "https://openwook.cloud")
      if (BuildConfig.DEBUG) exportOrigins.add("http://127.0.0.1:5189")
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
}
