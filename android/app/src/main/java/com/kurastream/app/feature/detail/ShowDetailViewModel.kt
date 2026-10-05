package com.kurastream.app.feature.detail

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kurastream.app.core.model.Episode
import com.kurastream.app.core.model.ShowDetail
import com.kurastream.app.core.model.UiState
import com.kurastream.app.core.model.WatchHistoryItem
import com.kurastream.app.core.network.dto.CommentDto
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.repository.CatalogRepository
import com.kurastream.app.core.repository.HistoryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ShowDetailUiState(
    val detailState: UiState<ShowDetail> = UiState.Loading,
    val isFavorite: Boolean = false,
    val resumeEpisode: Episode? = null,
    val selectedSeason: Int = 1,
    val episodeProgressMap: Map<String, Float> = emptyMap(),
    val episodeCompletedMap: Map<String, Boolean> = emptyMap(),
    val baseUrl: String = "",
    val comments: List<CommentDto> = emptyList(),
    val commentsLoaded: Boolean = false,
    val commentsLoading: Boolean = false,
    val commentsError: String? = null,
    val commentDraft: String = "",
    val isPostingComment: Boolean = false
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

    private var historyRefreshJob: Job? = null

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
                val seasons = detail.orderedSeasons

                val history = if (!prefs.activeUsername.isNullOrBlank() && !prefs.activeProfileId.isNullOrBlank()) {
                    historyRepository.refreshHistory(
                        serverId = prefs.activeServerId ?: "",
                        username = prefs.activeUsername,
                        profileId = prefs.activeProfileId
                    ).getOrNull()?.filter { it.showId == showId }.orEmpty()
                } else {
                    emptyList()
                }
                val resumeEp = pickResumeEpisode(detail.episodes, history)
                // Open on the season of the episode the play button points at.
                val initialSeason = resumeEp?.seasonNumber?.takeIf { it in seasons } ?: seasons.firstOrNull() ?: 1

                _uiState.update {
                    it.copy(
                        detailState = UiState.Content(detail),
                        isFavorite = isFav,
                        selectedSeason = initialSeason,
                        resumeEpisode = resumeEp,
                        episodeProgressMap = history.associate { h -> h.episodeId to h.progressSeconds },
                        episodeCompletedMap = history.associate { h -> h.episodeId to h.completed }
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

    /** Comments load on demand (the first time the section opens), not for every visit to the page. */
    fun loadComments() {
        if (_uiState.value.commentsLoading) return
        _uiState.update { it.copy(commentsLoading = true, commentsError = null) }
        viewModelScope.launch {
            val res = catalogRepository.getComments(showId)
            _uiState.update {
                if (res.isSuccess) it.copy(comments = res.getOrThrow(), commentsLoaded = true, commentsLoading = false)
                else it.copy(commentsLoading = false, commentsError = res.exceptionOrNull()?.message ?: "No se pudieron cargar los comentarios")
            }
        }
    }

    fun onCommentDraftChanged(text: String) {
        if (text.length <= MAX_COMMENT_LENGTH) _uiState.update { it.copy(commentDraft = text) }
    }

    fun postComment() {
        val text = _uiState.value.commentDraft.trim()
        if (text.isEmpty() || _uiState.value.isPostingComment) return
        _uiState.update { it.copy(isPostingComment = true, commentsError = null) }
        viewModelScope.launch {
            val res = catalogRepository.addComment(showId, text)
            if (res.isSuccess) {
                _uiState.update { it.copy(isPostingComment = false, commentDraft = "") }
                loadComments()
            } else {
                _uiState.update { it.copy(isPostingComment = false, commentsError = res.exceptionOrNull()?.message) }
            }
        }
    }

    fun deleteComment(id: String) {
        viewModelScope.launch {
            val res = catalogRepository.deleteComment(id)
            if (res.isSuccess) {
                _uiState.update { s -> s.copy(comments = s.comments.filterNot { it.id == id }) }
            } else {
                _uiState.update { it.copy(commentsError = res.exceptionOrNull()?.message) }
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

    /**
     * Re-reads progress when the screen comes back from the player, without the full-screen loader.
     * The player saves its final position while it is being torn down, which overlaps with this
     * screen resuming, so the fetch waits a moment to see that save.
     */
    fun refreshHistory() {
        val detail = (_uiState.value.detailState as? UiState.Content)?.data ?: return
        historyRefreshJob?.cancel()
        historyRefreshJob = viewModelScope.launch {
            delay(HISTORY_REFRESH_DELAY_MS)
            val prefs = preferencesDataSource.preferencesFlow.first()
            if (prefs.activeUsername.isNullOrBlank() || prefs.activeProfileId.isNullOrBlank()) return@launch

            val history = historyRepository.refreshHistory(
                serverId = prefs.activeServerId ?: "",
                username = prefs.activeUsername,
                profileId = prefs.activeProfileId
            ).getOrNull()?.filter { it.showId == showId } ?: return@launch

            _uiState.update {
                it.copy(
                    resumeEpisode = pickResumeEpisode(detail.episodes, history),
                    episodeProgressMap = history.associate { h -> h.episodeId to h.progressSeconds },
                    episodeCompletedMap = history.associate { h -> h.episodeId to h.completed }
                )
            }
        }
    }

    /**
     * Netflix-style target for the play button: the most recently watched episode (history comes
     * newest first) if unfinished, otherwise the one after it; the first episode when there is no
     * history or the show was finished.
     */
    private fun pickResumeEpisode(episodes: List<Episode>, history: List<WatchHistoryItem>): Episode? {
        val ordered = episodes.sortedWith(compareBy({ it.seasonNumber }, { it.episodeNumber }))
        val latest = history.firstOrNull() ?: return ordered.firstOrNull()
        val idx = ordered.indexOfFirst { it.id == latest.episodeId }
        if (idx < 0) return ordered.firstOrNull()
        if (!latest.completed) return ordered[idx]
        return ordered.getOrNull(idx + 1) ?: ordered.firstOrNull()
    }

    private companion object {
        const val HISTORY_REFRESH_DELAY_MS = 800L
        const val MAX_COMMENT_LENGTH = 1000
    }
}
