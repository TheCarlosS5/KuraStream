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

    private const val DRIFT_TOLERANCE_SECONDS = 1.5f

    /**
     * Evaluates incoming host sync event against client's current absolute position and playing state.
     * Prevents disruptive micro-seeks when within drift tolerance.
     */
    fun evaluateSync(
        hostEvent: PartySyncEvent,
        clientAbsolutePositionSeconds: Float,
        clientIsPlaying: Boolean,
        isClientHost: Boolean
    ): SyncDecision {
        if (isClientHost) {
            // Local host does not apply remote sync to self
            return SyncDecision(PartySyncAction.NONE)
        }

        val drift = abs(hostEvent.currentTime - clientAbsolutePositionSeconds)
        val needsSeek = drift > DRIFT_TOLERANCE_SECONDS
        val stateMismatch = hostEvent.isPlaying != clientIsPlaying

        return when {
            needsSeek && hostEvent.isPlaying -> SyncDecision(PartySyncAction.SEEK_AND_PLAY, hostEvent.currentTime)
            needsSeek && !hostEvent.isPlaying -> SyncDecision(PartySyncAction.SEEK_AND_PAUSE, hostEvent.currentTime)
            stateMismatch && hostEvent.isPlaying -> SyncDecision(PartySyncAction.PLAY)
            stateMismatch && !hostEvent.isPlaying -> SyncDecision(PartySyncAction.PAUSE)
            else -> SyncDecision(PartySyncAction.NONE)
        }
    }
}
