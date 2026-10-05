package com.kurastream.app.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ContinueWatchingRulesTest {

    private fun row(ep: Int, progress: Float, updatedAt: String, completed: Boolean = false, show: String = "frieren") =
        WatchHistoryItem(
            episodeId = "${show}_S1_E$ep",
            showId = show,
            seasonNumber = 1,
            episodeNumber = ep,
            progressSeconds = progress,
            duration = 1440f,
            completed = completed,
            updatedAt = updatedAt
        )

    @Test
    fun `finished series leaves the row even with an old half-watched episode`() {
        val history = (1..12).map { ep ->
            row(ep, if (ep == 9) 700f else 1440f, "2026-10-03 20:${ep.toString().padStart(2, '0')}:00", completed = ep != 9)
        }
        assertTrue(ContinueWatchingRules.fromHistory(history).isEmpty())
    }

    @Test
    fun `latest episode in progress is the card`() {
        val history = listOf(
            row(1, 1440f, "2026-10-03 20:00:00", completed = true),
            row(2, 300f, "2026-10-03 21:00:00")
        )
        val result = ContinueWatchingRules.fromHistory(history)
        assertEquals(listOf("frieren_S1_E2"), result.map { it.episodeId })
    }

    @Test
    fun `one card per show, newest show first`() {
        val history = listOf(
            row(3, 200f, "2026-10-03 18:00:00", show = "a"),
            row(4, 250f, "2026-10-03 19:00:00", show = "a"),
            row(1, 100f, "2026-10-03 22:00:00", show = "b")
        )
        assertEquals(listOf("b_S1_E1", "a_S1_E4"), ContinueWatchingRules.fromHistory(history).map { it.episodeId })
    }
}
