package com.kurastream.app.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EpisodeOrderTest {

    private fun ep(season: Int, number: Int) = Episode(id = "S${season}E$number", seasonNumber = season, episodeNumber = number)

    private val episodes = listOf(ep(0, 1), ep(2, 1), ep(1, 2), ep(1, 1), ep(0, 2))

    @Test
    fun `specials come after the regular seasons`() {
        assertEquals(listOf("S1E1", "S1E2", "S2E1", "S0E1", "S0E2"), EpisodeOrder.ordered(episodes).map { it.id })
    }

    @Test
    fun `next crosses seasons but never into specials`() {
        assertEquals("S2E1", EpisodeOrder.next(episodes, "S1E2")?.id)
        assertNull(EpisodeOrder.next(episodes, "S2E1"))
        assertEquals("S0E2", EpisodeOrder.next(episodes, "S0E1")?.id)
        assertNull(EpisodeOrder.previous(episodes, "S0E1"))
    }

    @Test
    fun `first episode is the first regular one`() {
        assertEquals("S1E1", EpisodeOrder.first(episodes)?.id)
    }
}
