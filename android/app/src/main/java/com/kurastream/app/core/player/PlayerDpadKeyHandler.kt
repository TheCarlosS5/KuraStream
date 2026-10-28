package com.kurastream.app.core.player

sealed interface PlayerKeyAction {
    data object ShowControls : PlayerKeyAction
    data class Seek(val forward: Boolean) : PlayerKeyAction
    data object ResetAutoHide : PlayerKeyAction
    data object CloseOverlay : PlayerKeyAction
    data object HideControls : PlayerKeyAction
    data object TogglePlayPause : PlayerKeyAction
    data object Play : PlayerKeyAction
    data object Pause : PlayerKeyAction
    data object Exit : PlayerKeyAction
    data object None : PlayerKeyAction
}

object PlayerDpadKeyHandler {

    // Key codes matching android.view.KeyEvent constants for pure JVM testing
    const val KEYCODE_BACK = 4
    const val KEYCODE_DPAD_UP = 19
    const val KEYCODE_DPAD_DOWN = 20
    const val KEYCODE_DPAD_LEFT = 21
    const val KEYCODE_DPAD_RIGHT = 22
    const val KEYCODE_DPAD_CENTER = 23
    const val KEYCODE_SPACE = 62
    const val KEYCODE_ENTER = 66
    const val KEYCODE_MEDIA_PLAY_PAUSE = 85
    const val KEYCODE_MEDIA_PLAY = 126
    const val KEYCODE_MEDIA_PAUSE = 127
    const val KEYCODE_NUMPAD_ENTER = 160

    fun mapKeyEvent(
        keyCode: Int,
        isKeyDown: Boolean,
        controlsVisible: Boolean,
        hasActiveOverlay: Boolean
    ): PlayerKeyAction {
        if (!isKeyDown) return PlayerKeyAction.None

        // Back key behavior: overlay -> hide controls -> exit
        if (keyCode == KEYCODE_BACK) {
            return when {
                hasActiveOverlay -> PlayerKeyAction.CloseOverlay
                controlsVisible -> PlayerKeyAction.HideControls
                else -> PlayerKeyAction.Exit
            }
        }

        // If an overlay is active, let it handle key navigation, but reset auto-hide
        if (hasActiveOverlay) {
            return PlayerKeyAction.ResetAutoHide
        }

        // When controls are visible:
        // Any key press resets auto-hide countdown; navigation/activation is handled by Compose focus
        if (controlsVisible) {
            return PlayerKeyAction.ResetAutoHide
        }

        // When controls are hidden:
        return when (keyCode) {
            KEYCODE_DPAD_CENTER, KEYCODE_ENTER, KEYCODE_NUMPAD_ENTER -> PlayerKeyAction.ShowControls
            KEYCODE_DPAD_LEFT -> PlayerKeyAction.Seek(forward = false)
            KEYCODE_DPAD_RIGHT -> PlayerKeyAction.Seek(forward = true)
            KEYCODE_MEDIA_PLAY -> PlayerKeyAction.Play
            KEYCODE_MEDIA_PAUSE -> PlayerKeyAction.Pause
            KEYCODE_MEDIA_PLAY_PAUSE, KEYCODE_SPACE -> PlayerKeyAction.TogglePlayPause
            KEYCODE_DPAD_UP, KEYCODE_DPAD_DOWN -> PlayerKeyAction.ShowControls
            else -> PlayerKeyAction.None
        }
    }

    /**
     * Indicates whether the key event should be consumed (not passed to child focus system)
     * by the player root container.
     */
    fun shouldConsume(action: PlayerKeyAction): Boolean {
        return when (action) {
            is PlayerKeyAction.ShowControls,
            is PlayerKeyAction.Seek,
            is PlayerKeyAction.CloseOverlay,
            is PlayerKeyAction.HideControls,
            is PlayerKeyAction.TogglePlayPause,
            is PlayerKeyAction.Play,
            is PlayerKeyAction.Pause -> true

            is PlayerKeyAction.ResetAutoHide,
            is PlayerKeyAction.Exit,
            is PlayerKeyAction.None -> false
        }
    }
}
