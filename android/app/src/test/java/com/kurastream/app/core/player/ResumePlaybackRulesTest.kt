package com.kurastream.app.core.player

import org.junit.Assert.assertEquals
import org.junit.Test

class ResumePlaybackRulesTest {

    @Test
    fun `position at start returns 0 without offset`() {
        val result = ResumePlaybackRules.calculateInitialResumePosition(
            resumeSeconds = 0f,
            isWatchParty = false
        )
        assertEquals(0f, result, 0.001f)
    }

    @Test
    fun `position below 60 seconds is unchanged`() {
        val result30 = ResumePlaybackRules.calculateInitialResumePosition(
            resumeSeconds = 30f,
            isWatchParty = false
        )
        assertEquals(30f, result30, 0.001f)

        val result59 = ResumePlaybackRules.calculateInitialResumePosition(
            resumeSeconds = 59.9f,
            isWatchParty = false
        )
        assertEquals(59.9f, result59, 0.001f)
    }

    @Test
    fun `position at exactly 60 seconds rewinds 5 seconds`() {
        val result = ResumePlaybackRules.calculateInitialResumePosition(
            resumeSeconds = 60f,
            isWatchParty = false
        )
        assertEquals(55f, result, 0.001f)
    }

    @Test
    fun `position at 120 seconds rewinds 5 seconds`() {
        val result = ResumePlaybackRules.calculateInitialResumePosition(
            resumeSeconds = 120f,
            isWatchParty = false
        )
        assertEquals(115f, result, 0.001f)
    }

    @Test
    fun `watch party ignores rewind even if position is above 60 seconds`() {
        val result = ResumePlaybackRules.calculateInitialResumePosition(
            resumeSeconds = 120f,
            isWatchParty = true
        )
        assertEquals(120f, result, 0.001f)
    }
}
