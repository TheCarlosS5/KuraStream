package com.kurastream.app.core.player

import com.kurastream.app.core.model.PartySyncEvent
import kotlin.math.abs

enum class PartySyncAction {
    NONE,
    SEEK,
    PLAY,
    PAUSE,
    SEEK_AND_PLAY,
    SEEK_AND_PAUSE
}

data class SyncDecision(
    val action: PartySyncAction,
    val targetPositionSeconds: Float? = null
)

object WatchPartySyncController {

    const val DRIFT_TOLERANCE_SECONDS = 1.5f

    /**
     * Remuxed/transcoded streams restart FFmpeg on every seek, which costs several seconds of buffering.
     * A tight tolerance there produces endless re-seek loops, so they get a wider window.
     */
    const val TRANSCODED_DRIFT_TOLERANCE_SECONDS = 5f

    /** Longest stretch a guest extrapolates the host clock (host heartbeats arrive every 10 s). */
    const val MAX_EXTRAPOLATION_SECONDS = 30f

    /**
     * Where the host is *now*. The room only stores the position at the host's last write
     * (last_sync_timestamp), so while playing we must add the time elapsed since then; otherwise every
     * poll/init frame drags guests back to a stale position.
     *
     * last_sync_timestamp is on the server clock. Comparing it with the device clock threw guests to
     * the end of the episode whenever the two disagreed, so the elapsed time is measured on the server
     * clock (server_time_ms) plus the time since the frame arrived, and capped.
     */
    fun expectedHostPositionSeconds(hostEvent: PartySyncEvent, nowMs: Long): Float {
        if (!hostEvent.isPlaying || hostEvent.lastSyncTimestampMs <= 0L || nowMs <= 0L) {
            return hostEvent.currentTime
        }
        val elapsedMs = if (hostEvent.serverTimeMs > 0L && hostEvent.receivedAtMs > 0L) {
            (hostEvent.serverTimeMs - hostEvent.lastSyncTimestampMs) + (nowMs - hostEvent.receivedAtMs)
        } else {
            nowMs - hostEvent.lastSyncTimestampMs
        }
        val elapsedSeconds = (elapsedMs.coerceAtLeast(0L) / 1000f).coerceAtMost(MAX_EXTRAPOLATION_SECONDS)
        return hostEvent.currentTime + elapsedSeconds * hostEvent.playbackRate
    }

    /**
     * Evaluates incoming host sync event against client's current absolute position and playing state.
     * Prevents disruptive micro-seeks when within drift tolerance.
     */
    fun evaluateSync(
        hostEvent: PartySyncEvent,
        clientAbsolutePositionSeconds: Float,
        clientIsPlaying: Boolean,
        isClientHost: Boolean,
        nowMs: Long = 0L,
        driftToleranceSeconds: Float = DRIFT_TOLERANCE_SECONDS
    ): SyncDecision {
        if (isClientHost) {
            // Local host does not apply remote sync to self
            return SyncDecision(PartySyncAction.NONE)
        }

        val hostPosition = expectedHostPositionSeconds(hostEvent, nowMs)
        val drift = abs(hostPosition - clientAbsolutePositionSeconds)
        val needsSeek = drift > driftToleranceSeconds
        val stateMismatch = hostEvent.isPlaying != clientIsPlaying

        return when {
            needsSeek && hostEvent.isPlaying -> SyncDecision(PartySyncAction.SEEK_AND_PLAY, hostPosition)
            needsSeek && !hostEvent.isPlaying -> SyncDecision(PartySyncAction.SEEK_AND_PAUSE, hostPosition)
            stateMismatch && hostEvent.isPlaying -> SyncDecision(PartySyncAction.PLAY)
            stateMismatch && !hostEvent.isPlaying -> SyncDecision(PartySyncAction.PAUSE)
            else -> SyncDecision(PartySyncAction.NONE)
        }
    }
}
