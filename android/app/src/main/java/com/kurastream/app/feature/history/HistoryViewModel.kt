package com.kurastream.app.feature.history

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kurastream.app.core.model.UiState
import com.kurastream.app.core.model.WatchHistoryItem
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.repository.HistoryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HistoryUiState(
    val state: UiState<List<WatchHistoryItem>> = UiState.Loading,
    val showClearConfirmation: Boolean = false,
    val baseUrl: String = "",
    val isRefreshing: Boolean = false
)

@HiltViewModel
class HistoryViewModel @Inject constructor(
    private val historyRepository: HistoryRepository,
    private val preferencesDataSource: KuraPreferencesDataSource
) : ViewModel() {

    private val _uiState = MutableStateFlow(HistoryUiState())
    val uiState: StateFlow<HistoryUiState> = _uiState.asStateFlow()

    private var cacheObservationJob: Job? = null
    private var networkRefreshJob: Job? = null

    private var currentServerId = ""
    private var currentUsername = ""
    private var currentProfileId = ""

    init {
        observePreferencesAndInitialize()
    }

    private fun observePreferencesAndInitialize() {
        viewModelScope.launch {
            preferencesDataSource.preferencesFlow.collectLatest { prefs ->
                val serverId = prefs.activeServerId ?: ""
                val username = prefs.activeUsername ?: ""
                val profileId = prefs.activeProfileId ?: ""
                _uiState.update { it.copy(baseUrl = prefs.activeServerUrl ?: "") }

                val sessionChanged = serverId != currentServerId ||
                        username != currentUsername ||
                        profileId != currentProfileId

                currentServerId = serverId
                currentUsername = username
                currentProfileId = profileId

                if (sessionChanged) {
                    if (serverId.isBlank() || username.isBlank() || profileId.isBlank()) {
                        _uiState.update { it.copy(state = UiState.Empty("No hay sesión activa")) }
                    } else {
                        _uiState.update { it.copy(state = UiState.Loading) }
                        startCacheObservation(serverId, username, profileId)
                        triggerNetworkRefresh(serverId, username, profileId)
                    }
                }
            }
        }
    }

    private fun startCacheObservation(serverId: String, username: String, profileId: String) {
        cacheObservationJob?.cancel()
        cacheObservationJob = viewModelScope.launch {
            historyRepository.getCachedHistory(serverId, username, profileId).collect { cached ->
                if (cached.isNotEmpty()) {
                    _uiState.update { it.copy(state = UiState.Content(cached)) }
                } else if (_uiState.value.state !is UiState.Content && _uiState.value.state !is UiState.Loading) {
                    _uiState.update { it.copy(state = UiState.Empty("Aún no has visto ningún episodio")) }
                }
            }
        }
    }

    fun refresh() {
        if (currentServerId.isBlank() || currentUsername.isBlank() || currentProfileId.isBlank()) return
        triggerNetworkRefresh(currentServerId, currentUsername, currentProfileId)
    }

    fun loadHistory() = refresh()

    private fun triggerNetworkRefresh(serverId: String, username: String, profileId: String) {
        networkRefreshJob?.cancel()
        networkRefreshJob = viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true) }
            val result = historyRepository.refreshHistory(serverId, username, profileId)
            _uiState.update { it.copy(isRefreshing = false) }

            if (result.isSuccess) {
                val list = result.getOrThrow()
                if (list.isEmpty()) {
                    _uiState.update { it.copy(state = UiState.Empty("Aún no has visto ningún episodio")) }
                } else {
                    _uiState.update { it.copy(state = UiState.Content(list)) }
                }
            } else if (_uiState.value.state !is UiState.Content) {
                _uiState.update {
                    it.copy(state = UiState.Error(result.exceptionOrNull()?.message ?: "Error al cargar historial"))
                }
            }
        }
    }

    fun deleteItem(episodeId: String) {
        val current = (_uiState.value.state as? UiState.Content)?.data ?: return
        val updated = current.filter { it.episodeId != episodeId }

        _uiState.update {
            it.copy(
                state = if (updated.isEmpty()) UiState.Empty("Historial vacío") else UiState.Content(updated)
            )
        }

        viewModelScope.launch {
            val res = historyRepository.deleteHistoryItem(currentServerId, currentUsername, currentProfileId, episodeId)
            if (res.isFailure) {
                _uiState.update { it.copy(state = UiState.Content(current)) }
            }
        }
    }

    fun requestClearAll() {
        _uiState.update { it.copy(showClearConfirmation = true) }
    }

    fun dismissClearDialog() {
        _uiState.update { it.copy(showClearConfirmation = false) }
    }

    fun confirmClearAll() {
        _uiState.update { it.copy(showClearConfirmation = false, state = UiState.Empty("Historial vacío")) }

        viewModelScope.launch {
            historyRepository.clearAllHistory(currentServerId, currentUsername, currentProfileId)
        }
    }
}
