package com.kurastream.app.feature.settings

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import coil.Coil
import com.kurastream.app.core.database.ShowDao
import com.kurastream.app.core.model.UserPreferencesPatch
import com.kurastream.app.core.model.UserStats
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.preferences.UserSessionPreferences
import com.kurastream.app.core.repository.AuthRepository
import com.kurastream.app.core.repository.HistoryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsUiState(
    val sessionPrefs: UserSessionPreferences = UserSessionPreferences(),
    val userStats: UserStats? = null,
    val isLoggingOut: Boolean = false,
    val cacheClearedMessage: String? = null
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val authRepository: AuthRepository,
    private val historyRepository: HistoryRepository,
    private val catalogShowDao: ShowDao,
    private val preferencesDataSource: KuraPreferencesDataSource
) : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            preferencesDataSource.preferencesFlow.collect { prefs ->
                _uiState.update { it.copy(sessionPrefs = prefs) }
            }
        }

        viewModelScope.launch {
            val statsRes = historyRepository.getUserStats()
            if (statsRes.isSuccess) {
                _uiState.update { it.copy(userStats = statsRes.getOrNull()) }
            }
        }
    }

    fun setAutoSkipIntro(enabled: Boolean) {
        val current = _uiState.value.sessionPrefs
        viewModelScope.launch {
            preferencesDataSource.updatePlayerPreferences(
                autoSkipIntro = enabled,
                autoSkipOutro = current.autoSkipOutro,
                autoPlayNext = current.autoPlayNext,
                audioLang = current.preferredAudioLanguage,
                subLang = current.preferredSubtitleLanguage,
                seekSeconds = current.doubleTapSeekSeconds
            )
            historyRepository.patchUserPreferences(UserPreferencesPatch(autoSkipIntro = enabled))
        }
    }

    fun setAutoSkipOutro(enabled: Boolean) {
        val current = _uiState.value.sessionPrefs
        viewModelScope.launch {
            preferencesDataSource.updatePlayerPreferences(
                autoSkipIntro = current.autoSkipIntro,
                autoSkipOutro = enabled,
                autoPlayNext = current.autoPlayNext,
                audioLang = current.preferredAudioLanguage,
                subLang = current.preferredSubtitleLanguage,
                seekSeconds = current.doubleTapSeekSeconds
            )
        }
    }

    fun setAutoPlayNext(enabled: Boolean) {
        val current = _uiState.value.sessionPrefs
        viewModelScope.launch {
            preferencesDataSource.updatePlayerPreferences(
                autoSkipIntro = current.autoSkipIntro,
                autoSkipOutro = current.autoSkipOutro,
                autoPlayNext = enabled,
                audioLang = current.preferredAudioLanguage,
                subLang = current.preferredSubtitleLanguage,
                seekSeconds = current.doubleTapSeekSeconds
            )
            historyRepository.patchUserPreferences(UserPreferencesPatch(autoPlayNext = enabled))
        }
    }

    fun setPreferredAudio(lang: String) {
        val current = _uiState.value.sessionPrefs
        viewModelScope.launch {
            preferencesDataSource.updatePlayerPreferences(
                autoSkipIntro = current.autoSkipIntro,
                autoSkipOutro = current.autoSkipOutro,
                autoPlayNext = current.autoPlayNext,
                audioLang = lang,
                subLang = current.preferredSubtitleLanguage,
                seekSeconds = current.doubleTapSeekSeconds
            )
            historyRepository.patchUserPreferences(UserPreferencesPatch(preferredAudioLanguage = lang))
        }
    }

    fun setPreferredSubtitles(lang: String) {
        val current = _uiState.value.sessionPrefs
        viewModelScope.launch {
            preferencesDataSource.updatePlayerPreferences(
                autoSkipIntro = current.autoSkipIntro,
                autoSkipOutro = current.autoSkipOutro,
                autoPlayNext = current.autoPlayNext,
                audioLang = current.preferredAudioLanguage,
                subLang = lang,
                seekSeconds = current.doubleTapSeekSeconds
            )
            historyRepository.patchUserPreferences(UserPreferencesPatch(preferredSubtitleLanguage = lang))
        }
    }

    fun setDoubleTapSeekSeconds(seconds: Int) {
        val current = _uiState.value.sessionPrefs
        viewModelScope.launch {
            preferencesDataSource.updatePlayerPreferences(
                autoSkipIntro = current.autoSkipIntro,
                autoSkipOutro = current.autoSkipOutro,
                autoPlayNext = current.autoPlayNext,
                audioLang = current.preferredAudioLanguage,
                subLang = current.preferredSubtitleLanguage,
                seekSeconds = seconds
            )
        }
    }

    fun logout(onLoggedOut: () -> Unit) {
        _uiState.update { it.copy(isLoggingOut = true) }
        viewModelScope.launch {
            authRepository.logout()
            _uiState.update { it.copy(isLoggingOut = false) }
            onLoggedOut()
        }
    }

    @OptIn(coil.annotation.ExperimentalCoilApi::class)
    fun clearCache() {
        viewModelScope.launch(Dispatchers.IO) {
            val serverId = _uiState.value.sessionPrefs.activeServerId
            if (!serverId.isNullOrBlank()) {
                catalogShowDao.clearShowsForServer(serverId)
            }
            try {
                val imageLoader = Coil.imageLoader(context)
                imageLoader.diskCache?.clear()
                imageLoader.memoryCache?.clear()
            } catch (_: Exception) {}

            _uiState.update { it.copy(cacheClearedMessage = "Caché de imágenes y catálogo limpiada correctamente") }
        }
    }

    fun dismissCacheMessage() {
        _uiState.update { it.copy(cacheClearedMessage = null) }
    }
}
