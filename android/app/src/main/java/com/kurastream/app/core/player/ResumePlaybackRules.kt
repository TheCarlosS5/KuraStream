package com.kurastream.app.core.player

object ResumePlaybackRules {

    const val REWIND_THRESHOLD_SECONDS = 60f
    const val REWIND_OFFSET_SECONDS = 5f

    /**
     * Calculates the effective playback start position for the initial resume.
     * If the saved progress is at least 60s and it is not a watch party session,
     * playback starts 5 seconds earlier to recover context.
     */
    fun calculateInitialResumePosition(
        resumeSeconds: Float,
        isWatchParty: Boolean
    ): Float {
        if (isWatchParty) return resumeSeconds
        return if (resumeSeconds >= REWIND_THRESHOLD_SECONDS) {
            (resumeSeconds - REWIND_OFFSET_SECONDS).coerceAtLeast(0f)
        } else {
            resumeSeconds
        }
    }
}
