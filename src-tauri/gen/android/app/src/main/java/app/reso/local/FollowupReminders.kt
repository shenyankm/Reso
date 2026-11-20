package app.reso.local

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class FollowupReminders : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    arm(context)
  }

  companion object {
    private const val channelId = "followup-reminders"
    private const val notificationId = 3301

    private fun preferences(context: Context) =
      context.getSharedPreferences("reso_followup_reminders", Context.MODE_PRIVATE)

    fun allowed(context: Context): Boolean {
      val manager = context.getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= 26) {
        manager.createNotificationChannel(
          NotificationChannel(channelId, "Reso 回访提醒", NotificationManager.IMPORTANCE_DEFAULT)
        )
        if (manager.getNotificationChannel(channelId).importance == NotificationManager.IMPORTANCE_NONE) return false
      }
      return manager.areNotificationsEnabled() &&
        (Build.VERSION.SDK_INT < 33 ||
          context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
    }

    fun sync(context: Context, account: String, entries: JSONArray) {
      require(entries.length() <= 100 && account.length <= 128)
      val prefs = preferences(context)
      val sameAccount = prefs.getString("account", "") == account
      val delivered = if (sameAccount) prefs.getStringSet("delivered", emptySet()).orEmpty() else emptySet()
      val reminders = JSONArray()
      val ids = mutableSetOf<String>()
      if (account.isNotBlank()) for (i in 0 until entries.length()) {
        val item = entries.getJSONObject(i)
        val id = UUID.fromString(item.getString("id")).toString()
        val at = item.getLong("at")
        if (at in 1..253402300799999L && ids.add(id)) {
          reminders.put(JSONObject().put("id", id).put("at", at))
        }
      }
      prefs.edit().putString("account", account).putString("entries", reminders.toString())
        .putStringSet("delivered", delivered.intersect(ids)).apply()
      if (!sameAccount || ids.isEmpty()) {
        context.getSystemService(NotificationManager::class.java).cancel(notificationId)
      }
      arm(context)
    }

    private fun arm(context: Context) {
      val alarm = context.getSystemService(AlarmManager::class.java)
      val token = PendingIntent.getBroadcast(context, 0, Intent(context, FollowupReminders::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      alarm.cancel(token)
      val prefs = preferences(context)
      if (prefs.getString("account", "").isNullOrBlank() || !allowed(context)) return

      val delivered = prefs.getStringSet("delivered", emptySet()).orEmpty().toMutableSet()
      val entries = JSONArray(prefs.getString("entries", "[]"))
      val now = System.currentTimeMillis()
      var next = Long.MAX_VALUE
      val due = mutableListOf<String>()
      for (i in 0 until entries.length()) {
        val entry = entries.getJSONObject(i)
        val id = entry.getString("id")
        val at = entry.getLong("at")
        if (id in delivered) continue
        if (at <= now) due += id else next = minOf(next, at)
      }
      if (due.isNotEmpty()) {
        val launch = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java),
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, channelId)
          .setSmallIcon(android.R.drawable.ic_dialog_info)
          .setContentTitle("Reso 回访提醒")
          .setContentText("可以打开 Reso，回看你留下的记录。")
          .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
          .setAutoCancel(true)
          .setContentIntent(launch).build()
        context.getSystemService(NotificationManager::class.java).notify(notificationId, notification)
        delivered.addAll(due)
        prefs.edit().putStringSet("delivered", delivered).apply()
      }
      // Android may batch reminders under battery restrictions.
      if (next != Long.MAX_VALUE) alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, token)
    }
  }
}
