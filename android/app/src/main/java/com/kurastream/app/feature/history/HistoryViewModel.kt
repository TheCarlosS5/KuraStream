package com.kurastream.app.feature.history

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kurastream.app.core.model.UiState
import com.kurastream.app.core.model.WatchHistoryItem
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.repository.HistoryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HistoryUiState(
    val state: UiState<List<WatchHistoryItem>> = UiState.Loading,
    val showClearConfirmation: Boolean = false,
    val baseUrl: String = ""
)

@HiltViewModel
class HistoryViewModel @Inject constructor(
    private val historyRepository: HistoryRepository,
    private val preferencesDataSource: KuraPreferencesDataSource
) : ViewModel() {

    private val _uiState = MutableStateFlow(HistoryUiState())
    val uiState: StateFlow<HistoryUiState> = _uiState.asStateFlow()

    private var currentServerId = ""
    private var currentUsername = ""
    private var currentProfileId = ""

    init {
        loadHistory()
    }

    fun loadHistory() {
        _uiState.update { it.copy(state = UiState.Loading) }

        viewModelScope.launch {
            val prefs = preferencesDataSource.preferencesFlow.first()
            currentServerId = prefs.activeServerId ?: ""
            currentUsername = prefs.activeUsername ?: ""
            currentProfileId = prefs.activeProfileId ?: ""
            _uiState.update { it.copy(baseUrl = prefs.activeServerUrl ?: "") }

            if (currentServerId.isBlank() || currentUsername.isBlank() || currentProfileId.isBlank()) {
                _uiState.update { it.copy(state = UiState.Empty("No hay sesión activa")) }
                return@launch
            }

            // Cache-first then network refresh
            historyRepository.getCachedHistory(currentServerId, currentUsername, currentProfileId).collectLatest { cached ->
                if (cached.isNotEmpty() && _uiState.value.state !is UiState.Content) {
                    _uiState.update { it.copy(state = UiState.Content(cached)) }
                }

                val result = historyRepository.refreshHistory(currentServerId, currentUsername, currentProfileId)
                if (result.isSuccess) {
                    val list = result.getOrThrow()
                    if (list.isEmpty()) {
                        _uiState.update { it.copy(state = UiState.Empty("Aún no has visto ningún episodio")) }
                    } else {
                        _uiState.update { it.copy(state = UiState.Content(list)) }
                    }
                } else if (cached.isEmpty()) {
                    _uiState.update {
                        it.copy(state = UiState.Error(result.exceptionOrNull()?.message ?: "Error al cargar historial"))
                    }
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
