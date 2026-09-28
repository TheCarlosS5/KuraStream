package com.kurastream.app.core.preferences

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import java.io.IOException

data class UserSessionPreferences(
    val activeServerId: String? = null,
    val activeServerUrl: String? = null,
    val activeUsername: String? = null,
    val activeProfileId: String? = null,
    val activeProfileName: String? = null,
    val isKidsMode: Boolean = false,
    val autoSkipIntro: Boolean = true,
    val autoSkipOutro: Boolean = false,
    val autoPlayNext: Boolean = true,
    val preferredAudioLanguage: String = "jpn",
    val preferredSubtitleLanguage: String = "spa",
    val doubleTapSeekSeconds: Int = 10,
    val reducedMotion: Boolean = false
)

class KuraPreferencesDataSource(
    private val dataStore: DataStore<Preferences>
) {
    private object Keys {
        val ACTIVE_SERVER_ID = stringPreferencesKey("active_server_id")
        val ACTIVE_SERVER_URL = stringPreferencesKey("active_server_url")
        val ACTIVE_USERNAME = stringPreferencesKey("active_username")
        val ACTIVE_PROFILE_ID = stringPreferencesKey("active_profile_id")
        val ACTIVE_PROFILE_NAME = stringPreferencesKey("active_profile_name")
        val IS_KIDS_MODE = booleanPreferencesKey("is_kids_mode")

        val AUTO_SKIP_INTRO = booleanPreferencesKey("auto_skip_intro")
        val AUTO_SKIP_OUTRO = booleanPreferencesKey("auto_skip_outro")
        val AUTO_PLAY_NEXT = booleanPreferencesKey("auto_play_next")
        val PREF_AUDIO_LANG = stringPreferencesKey("pref_audio_lang")
        val PREF_SUB_LANG = stringPreferencesKey("pref_sub_lang")
        val DOUBLE_TAP_SEEK = intPreferencesKey("double_tap_seek")
        val REDUCED_MOTION = booleanPreferencesKey("reduced_motion")
    }

    val preferencesFlow: Flow<UserSessionPreferences> = dataStore.data
        .catch { exception ->
            if (exception is IOException) {
                emit(emptyPreferences())
            } else {
                throw exception
            }
        }
        .map { prefs ->
            UserSessionPreferences(
                activeServerId = prefs[Keys.ACTIVE_SERVER_ID],
                activeServerUrl = prefs[Keys.ACTIVE_SERVER_URL],
                activeUsername = prefs[Keys.ACTIVE_USERNAME],
                activeProfileId = prefs[Keys.ACTIVE_PROFILE_ID],
                activeProfileName = prefs[Keys.ACTIVE_PROFILE_NAME],
                isKidsMode = prefs[Keys.IS_KIDS_MODE] ?: false,
                autoSkipIntro = prefs[Keys.AUTO_SKIP_INTRO] ?: true,
                autoSkipOutro = prefs[Keys.AUTO_SKIP_OUTRO] ?: false,
                autoPlayNext = prefs[Keys.AUTO_PLAY_NEXT] ?: true,
                preferredAudioLanguage = prefs[Keys.PREF_AUDIO_LANG] ?: "jpn",
                preferredSubtitleLanguage = prefs[Keys.PREF_SUB_LANG] ?: "spa",
                doubleTapSeekSeconds = prefs[Keys.DOUBLE_TAP_SEEK] ?: 10,
                reducedMotion = prefs[Keys.REDUCED_MOTION] ?: false
            )
        }

    suspend fun setActiveServer(serverId: String, serverUrl: String) {
        dataStore.edit { prefs ->
            prefs[Keys.ACTIVE_SERVER_ID] = serverId
            prefs[Keys.ACTIVE_SERVER_URL] = serverUrl
        }
    }

    suspend fun setActiveUser(username: String) {
        dataStore.edit { prefs ->
            prefs[Keys.ACTIVE_USERNAME] = username
        }
    }

    suspend fun setActiveProfile(profileId: String, profileName: String, isKids: Boolean) {
        dataStore.edit { prefs ->
            prefs[Keys.ACTIVE_PROFILE_ID] = profileId
            prefs[Keys.ACTIVE_PROFILE_NAME] = profileName
            prefs[Keys.IS_KIDS_MODE] = isKids
        }
    }

    suspend fun updatePlayerPreferences(
        autoSkipIntro: Boolean,
        autoSkipOutro: Boolean,
        autoPlayNext: Boolean,
        audioLang: String,
        subLang: String,
        seekSeconds: Int
    ) {
        dataStore.edit { prefs ->
            prefs[Keys.AUTO_SKIP_INTRO] = autoSkipIntro
            prefs[Keys.AUTO_SKIP_OUTRO] = autoSkipOutro
            prefs[Keys.AUTO_PLAY_NEXT] = autoPlayNext
            prefs[Keys.PREF_AUDIO_LANG] = audioLang
            prefs[Keys.PREF_SUB_LANG] = subLang
            prefs[Keys.DOUBLE_TAP_SEEK] = seekSeconds
        }
    }

    suspend fun clearSession() {
        dataStore.edit { prefs ->
            prefs.remove(Keys.ACTIVE_USERNAME)
            prefs.remove(Keys.ACTIVE_PROFILE_ID)
            prefs.remove(Keys.ACTIVE_PROFILE_NAME)
            prefs.remove(Keys.IS_KIDS_MODE)
        }
    }
}
