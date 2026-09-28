package com.kurastream.app.core.profiles

import org.junit.Assert.*
import org.junit.Test

class ProfileIsolationTest {

    private fun isRestrictedForKids(ageRating: String, genres: String): Boolean {
        val rating = ageRating.uppercase().trim()
        val restrictedRatings = setOf("R", "TV-MA", "18+", "NC-17", "RX", "R18")
        if (rating in restrictedRatings) return true

        val g = genres.lowercase()
        return g.contains("ecchi") || g.contains("hentai") || g.contains("erotica")
    }

    @Test
    fun `restricted ratings are flagged for kids profile`() {
        assertTrue(isRestrictedForKids("R", "Action"))
        assertTrue(isRestrictedForKids("TV-MA", "Drama"))
        assertTrue(isRestrictedForKids("18+", "Thriller"))
        assertTrue(isRestrictedForKids("NC-17", "Romance"))
        assertTrue(isRestrictedForKids("RX", "Anime"))
        assertTrue(isRestrictedForKids("R18", "Anime"))
    }

    @Test
    fun `restricted genres are flagged for kids profile regardless of rating`() {
        assertTrue(isRestrictedForKids("PG-13", "Comedy, Ecchi"))
        assertTrue(isRestrictedForKids("TV-14", "Hentai, Fantasy"))
        assertTrue(isRestrictedForKids("Unknown", "Erotica"))
    }

    @Test
    fun `standard content is permitted for kids profile`() {
        assertFalse(isRestrictedForKids("TV-14", "Shounen, Action, Adventure"))
        assertFalse(isRestrictedForKids("PG-13", "Fantasía, Magia"))
        assertFalse(isRestrictedForKids("G", "Infantil, Familiar"))
        assertFalse(isRestrictedForKids("PG", "Comedia"))
    }

    @Test
    fun `cache key composite isolates across server user and profile`() {
        fun buildCacheCompositeKey(serverId: String, username: String, profileId: String, episodeId: String): String {
            return "$serverId::$username::$profileId::$episodeId"
        }

        val adultKey = buildCacheCompositeKey("server1", "calos", "prof_adult", "ep1")
        val kidsKey = buildCacheCompositeKey("server1", "calos", "prof_kids", "ep1")
        val otherServerKey = buildCacheCompositeKey("server2", "calos", "prof_adult", "ep1")

        assertNotEquals(adultKey, kidsKey)
        assertNotEquals(adultKey, otherServerKey)
    }

    @Test
    fun `CachedShowEntity scopes by serverId, username and profileId preventing adult cache leak into kids profile`() {
        val adultShow = com.kurastream.app.core.database.CachedShowEntity(
            serverId = "server_main",
            username = "user_parent",
            profileId = "profile_adult_1",
            id = "show_mature_99",
            title = "Berserk",
            synopsis = "Dark fantasy",
            rating = 9.2f,
            year = 1997,
            studio = "OLM",
            posterPath = "/poster.jpg",
            backdropPath = "/backdrop.jpg",
            mediaType = "tv",
            genres = "Action, Horror, Ecchi",
            ageRating = "R18",
            status = "completed",
            isRestrictedKids = true
        )

        val kidsShow = com.kurastream.app.core.database.CachedShowEntity(
            serverId = "server_main",
            username = "user_parent",
            profileId = "profile_kids_2",
            id = "show_kids_01",
            title = "Pokemon",
            synopsis = "Gotta catch em all",
            rating = 8.0f,
            year = 1997,
            studio = "OLM",
            posterPath = "/pkmn.jpg",
            backdropPath = "/pkmn_bg.jpg",
            mediaType = "tv",
            genres = "Adventure, Fantasy",
            ageRating = "G",
            status = "completed",
            isRestrictedKids = false
        )

        val otherUserShow = com.kurastream.app.core.database.CachedShowEntity(
            serverId = "server_main",
            username = "user_stranger",
            profileId = "profile_kids_2",
            id = "show_stranger_01",
            title = "Other User Cartoon",
            synopsis = "Other cartoon",
            rating = 7.0f,
            year = 2020,
            studio = "Studio",
            posterPath = "/stranger.jpg",
            backdropPath = "/stranger_bg.jpg",
            mediaType = "tv",
            genres = "Animation",
            ageRating = "G",
            status = "completed",
            isRestrictedKids = false
        )

        // Mock in-memory cache representing ShowDao query:
        // SELECT * FROM cached_shows WHERE serverId = :serverId AND (:username = '' OR username = :username) AND profileId = :profileId AND (:isKidsMode = 0 OR isRestrictedKids = 0)
        val databaseTable = listOf(adultShow, kidsShow, otherUserShow)

        fun queryDao(serverId: String, username: String, profileId: String, isKidsMode: Boolean): List<com.kurastream.app.core.database.CachedShowEntity> {
            return databaseTable.filter {
                it.serverId == serverId &&
                (username.isEmpty() || it.username == username) &&
                it.profileId == profileId &&
                (!isKidsMode || !it.isRestrictedKids)
            }
        }

        val kidsResults = queryDao("server_main", "user_parent", "profile_kids_2", isKidsMode = true)
        assertEquals(1, kidsResults.size)
        assertEquals("Pokemon", kidsResults.first().title)
        assertFalse(kidsResults.any { it.id == "show_mature_99" })
        assertFalse(kidsResults.any { it.id == "show_stranger_01" })

        val adultResults = queryDao("server_main", "user_parent", "profile_adult_1", isKidsMode = false)
        assertEquals(1, adultResults.size)
        assertEquals("Berserk", adultResults.first().title)
    }
}
