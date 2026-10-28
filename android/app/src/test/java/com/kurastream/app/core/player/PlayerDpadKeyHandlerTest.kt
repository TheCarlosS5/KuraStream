package com.kurastream.app.core.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayerDpadKeyHandlerTest {

    @Test
    fun `key up events are ignored`() {
        val action = PlayerDpadKeyHandler.mapKeyEvent(
            keyCode = PlayerDpadKeyHandler.KEYCODE_DPAD_CENTER,
            isKeyDown = false,
            controlsVisible = false,
            hasActiveOverlay = false
        )
        assertEquals(PlayerKeyAction.None, action)
        assertFalse(PlayerDpadKeyHandler.shouldConsume(action))
    }

    @Test
    fun `with controls hidden center and enter show controls`() {
        val centerAction = PlayerDpadKeyHandler.mapKeyEvent(
            keyCode = PlayerDpadKeyHandler.KEYCODE_DPAD_CENTER,
            isKeyDown = true,
            controlsVisible = false,
            hasActiveOverlay = false
        )
        assertEquals(PlayerKeyAction.ShowControls, centerAction)
        assertTrue(PlayerDpadKeyHandler.shouldConsume(centerAction))

        val enterAction = PlayerDpadKeyHandler.mapKeyEvent(
            keyCode = PlayerDpadKeyHandler.KEYCODE_ENTER,
            isKeyDown = true,
            controlsVisible = false,
            hasActiveOverlay = false
        )
        assertEquals(PlayerKeyAction.ShowControls, enterAction)
        assertTrue(PlayerDpadKeyHandler.shouldConsume(enterAction))
    }

    @Test
    fun `with controls hidden left and right seek backward and forward`() {
        val leftAction = PlayerDpadKeyHandler.mapKeyEvent(
            keyCode = PlayerDpadKeyHandler.KEYCODE_DPAD_LEFT,
            isKeyDown = true,
            controlsVisible = false,
            hasActiveOverlay = false
        )
        assertEquals(PlayerKeyAction.Seek(forward = false), leftAction)
        assertTrue(PlayerDpadKeyHandler.shouldConsume(leftAction))

        val rightAction = PlayerDpadKeyHandler.mapKeyEvent(
            keyCode = PlayerDpadKeyHandler.KEYCODE_DPAD_RIGHT,
            isKeyDown = true,
            controlsVisible = false,
            hasActiveOverlay = false
        )
        assertEquals(PlayerKeyAction.Seek(forward = true), rightAction)
        assertTrue(PlayerDpadKeyHandler.shouldConsume(rightAction))
    }

    @Test
    fun `with controls hidden space and media play pause toggle playback`() {
        val spaceAction = PlayerDpadKeyHandler.mapKeyEvent(
            keyCode = PlayerDpadKeyHandler.KEYCODE_SPACE,
            isKeyDown = true,
            controlsVisible = false,
            hasActiveOverlay = false
        )
        assertEquals(PlayerKeyAction.TogglePlayPause, spaceAction)
        assertTrue(PlayerDpadKeyHandler.shouldConsume(spaceAction))

        val playPauseAction = PlayerDpadKeyHandler.mapKeyEvent(
            keyCode = PlayerDpadKeyHandler.KEYCODE_MEDIA_PLAY_PAUSE,
            isKeyDown = true,
            controlsVisible = false,
            hasActiveOverlay = false
        )
        assertEquals(PlayerKeyAction.TogglePlayPause, playPauseAction)
        assertTrue(PlayerDpadKeyHandler.shouldConsume(playPauseAction))
    }

    @Test
    fun `with controls hidden media play produces play action`() {
        val playAction = PlayerDpadKeyHandler.mapKeyEvent(
            keyCode = PlayerDpadKeyHandler.KEYCODE_MEDIA_PLAY,
            isKeyDown = true,
            controlsVisible = false,
            hasActiveOverlay = false
        )
        assertEquals(PlayerKeyAction.Play, playAction)
        assertTrue(PlayerDpadKeyHandler.shouldConsume(playAction))
    }

    @Test
    fun `with controls hidden media pause produces pause action`() {
        val pauseAction = PlayerDpadKeyHandler.mapKeyEvent(
            keyCode = PlayerDpadKeyHandler.KEYCODE_MEDIA_PAUSE,
            isKeyDown = true,
            controlsVisible = false,
            hasActiveOverlay = false
        )
        assertEquals(PlayerKeyAction.Pause, pauseAction)
        assertTrue(PlayerDpadKeyHandler.shouldConsume(pauseAction))
    }

    @Test
    fun `with controls visible navigation keys reset auto hide without consuming`() {
        val keys = listOf(
            PlayerDpadKeyHandler.KEYCODE_DPAD_UP,
            PlayerDpadKeyHandler.KEYCODE_DPAD_DOWN,
            PlayerDpadKeyHandler.KEYCODE_DPAD_LEFT,
            PlayerDpadKeyHandler.KEYCODE_DPAD_RIGHT,
            PlayerDpadKeyHandler.KEYCODE_DPAD_CENTER,
            PlayerDpadKeyHandler.KEYCODE_ENTER
        )

        for (key in keys) {
            val action = PlayerDpadKeyHandler.mapKeyEvent(
                keyCode = key,
                isKeyDown = true,
                controlsVisible = true,
                hasActiveOverlay = false
            )
            assertEquals(PlayerKeyAction.ResetAutoHide, action)
            assertFalse(PlayerDpadKeyHandler.shouldConsume(action))
        }
    }

    @Test
    fun `with controls visible and no overlay back hides controls`() {
        val action = PlayerDpadKeyHandler.mapKeyEvent(
            keyCode = PlayerDpadKeyHandler.KEYCODE_BACK,
            isKeyDown = true,
            controlsVisible = true,
            hasActiveOverlay = false
        )
        assertEquals(PlayerKeyAction.HideControls, action)
        assertTrue(PlayerDpadKeyHandler.shouldConsume(action))
    }

    @Test
    fun `with active overlay back closes overlay first`() {
        val action = PlayerDpadKeyHandler.mapKeyEvent(
            keyCode = PlayerDpadKeyHandler.KEYCODE_BACK,
            isKeyDown = true,
            controlsVisible = true,
            hasActiveOverlay = true
        )
        assertEquals(PlayerKeyAction.CloseOverlay, action)
        assertTrue(PlayerDpadKeyHandler.shouldConsume(action))
    }

    @Test
    fun `with controls hidden and no overlay back exits`() {
        val action = PlayerDpadKeyHandler.mapKeyEvent(
            keyCode = PlayerDpadKeyHandler.KEYCODE_BACK,
            isKeyDown = true,
            controlsVisible = false,
            hasActiveOverlay = false
        )
        assertEquals(PlayerKeyAction.Exit, action)
        assertFalse(PlayerDpadKeyHandler.shouldConsume(action))
    }
}
