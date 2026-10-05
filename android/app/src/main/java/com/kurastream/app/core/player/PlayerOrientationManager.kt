package com.kurastream.app.core.player

import android.app.Activity
import android.content.pm.ActivityInfo
import android.view.View
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Manages screen orientation and system bars for the player.
 * Only the first player screen saves the pre-player orientation;
 * subsequent "next episode" navigations keep landscape mode active.
 * Orientation is restored only when the reference count drops to zero (user leaves the player entirely).
 */
object PlayerOrientationManager {
    private var activePlayerCount = 0
    private var savedOrientation: Int = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED

    fun enterPlayer(activity: Activity?, view: View?) {
        if (activePlayerCount == 0) {
            // First player screen: save the current orientation
            savedOrientation = activity?.requestedOrientation ?: ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
        activePlayerCount++

        // Force landscape and hide system bars
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        val window = activity?.window
        if (window != null && view != null) {
            val controller = WindowCompat.getInsetsController(window, view)
            controller.hide(WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    fun exitPlayer(activity: Activity?, view: View?) {
        activePlayerCount = (activePlayerCount - 1).coerceAtLeast(0)

        if (activePlayerCount == 0) {
            // Last player screen is disposing: restore the original orientation and system bars
            activity?.requestedOrientation = savedOrientation
            val window = activity?.window
            if (window != null && view != null) {
                val controller = WindowCompat.getInsetsController(window, view)
                controller.show(WindowInsetsCompat.Type.systemBars())
            }
            savedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }
}
