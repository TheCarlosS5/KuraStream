package com.kurastream.app.data

import android.content.SharedPreferences
import org.junit.Assert.*
import org.junit.Test
import com.google.gson.Gson

class KuraStreamDataTest {

    // Simple in-memory SharedPreferences implementation for testing
    private class FakeSharedPreferences : SharedPreferences {
        val map = mutableMapOf<String, Any?>()

        override fun getAll(): Map<String, *> = map
        override fun getString(key: String, defValue: String?): String? = map[key] as? String ?: defValue
        override fun getStringSet(key: String, defValues: Set<String>?): Set<String>? = map[key] as? Set<String> ?: defValues
        override fun getInt(key: String, defValue: Int): Int = map[key] as? Int ?: defValue
        override fun getLong(key: String, defValue: Long): Long = map[key] as? Long ?: defValue
        override fun getFloat(key: String, defValue: Float): Float = map[key] as? Float ?: defValue
        override fun getBoolean(key: String, defValue: Boolean): Boolean = map[key] as? Boolean ?: defValue
        override fun contains(key: String): Boolean = map.containsKey(key)
        override fun edit(): SharedPreferences.Editor = FakeEditor(this)

        override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {}
        override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {}

        private class FakeEditor(private val prefs: FakeSharedPreferences) : SharedPreferences.Editor {
            private val tempMap = mutableMapOf<String, Any?>()

            override fun putString(key: String, value: String?): SharedPreferences.Editor {
                tempMap[key] = value
                return this
            }
            override fun putStringSet(key: String, values: Set<String>?): SharedPreferences.Editor {
                tempMap[key] = values
                return this
            }
            override fun putInt(key: String, value: Int): SharedPreferences.Editor {
                tempMap[key] = value
                return this
            }
            override fun putLong(key: String, value: Long): SharedPreferences.Editor {
                tempMap[key] = value
                return this
            }
            override fun putFloat(key: String, value: Float): SharedPreferences.Editor {
                tempMap[key] = value
                return this
            }
            override fun putBoolean(key: String, value: Boolean): SharedPreferences.Editor {
                tempMap[key] = value
                return this
            }
            override fun remove(key: String): SharedPreferences.Editor {
                tempMap[key] = null
                return this
            }
            override fun clear(): SharedPreferences.Editor {
                tempMap.clear()
                prefs.map.clear()
                return this
            }
            override fun commit(): Boolean {
                apply()
                return true
            }
            override fun apply() {
                for ((key, value) in tempMap) {
                    if (value == null) {
                        prefs.map.remove(key)
                    } else {
                        prefs.map[key] = value
                    }
                }
            }
        }
    }

    @Test
    fun testPreferencesManager() {
        val fakePrefs = FakeSharedPreferences()
        val prefsManager = PreferencesManager(fakePrefs)

        assertNull(prefsManager.getServerUrl())
        assertNull(prefsManager.getAuthToken())
        assertNull(prefsManager.getUsername())

        prefsManager.saveServerUrl("http://localhost:3000")
        prefsManager.saveAuthToken("fake_token_jwt")
        prefsManager.saveUsername("carlossgr")

        assertEquals("http://localhost:3000", prefsManager.getServerUrl())
        assertEquals("fake_token_jwt", prefsManager.getAuthToken())
        assertEquals("carlossgr", prefsManager.getUsername())

        prefsManager.clearAuthSession()
        assertEquals("http://localhost:3000", prefsManager.getServerUrl()) // URL is preserved!
        assertNull(prefsManager.getAuthToken())
        assertNull(prefsManager.getUsername())
    }

    @Test
    fun testModelSerialization() {
        val gson = Gson()

        // Test Show model
        val show = Show(
            id = "1",
            title = "Oshi no Ko",
            synopsis = "Great anime",
            rating = 9.2,
            year = 2023,
            studio = "Doga Kobo",
            director = "Daisuke Hiramaki",
            writer = "Jin Tanaka",
            castMembers = "[]",
            posterPath = "/poster.jpg",
            backdropPath = "/backdrop.jpg",
            mediaType = "anime",
            backdropLoops = "[]",
            genres = "Drama, Music",
            trailerKey = "abc",
            createdAt = "2026-07-28"
        )
        val showJson = gson.toJson(show)
        val showParsed = gson.fromJson(showJson, Show::class.java)
        assertEquals(show.id, showParsed.id)
        assertEquals(show.title, showParsed.title)
        assertEquals(show.synopsis, showParsed.synopsis)

        // Test Episode model
        val episode = Episode(
            id = "1_1",
            showId = "1",
            seasonNumber = 1,
            episodeNumber = 1,
            title = "Mother and Children",
            synopsis = "Introduction",
            filepath = "/path/to/ep1.mp4",
            duration = 5000.0,
            size = 1000000L,
            videoCodec = "h264",
            resolution = "1080p",
            fps = 23.976,
            audioTracks = "[]",
            subtitleTracks = "[]",
            thumbnailPath = "/thumb1.jpg",
            introStart = 120,
            introEnd = 210,
            outroStart = 4800
        )
        val epJson = gson.toJson(episode)
        val epParsed = gson.fromJson(epJson, Episode::class.java)
        assertEquals(episode.id, epParsed.id)
        assertEquals(episode.filepath, epParsed.filepath)

        // Test ShowDetailResponse
        val detailResponse = ShowDetailResponse(show, listOf(episode))
        val detailJson = gson.toJson(detailResponse)
        val detailParsed = gson.fromJson(detailJson, ShowDetailResponse::class.java)
        assertEquals(detailResponse.show.title, detailParsed.show.title)
        assertEquals(1, detailParsed.episodes.size)

        // Test LoginRequest
        val loginRequest = LoginRequest("user", "pass")
        val loginReqJson = gson.toJson(loginRequest)
        val loginReqParsed = gson.fromJson(loginReqJson, LoginRequest::class.java)
        assertEquals("user", loginReqParsed.username)

        // Test LoginResponse
        val loginResponse = LoginResponse(true, "ok", "user", "admin", "token123")
        val loginResJson = gson.toJson(loginResponse)
        val loginResParsed = gson.fromJson(loginResJson, LoginResponse::class.java)
        assertTrue(loginResParsed.success)
        assertEquals("token123", loginResParsed.token)

        // Test ProgressResponse
        val progressResponse = ProgressResponse(12.34)
        val progResJson = gson.toJson(progressResponse)
        val progResParsed = gson.fromJson(progResJson, ProgressResponse::class.java)
        assertEquals(12.34, progResParsed.progress, 0.001)

        // Test ProgressRequest
        val progressRequest = ProgressRequest(45.67, "user")
        val progReqJson = gson.toJson(progressRequest)
        val progReqParsed = gson.fromJson(progReqJson, ProgressRequest::class.java)
        assertEquals(45.67, progReqParsed.progress, 0.001)
        assertEquals("user", progReqParsed.username)
    }

    @Test
    fun testKuraStreamApiCreation() {
        val fakePrefs = FakeSharedPreferences()
        fakePrefs.edit().putString("auth_token", "test_token_123").apply()
        val prefsManager = PreferencesManager(fakePrefs)

        val api = KuraStreamApi.create("http://localhost:3000", prefsManager)
        assertNotNull(api)
    }
}
