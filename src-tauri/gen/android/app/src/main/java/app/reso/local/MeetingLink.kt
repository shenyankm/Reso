package app.reso.local

import android.util.Base64
import org.json.JSONObject
import java.io.BufferedReader
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Collections

internal class MeetingLink : AutoCloseable {
  private class Host(val listener: ServerSocket, val token: String, var cursor: Int) {
    var motherTurn = false
    var connected = false
    var received = false
    var ended = false

    fun snapshot() = JSONObject()
      .put("cursor", cursor).put("motherTurn", motherTurn && !received)
      .put("connected", connected).put("received", received).put("ended", ended)
  }

  @Volatile private var host: Host? = null
  private val invitation = Regex("""([0-9.]{7,15}):([0-9]{1,5})/([A-Za-z0-9_-]{22})""")

  fun request(input: JSONObject): JSONObject = when (input.getString("action")) {
    "open" -> start(input.getInt("cursor"))
    "publish" -> {
      val active = checkNotNull(host)
      synchronized(active) {
        val cursor = input.getInt("cursor")
        if (cursor > active.cursor) {
          active.cursor = cursor
          active.received = false
        }
        if (cursor == active.cursor) {
          active.ended = input.getBoolean("ended")
          active.motherTurn = input.getBoolean("motherTurn") && !active.ended
        }
        active.snapshot()
      }
    }
    "connect", "poll", "send" -> call(input)
    "close" -> { close(); JSONObject() }
    else -> error("Unknown meeting action")
  }

  @Synchronized private fun start(cursor: Int): JSONObject {
    val address = Collections.list(NetworkInterface.getNetworkInterfaces())
      .filter { it.isUp && !it.isLoopback }
      .sortedByDescending { it.name.startsWith("wlan") }
      .flatMap { Collections.list(it.inetAddresses) }
      .filterIsInstance<Inet4Address>()
      .firstOrNull { it.isSiteLocalAddress } ?: error("Connect to Wi-Fi")
    close()
    val bytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
    val token = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    val active = Host(ServerSocket(0, 4), token, cursor)
    host = active
    Thread {
      while (!active.listener.isClosed) {
        try {
          active.listener.accept().use { socket ->
            socket.soTimeout = 1_200
            val request = JSONObject(readLine(socket.getInputStream().bufferedReader(Charsets.US_ASCII), 128))
            val result = synchronized(active) {
              val authenticated = MessageDigest.isEqual(active.token.toByteArray(), request.optString("token").toByteArray())
              if (!authenticated) JSONObject().put("error", "配对码无效")
              else {
                active.connected = true
                val accepted = request.has("cursor") && !active.ended && active.motherTurn &&
                  request.getInt("cursor") == active.cursor
                if (accepted) active.received = true
                active.snapshot().put("accepted", accepted)
              }
            }
            socket.getOutputStream().write((result.toString() + "\n").toByteArray(Charsets.UTF_8))
          }
        } catch (_: Exception) {
          // A closed listener ends the loop; a disconnected peer can reconnect.
        }
      }
    }.start()
    return JSONObject().put("code", "${address.hostAddress}:${active.listener.localPort}/$token")
  }

  private fun call(input: JSONObject): JSONObject {
    val code = invitation.matchEntire(input.getString("code")) ?: error("配对码格式不正确")
    val (ip, port, token) = code.destructured
    val octets = ip.split('.')
    require(octets.size == 4 && octets.all { it.matches(Regex("""[0-9]{1,3}""")) && it.toInt() in 0..255 })
    val address = InetAddress.getByAddress(octets.map { it.toInt().toByte() }.toByteArray())
    require(address.isSiteLocalAddress && port.toInt() in 1024..65535)
    val request = JSONObject().put("token", token)
    if (input.getString("action") == "send") request.put("cursor", input.getInt("cursor"))
    return Socket().use { socket ->
      socket.connect(InetSocketAddress(address, port.toInt()), 1_200)
      socket.soTimeout = 1_200
      socket.getOutputStream().write((request.toString() + "\n").toByteArray(Charsets.US_ASCII))
      JSONObject(readLine(socket.getInputStream().bufferedReader(Charsets.UTF_8), 512))
    }
  }

  private fun readLine(reader: BufferedReader, limit: Int): String {
    val line = StringBuilder()
    repeat(limit) {
      val next = reader.read()
      if (next == '\n'.code) return line.toString()
      check(next >= 0)
      line.append(next.toChar())
    }
    error("Invalid meeting frame")
  }

  @Synchronized override fun close() {
    host?.listener?.close()
    host = null
  }
}
