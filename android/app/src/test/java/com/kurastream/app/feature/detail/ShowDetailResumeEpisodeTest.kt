package com.kurastream.app.feature.detail

import com.kurastream.app.core.model.Episode
import com.kurastream.app.core.model.WatchHistoryItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ShowDetailResumeEpisodeTest {

    private fun ep(season: Int, number: Int) = Episode(
        id = "S${season}E$number",
        seasonNumber = season,
        episodeNumber = number
    )

    private fun historyItem(episodeId: String, completed: Boolean = false) = WatchHistoryItem(
        episodeId = episodeId,
        showId = "show_1",
        seasonNumber = 1,
        episodeNumber = 1,
        progressSeconds = if (completed) 1400f else 300f,
        duration = 1400f,
        completed = completed,
        updatedAt = "2026-10-05 20:00:00"
    )

    private val showEpisodes = listOf(
        ep(0, 1),
        ep(0, 2),
        ep(1, 1),
        ep(1, 2),
        ep(2, 1)
    )

    @Test
    fun `without history it selects S1E1 instead of specials S0E1`() {
        val result = ShowDetailViewModel.pickResumeEpisode(showEpisodes, emptyList())
        assertEquals("S1E1", result?.id)
    }

    @Test
    fun `unfinished episode returns the same episode`() {
        val history = listOf(historyItem("S1E1", completed = false))
        val result = ShowDetailViewModel.pickResumeEpisode(showEpisodes, history)
        assertEquals("S1E1", result?.id)
    }

    @Test
    fun `finished episode advances to next episode`() {
        val history = listOf(historyItem("S1E1", completed = true))
        val result = ShowDetailViewModel.pickResumeEpisode(showEpisodes, history)
        assertEquals("S1E2", result?.id)
    }

    @Test
    fun `finished episode advances across season boundary`() {
        val history = listOf(historyItem("S1E2", completed = true))
        val result = ShowDetailViewModel.pickResumeEpisode(showEpisodes, history)
        assertEquals("S2E1", result?.id)
    }

    @Test
    fun `finished last special does not loop back to S1E1`() {
        val history = listOf(historyItem("S0E2", completed = true))
        val result = ShowDetailViewModel.pickResumeEpisode(showEpisodes, history)
        assertNull(result)
    }

    @Test
    fun `finished special advances to next special`() {
        val history = listOf(historyItem("S0E1", completed = true))
        val result = ShowDetailViewModel.pickResumeEpisode(showEpisodes, history)
        assertEquals("S0E2", result?.id)
    }

    @Test
    fun `finished last regular episode does not roll into specials or loop`() {
        val history = listOf(historyItem("S2E1", completed = true))
        val result = ShowDetailViewModel.pickResumeEpisode(showEpisodes, history)
        assertNull(result)
    }
}
