package com.kurastream.app.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kurastream.app.core.model.UserPreferences
import com.kurastream.app.core.model.UserStats
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.preferences.UserSessionPreferences
import com.kurastream.app.core.repository.AuthRepository
import com.kurastream.app.core.repository.HistoryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
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
    private val authRepository: AuthRepository,
    private val historyRepository: HistoryRepository,
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
            historyRepository.saveUserPreferences(
                UserPreferences(
                    autoSkipIntro = enabled,
                    autoSkipOutro = current.autoSkipOutro,
                    autoPlayNext = current.autoPlayNext,
                    preferredAudioLanguage = current.preferredAudioLanguage,
                    preferredSubtitleLanguage = current.preferredSubtitleLanguage
                )
            )
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
            historyRepository.saveUserPreferences(
                UserPreferences(
                    autoSkipIntro = current.autoSkipIntro,
                    autoPlayNext = enabled,
                    preferredAudioLanguage = current.preferredAudioLanguage,
                    preferredSubtitleLanguage = current.preferredSubtitleLanguage
                )
            )
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
            historyRepository.saveUserPreferences(
                UserPreferences(
                    preferredAudioLanguage = lang,
                    preferredSubtitleLanguage = current.preferredSubtitleLanguage
                )
            )
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
            historyRepository.saveUserPreferences(
                UserPreferences(
                    preferredAudioLanguage = current.preferredAudioLanguage,
                    preferredSubtitleLanguage = lang
                )
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

    fun clearCache() {
        _uiState.update { it.copy(cacheClearedMessage = "Caché de imágenes y catálogo limpiada correctamente") }
    }

    fun dismissCacheMessage() {
        _uiState.update { it.copy(cacheClearedMessage = null) }
    }
}
