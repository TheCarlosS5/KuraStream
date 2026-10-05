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

    @Test
    fun `stale playing snapshot is extrapolated instead of dragging guest back`() {
        // Host wrote t=100 at server time 1_000_000; 10s later the guest correctly sits at ~110.
        val hostEvent = PartySyncEvent(
            currentTime = 100.0f,
            isPlaying = true,
            updatedBy = "host",
            lastSyncTimestampMs = 1_000_000L
        )
        val decision = WatchPartySyncController.evaluateSync(
            hostEvent = hostEvent,
            clientAbsolutePositionSeconds = 110.3f,
            clientIsPlaying = true,
            isClientHost = false,
            nowMs = 1_010_000L
        )
        assertEquals(PartySyncAction.NONE, decision.action)
    }

    @Test
    fun `late joiner seeks to extrapolated host position`() {
        val hostEvent = PartySyncEvent(
            currentTime = 100.0f,
            isPlaying = true,
            updatedBy = "host",
            lastSyncTimestampMs = 1_000_000L
        )
        val decision = WatchPartySyncController.evaluateSync(
            hostEvent = hostEvent,
            clientAbsolutePositionSeconds = 0f,
            clientIsPlaying = false,
            isClientHost = false,
            nowMs = 1_020_000L
        )
        assertEquals(PartySyncAction.SEEK_AND_PLAY, decision.action)
        assertEquals(120.0f, decision.targetPositionSeconds ?: 0f, 0.001f)
    }

    @Test
    fun `device clock skew does not throw the guest ahead`() {
        // Server clock is 2 hours behind the phone: only server-side elapsed time counts.
        val hostEvent = PartySyncEvent(
            currentTime = 100.0f,
            isPlaying = true,
            updatedBy = "host",
            lastSyncTimestampMs = 1_000_000L,
            serverTimeMs = 1_004_000L,
            receivedAtMs = 8_200_000L
        )
        assertEquals(105.0f, WatchPartySyncController.expectedHostPositionSeconds(hostEvent, 8_201_000L), 0.001f)
    }

    @Test
    fun `stale anchor extrapolation is capped`() {
        val hostEvent = PartySyncEvent(
            currentTime = 100.0f,
            isPlaying = true,
            updatedBy = "host",
            lastSyncTimestampMs = 1_000_000L
        )
        val expected = 100f + WatchPartySyncController.MAX_EXTRAPOLATION_SECONDS
        assertEquals(expected, WatchPartySyncController.expectedHostPositionSeconds(hostEvent, 9_000_000L), 0.001f)
    }

    @Test
    fun `paused snapshot is never extrapolated`() {
        val hostEvent = PartySyncEvent(
            currentTime = 42.0f,
            isPlaying = false,
            updatedBy = "host",
            lastSyncTimestampMs = 1_000_000L
        )
        assertEquals(42.0f, WatchPartySyncController.expectedHostPositionSeconds(hostEvent, 9_000_000L), 0.001f)
    }

    @Test
    fun `transcoded tolerance avoids reseek loop while ffmpeg restarts`() {
        val hostEvent = PartySyncEvent(currentTime = 300.0f, isPlaying = true, updatedBy = "host")
        val decision = WatchPartySyncController.evaluateSync(
            hostEvent = hostEvent,
            clientAbsolutePositionSeconds = 297.0f,
            clientIsPlaying = true,
            isClientHost = false,
            driftToleranceSeconds = WatchPartySyncController.TRANSCODED_DRIFT_TOLERANCE_SECONDS
        )
        assertEquals(PartySyncAction.NONE, decision.action)
    }
}
