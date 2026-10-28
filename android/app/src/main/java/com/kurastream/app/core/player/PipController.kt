package com.kurastream.app.core.player

import android.app.Activity
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Rational

/**
 * Picture-in-picture helpers: the window's own buttons (back 10 s, play/pause, forward 10 s) and the
 * "leave the app while playing" entry for Android 8-11 (Android 12+ uses setAutoEnterEnabled instead).
 */
object PipController {
    const val ACTION_BACK = "com.kurastream.app.pip.BACK"
    const val ACTION_TOGGLE = "com.kurastream.app.pip.TOGGLE"
    const val ACTION_FORWARD = "com.kurastream.app.pip.FORWARD"

    /** True while the player screen is on top and something is playing: leaving the app should open the PiP window. */
    @Volatile
    var armed: Boolean = false

    @Volatile
    private var lastIsPlaying: Boolean = false

    fun Activity.pipSupported(): Boolean =
        packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    fun buildParams(context: Context, isPlaying: Boolean, autoEnter: Boolean): PictureInPictureParams {
        lastIsPlaying = isPlaying
        val builder = PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9))
        builder.setActions(
            listOf(
                action(context, "Retroceder 10 segundos", android.R.drawable.ic_media_rew, ACTION_BACK, 1),
                if (isPlaying) action(context, "Pausar", android.R.drawable.ic_media_pause, ACTION_TOGGLE, 2)
                else action(context, "Reproducir", android.R.drawable.ic_media_play, ACTION_TOGGLE, 2),
                action(context, "Avanzar 10 segundos", android.R.drawable.ic_media_ff, ACTION_FORWARD, 3)
            )
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) builder.setAutoEnterEnabled(autoEnter)
        return builder.build()
    }

    private fun action(context: Context, title: String, icon: Int, action: String, requestCode: Int): RemoteAction {
        val intent = PendingIntent.getBroadcast(
            context, requestCode,
            Intent(action).setPackage(context.packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return RemoteAction(Icon.createWithResource(context, icon), title, title, intent)
    }

    /** Called from Activity.onUserLeaveHint: Android 8-11 do not enter PiP by themselves. */
    fun enterIfArmed(activity: Activity) {
        if (!armed || Build.VERSION.SDK_INT >= Build.VERSION_CODES.S || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        if (!activity.pipSupported()) return
        try {
            activity.enterPictureInPictureMode(buildParams(activity, lastIsPlaying, false))
        } catch (_: IllegalStateException) {
            // The activity is not in a state that allows it (for example already finishing)
        }
    }
}
