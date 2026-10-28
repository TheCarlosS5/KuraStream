package com.kurastream.app.core.player

import com.kurastream.app.core.model.PartySyncEvent
import com.kurastream.app.core.repository.ActivePartySession
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

    @Test
    fun `stale or equal sync timestamps are discarded`() {
        // Equal timestamp to last seen is discarded
        assertTrue(WatchPartySyncController.shouldDiscardSync(1000L, 1000L))
        // Older timestamp than last seen is discarded
        assertTrue(WatchPartySyncController.shouldDiscardSync(900L, 1000L))
        // Newer timestamp is not discarded
        assertFalse(WatchPartySyncController.shouldDiscardSync(1001L, 1000L))
        // Zero timestamps (initial or absent) are not discarded
        assertFalse(WatchPartySyncController.shouldDiscardSync(0L, 1000L))
        assertFalse(WatchPartySyncController.shouldDiscardSync(1000L, 0L))
    }

    @Test
    fun `host applies sync when guest controls allowed and event is from guest with newer timestamp`() {
        val shouldApply = WatchPartySyncController.shouldHostApplyGuestSync(
            allowGuestControls = true,
            lastSyncMember = "guest-123",
            ownMemberId = "host-456",
            incomingTimestampMs = 2000L,
            lastAppliedTimestampMs = 1000L
        )
        assertTrue(shouldApply)
    }

    @Test
    fun `host ignores guest sync when guest controls are disabled`() {
        val shouldApply = WatchPartySyncController.shouldHostApplyGuestSync(
            allowGuestControls = false,
            lastSyncMember = "guest-123",
            ownMemberId = "host-456",
            incomingTimestampMs = 2000L,
            lastAppliedTimestampMs = 1000L
        )
        assertFalse(shouldApply)
    }

    @Test
    fun `host ignores sync when last sync member is empty or null`() {
        assertFalse(
            WatchPartySyncController.shouldHostApplyGuestSync(
                allowGuestControls = true,
                lastSyncMember = null,
                ownMemberId = "host-456",
                incomingTimestampMs = 2000L,
                lastAppliedTimestampMs = 1000L
            )
        )
        assertFalse(
            WatchPartySyncController.shouldHostApplyGuestSync(
                allowGuestControls = true,
                lastSyncMember = "",
                ownMemberId = "host-456",
                incomingTimestampMs = 2000L,
                lastAppliedTimestampMs = 1000L
            )
        )
    }

    @Test
    fun `host ignores sync originating from host itself`() {
        val shouldApply = WatchPartySyncController.shouldHostApplyGuestSync(
            allowGuestControls = true,
            lastSyncMember = "host-456",
            ownMemberId = "host-456",
            incomingTimestampMs = 2000L,
            lastAppliedTimestampMs = 1000L
        )
        assertFalse(shouldApply)
    }

    @Test
    fun `host ignores guest sync if timestamp is older or equal to last applied`() {
        assertFalse(
            WatchPartySyncController.shouldHostApplyGuestSync(
                allowGuestControls = true,
                lastSyncMember = "guest-123",
                ownMemberId = "host-456",
                incomingTimestampMs = 1000L,
                lastAppliedTimestampMs = 1000L
            )
        )
        assertFalse(
            WatchPartySyncController.shouldHostApplyGuestSync(
                allowGuestControls = true,
                lastSyncMember = "guest-123",
                ownMemberId = "host-456",
                incomingTimestampMs = 999L,
                lastAppliedTimestampMs = 1000L
            )
        )
    }

    @Test
    fun `host applies guest sync when incoming timestamp is newer than last applied even if seen earlier`() {
        // If an earlier attempt was received but not yet applied, a newer applied check permits execution
        val shouldApply = WatchPartySyncController.shouldHostApplyGuestSync(
            allowGuestControls = true,
            lastSyncMember = "guest-123",
            ownMemberId = "host-456",
            incomingTimestampMs = 1500L,
            lastAppliedTimestampMs = 1000L
        )
        assertTrue(shouldApply)
    }

    @Test
    fun `guest reconnect when host is paused adopts host position and paused state`() {
        val session = ActivePartySession(
            roomId = "room-1",
            memberId = "guest-1",
            memberToken = "token-1",
            streamTicket = "ticket-stream",
            sseTicket = "ticket-sse",
            isHost = false
        )
        val roomSync = PartySyncEvent(
            currentTime = 120.0f,
            isPlaying = false,
            updatedBy = "host",
            episodeId = "ep-10"
        )
        val state = WatchPartySyncController.resolveReconnectState(
            session = session,
            roomSync = roomSync,
            episodeId = "ep-10",
            fallbackPositionSeconds = 45.0f,
            nowMs = 1000L
        )
        assertEquals(120.0f, state.positionSeconds, 0.001f)
        assertFalse(state.playWhenReady)
    }

    @Test
    fun `guest reconnect when host is playing adopts extrapolated host position and playing state`() {
        val session = ActivePartySession(
            roomId = "room-1",
            memberId = "guest-1",
            memberToken = "token-1",
            streamTicket = "ticket-stream",
            sseTicket = "ticket-sse",
            isHost = false
        )
        val roomSync = PartySyncEvent(
            currentTime = 100.0f,
            isPlaying = true,
            updatedBy = "host",
            episodeId = "ep-10",
            lastSyncTimestampMs = 1_000_000L
        )
        val state = WatchPartySyncController.resolveReconnectState(
            session = session,
            roomSync = roomSync,
            episodeId = "ep-10",
            fallbackPositionSeconds = 45.0f,
            nowMs = 1_010_000L
        )
        assertEquals(110.0f, state.positionSeconds, 0.001f)
        assertTrue(state.playWhenReady)
    }

    @Test
    fun `host reconnect preserves local position and defaults to playing`() {
        val session = ActivePartySession(
            roomId = "room-1",
            memberId = "host-1",
            memberToken = "token-1",
            streamTicket = "ticket-stream",
            sseTicket = "ticket-sse",
            isHost = true
        )
        val roomSync = PartySyncEvent(
            currentTime = 120.0f,
            isPlaying = false,
            updatedBy = "host",
            episodeId = "ep-10"
        )
        val state = WatchPartySyncController.resolveReconnectState(
            session = session,
            roomSync = roomSync,
            episodeId = "ep-10",
            fallbackPositionSeconds = 75.0f,
            nowMs = 1000L
        )
        assertEquals(75.0f, state.positionSeconds, 0.001f)
        assertTrue(state.playWhenReady)
    }

    @Test
    fun `solo playback reconnect preserves local position and defaults to playing`() {
        val state = WatchPartySyncController.resolveReconnectState(
            session = null,
            roomSync = null,
            episodeId = "ep-10",
            fallbackPositionSeconds = 55.0f,
            nowMs = 1000L
        )
        assertEquals(55.0f, state.positionSeconds, 0.001f)
        assertTrue(state.playWhenReady)
    }
}
