package com.kurastream.app.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BecauseYouWatchedRulesTest {

    private fun show(
        id: String,
        title: String,
        genres: String,
        rating: Float = 8.0f,
        year: Int? = 2024,
        ageRating: String = "TV-14"
    ) = Show(
        id = id,
        title = title,
        genres = genres,
        rating = rating,
        year = year,
        ageRating = ageRating
    )

    private fun history(showId: String, updatedAt: String) = WatchHistoryItem(
        episodeId = "${showId}_e1",
        showId = showId,
        seasonNumber = 1,
        episodeNumber = 1,
        progressSeconds = 500f,
        duration = 1400f,
        completed = false,
        updatedAt = updatedAt
    )

    @Test
    fun `empty history or shows returns null`() {
        val s = show("1", "Frieren", "Fantasy, Adventure")
        assertNull(BecauseYouWatchedRules.recommend(listOf(s), emptyList()))
        assertNull(BecauseYouWatchedRules.recommend(emptyList(), listOf(history("1", "2026-10-01"))))
    }

    @Test
    fun `source show without genres returns null`() {
        val s1 = show("1", "Frieren", "")
        val s2 = show("2", "Dungeon Meshi", "Fantasy")
        val hist = listOf(history("1", "2026-10-05 20:00:00"))

        val result = BecauseYouWatchedRules.recommend(listOf(s1, s2), hist)
        assertNull(result)
    }

    @Test
    fun `excludes source show from recommendations`() {
        val s1 = show("1", "Frieren", "Fantasy, Adventure")
        val s2 = show("2", "Dungeon Meshi", "Fantasy, Adventure")
        val hist = listOf(history("1", "2026-10-05 20:00:00"))

        val result = BecauseYouWatchedRules.recommend(listOf(s1, s2), hist)
        assertNotNull(result)
        assertEquals("Frieren", result?.sourceShowTitle)
        assertEquals(listOf("2"), result?.recommendations?.map { it.id })
    }

    @Test
    fun `scores by number of matching genres and ranks accordingly`() {
        val source = show("1", "Source", "Action, Adventure, Fantasy")
        val match3 = show("2", "Match Three", "Action, Adventure, Fantasy")
        val match2 = show("3", "Match Two", "Action, Adventure, Comedy")
        val match1 = show("4", "Match One", "Fantasy, Drama")
        val match0 = show("5", "No Match", "Sci-Fi, Romance")

        val catalog = listOf(source, match1, match3, match0, match2)
        val hist = listOf(history("1", "2026-10-05 20:00:00"))

        val result = BecauseYouWatchedRules.recommend(catalog, hist)
        assertNotNull(result)
        val ids = result?.recommendations?.map { it.id }
        assertEquals(listOf("2", "3", "4"), ids)
    }

    @Test
    fun `deterministic tie-breaking uses rating year and title`() {
        val source = show("1", "Source", "Action")
        // Same genre match (1), varying rating
        val highRating = show("2", "High Rating", "Action", rating = 9.5f, year = 2020)
        val lowRating = show("3", "Low Rating", "Action", rating = 7.0f, year = 2020)
        // Same rating, newer year
        val newerYear = show("4", "Newer Year", "Action", rating = 8.0f, year = 2024)
        val olderYear = show("5", "Older Year", "Action", rating = 8.0f, year = 2021)
        // Same rating and year, alphabetical title
        val alphaA = show("6", "Alpha A", "Action", rating = 8.5f, year = 2023)
        val alphaB = show("7", "Beta B", "Action", rating = 8.5f, year = 2023)

        val catalog = listOf(source, lowRating, olderYear, alphaB, highRating, alphaA, newerYear)
        val hist = listOf(history("1", "2026-10-05 20:00:00"))

        val result = BecauseYouWatchedRules.recommend(catalog, hist)
        val ids = result?.recommendations?.map { it.id }
        assertEquals(listOf("2", "6", "7", "4", "5", "3"), ids)
    }

    @Test
    fun `respects kids mode by excluding restricted content`() {
        val source = show("1", "Kid Friendly", "Action, Comedy", ageRating = "TV-PG")
        val adultShow = show("2", "Adult Action", "Action", ageRating = "TV-MA")
        val ecchiShow = show("3", "Ecchi Action", "Action, Ecchi", ageRating = "TV-14")
        val cleanShow = show("4", "Clean Action", "Action", ageRating = "TV-PG")

        val catalog = listOf(source, adultShow, ecchiShow, cleanShow)
        val hist = listOf(history("1", "2026-10-05 20:00:00"))

        val result = BecauseYouWatchedRules.recommend(catalog, hist, isKids = true)
        assertEquals(listOf("4"), result?.recommendations?.map { it.id })
    }

    @Test
    fun `kids mode returns null if source show itself is restricted`() {
        val restrictedSource = show("1", "Restricted", "Action", ageRating = "TV-MA")
        val candidate = show("2", "Kid Show", "Action", ageRating = "TV-PG")
        val hist = listOf(history("1", "2026-10-05 20:00:00"))

        val result = BecauseYouWatchedRules.recommend(listOf(restrictedSource, candidate), hist, isKids = true)
        assertNull(result)
    }

    @Test
    fun `limits recommendations to maximum of 6`() {
        val source = show("0", "Source", "Action")
        val candidates = (1..10).map { i ->
            show(i.toString(), "Show $i", "Action", rating = (10 - i).toFloat())
        }
        val hist = listOf(history("0", "2026-10-05 20:00:00"))

        val result = BecauseYouWatchedRules.recommend(listOf(source) + candidates, hist)
        assertEquals(6, result?.recommendations?.size)
        assertEquals(listOf("1", "2", "3", "4", "5", "6"), result?.recommendations?.map { it.id })
    }

    @Test
    fun `profile change with different latest history item picks different source show`() {
        val showA = show("A", "Show A", "Romance")
        val showB = show("B", "Show B", "Mecha")
        val recRomance = show("R", "Romance Rec", "Romance")
        val recMecha = show("M", "Mecha Rec", "Mecha")

        val catalog = listOf(showA, showB, recRomance, recMecha)

        // Profile 1 recently watched Show A
        val hist1 = listOf(history("A", "2026-10-05 21:00:00"), history("B", "2026-10-04 10:00:00"))
        val res1 = BecauseYouWatchedRules.recommend(catalog, hist1)
        assertEquals("Show A", res1?.sourceShowTitle)
        assertEquals(listOf("R"), res1?.recommendations?.map { it.id })

        // Profile 2 recently watched Show B
        val hist2 = listOf(history("B", "2026-10-05 22:00:00"), history("A", "2026-10-05 15:00:00"))
        val res2 = BecauseYouWatchedRules.recommend(catalog, hist2)
        assertEquals("Show B", res2?.sourceShowTitle)
        assertEquals(listOf("M"), res2?.recommendations?.map { it.id })
    }
}
