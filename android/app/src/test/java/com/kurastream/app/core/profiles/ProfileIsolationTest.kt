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
}
