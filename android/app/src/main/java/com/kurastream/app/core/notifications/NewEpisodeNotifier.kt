package com.kurastream.app.core.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.kurastream.app.MainActivity
import com.kurastream.app.R
import com.kurastream.app.core.network.dto.NotificationItemDto

/**
 * Local notifications for new episodes. No Firebase and no internet: [NewEpisodeWorker] asks the user's own server
 * now and then and this shows what it found. A notification is shown once per item (tracked by id).
 */
class NewEpisodeNotifier(private val context: Context) {

    private val prefs = context.getSharedPreferences("kura_notifications", Context.MODE_PRIVATE)

    private fun canPost(): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Notifies the unread items not announced before (at most [MAX_PER_RUN], newest first). Returns how many. */
    fun notifyNew(items: List<NotificationItemDto>): Int {
        if (!canPost()) return 0
        val seen = prefs.getStringSet(KEY_SEEN, emptySet()).orEmpty()
        val fresh = items.filter { it.isUnread && it.id !in seen }.take(MAX_PER_RUN)
        if (fresh.isEmpty()) return 0

        ensureChannel()
        val manager = NotificationManagerCompat.from(context)
        fresh.forEach { item ->
            val target = when {
                !item.episodeId.isNullOrBlank() -> "kurastream://episode/${Uri.encode(item.episodeId)}"
                !item.showId.isNullOrBlank() -> "kurastream://show/${Uri.encode(item.showId)}"
                else -> null
            }
            val intent = Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                target?.let { data = Uri.parse(it) }
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pending = PendingIntent.getActivity(
                context, item.id.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_kurastream_logo)
                .setContentTitle(item.title.ifBlank { "KuraStream" })
                .setContentText(item.message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(item.message))
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build()
            try {
                manager.notify(item.id.hashCode(), notification)
            } catch (_: SecurityException) {
                return@forEach   // permission revoked between the check and the call
            }
        }
        // Remember every unread id, announced or not, so a backlog is not replayed a few at a time
        prefs.edit().putStringSet(KEY_SEEN, (seen + items.filter { it.isUnread }.map { it.id }).toList().takeLast(MAX_REMEMBERED).toSet()).apply()
        return fresh.size
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Episodios nuevos", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Avisos cuando tu servidor añade episodios de lo que sigues"
                }
            )
        }
    }

    companion object {
        const val CHANNEL_ID = "new_episodes"
        private const val KEY_SEEN = "seen_ids"
        private const val MAX_PER_RUN = 5
        private const val MAX_REMEMBERED = 200
    }
}
