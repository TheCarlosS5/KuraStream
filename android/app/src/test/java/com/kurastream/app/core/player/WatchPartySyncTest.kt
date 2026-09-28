package com.kurastream.app.core.player

import com.kurastream.app.core.model.PartySyncEvent
import org.junit.Assert.*
import org.junit.Test

class WatchPartySyncTest {

    @Test
    fun `drift under tolerance causes no seek`() {
        val hostEvent = PartySyncEvent(currentTime = 120.0f, isPlaying = true, updatedBy = "host")
        val decision = WatchPartySyncController.evaluateSync(
            hostEvent = hostEvent,
            clientAbsolutePositionSeconds = 120.8f, // 0.8s difference
            clientIsPlaying = true,
            isClientHost = false
        )
        assertEquals(PartySyncAction.NONE, decision.action)
    }

    @Test
    fun `drift over tolerance triggers seek and play when host is playing`() {
        val hostEvent = PartySyncEvent(currentTime = 150.0f, isPlaying = true, updatedBy = "host")
        val decision = WatchPartySyncController.evaluateSync(
            hostEvent = hostEvent,
            clientAbsolutePositionSeconds = 120.0f, // 30s difference
            clientIsPlaying = true,
            isClientHost = false
        )
        assertEquals(PartySyncAction.SEEK_AND_PLAY, decision.action)
        assertEquals(150.0f, decision.targetPositionSeconds ?: 0f, 0.001f)
    }

    @Test
    fun `drift over tolerance triggers seek and pause when host is paused`() {
        val hostEvent = PartySyncEvent(currentTime = 200.0f, isPlaying = false, updatedBy = "host")
        val decision = WatchPartySyncController.evaluateSync(
            hostEvent = hostEvent,
            clientAbsolutePositionSeconds = 100.0f,
            clientIsPlaying = false,
            isClientHost = false
        )
        assertEquals(PartySyncAction.SEEK_AND_PAUSE, decision.action)
        assertEquals(200.0f, decision.targetPositionSeconds ?: 0f, 0.001f)
    }

    @Test
    fun `state mismatch with host paused triggers pause`() {
        val hostEvent = PartySyncEvent(currentTime = 50.0f, isPlaying = false, updatedBy = "host")
        val decision = WatchPartySyncController.evaluateSync(
            hostEvent = hostEvent,
            clientAbsolutePositionSeconds = 50.2f, // within drift tolerance
            clientIsPlaying = true,
            isClientHost = false
        )
        assertEquals(PartySyncAction.PAUSE, decision.action)
    }

    @Test
    fun `state mismatch with host playing triggers play`() {
        val hostEvent = PartySyncEvent(currentTime = 50.0f, isPlaying = true, updatedBy = "host")
        val decision = WatchPartySyncController.evaluateSync(
            hostEvent = hostEvent,
            clientAbsolutePositionSeconds = 50.2f, // within drift tolerance
            clientIsPlaying = false,
            isClientHost = false
        )
        assertEquals(PartySyncAction.PLAY, decision.action)
    }

    @Test
    fun `host does not apply remote sync to self`() {
        val hostEvent = PartySyncEvent(currentTime = 300.0f, isPlaying = true, updatedBy = "me")
        val decision = WatchPartySyncController.evaluateSync(
            hostEvent = hostEvent,
            clientAbsolutePositionSeconds = 10.0f,
            clientIsPlaying = false,
            isClientHost = true
        )
        assertEquals(PartySyncAction.NONE, decision.action)
    }
}
