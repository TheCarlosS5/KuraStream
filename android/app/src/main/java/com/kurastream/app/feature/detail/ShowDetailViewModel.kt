package com.kurastream.app.feature.detail

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kurastream.app.core.model.Episode
import com.kurastream.app.core.model.ShowDetail
import com.kurastream.app.core.model.UiState
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.repository.CatalogRepository
import com.kurastream.app.core.repository.HistoryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ShowDetailUiState(
    val detailState: UiState<ShowDetail> = UiState.Loading,
    val isFavorite: Boolean = false,
    val resumeEpisode: Episode? = null,
    val selectedSeason: Int = 1,
    val episodeProgressMap: Map<String, Float> = emptyMap(),
    val baseUrl: String = ""
)

@HiltViewModel
class ShowDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val catalogRepository: CatalogRepository,
    private val historyRepository: HistoryRepository,
    private val preferencesDataSource: KuraPreferencesDataSource
) : ViewModel() {

    private val showId: String = checkNotNull(savedStateHandle["showId"])

    private val _uiState = MutableStateFlow(ShowDetailUiState())
    val uiState: StateFlow<ShowDetailUiState> = _uiState.asStateFlow()

    init {
        loadDetails()
    }

    fun loadDetails() {
        _uiState.update { it.copy(detailState = UiState.Loading) }

        viewModelScope.launch {
            val prefs = preferencesDataSource.preferencesFlow.first()
            val baseUrl = prefs.activeServerUrl ?: ""
            _uiState.update { it.copy(baseUrl = baseUrl) }

            // Check favorite
            val favRes = catalogRepository.checkFavorite(showId)
            val isFav = favRes.getOrDefault(false)

            // Load show details
            val detailRes = catalogRepository.getShowDetails(showId)
            if (detailRes.isSuccess) {
                val detail = detailRes.getOrThrow()
                val seasons = detail.seasons.keys.sorted()
                val initialSeason = seasons.firstOrNull() ?: 1

                // Check user watch history for resume logic
                var resumeEp: Episode? = null
                val progressMap = mutableMapOf<String, Float>()

                if (!prefs.activeUsername.isNullOrBlank() && !prefs.activeProfileId.isNullOrBlank()) {
                    val histRes = historyRepository.refreshHistory(
                        serverId = prefs.activeServerId ?: "",
                        username = prefs.activeUsername,
                        profileId = prefs.activeProfileId
                    )
                    if (histRes.isSuccess) {
                        val historyItems = histRes.getOrThrow().filter { it.showId == showId }
                        historyItems.forEach { h ->
                            progressMap[h.episodeId] = h.progressSeconds
                        }
                        val latestHistory = historyItems.firstOrNull { !it.completed }
                        if (latestHistory != null) {
                            resumeEp = detail.episodes.firstOrNull { it.id == latestHistory.episodeId }
                        }
                    }
                }

                if (resumeEp == null) {
                    resumeEp = detail.episodes.firstOrNull()
                }

                _uiState.update {
                    it.copy(
                        detailState = UiState.Content(detail),
                        isFavorite = isFav,
                        selectedSeason = initialSeason,
                        resumeEpisode = resumeEp,
                        episodeProgressMap = progressMap
                    )
                }
            } else {
                _uiState.update {
                    it.copy(
                        detailState = UiState.Error(
                            detailRes.exceptionOrNull()?.message ?: "Error al cargar información del show"
                        )
                    )
                }
            }
        }
    }

    fun selectSeason(seasonNumber: Int) {
        _uiState.update { it.copy(selectedSeason = seasonNumber) }
    }

    fun toggleFavorite() {
        val current = _uiState.value.isFavorite
        _uiState.update { it.copy(isFavorite = !current) }

        viewModelScope.launch {
            val res = catalogRepository.toggleFavorite(showId)
            if (res.isFailure) {
                _uiState.update { it.copy(isFavorite = current) }
            }
        }
    }
}
