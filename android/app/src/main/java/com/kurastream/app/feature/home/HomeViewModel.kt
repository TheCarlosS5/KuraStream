package com.kurastream.app.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kurastream.app.core.model.*
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.repository.CatalogRepository
import com.kurastream.app.core.repository.HistoryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HomeFeedData(
    val heroShow: Show? = null,
    val continueWatching: List<WatchHistoryItem> = emptyList(),
    val recentlyAdded: List<Show> = emptyList(),
    val animeList: List<Show> = emptyList(),
    val movieList: List<Show> = emptyList(),
    val airingList: List<Show> = emptyList(),
    val baseUrl: String = ""
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val catalogRepository: CatalogRepository,
    private val historyRepository: HistoryRepository,
    private val preferencesDataSource: KuraPreferencesDataSource
) : ViewModel() {

    private val _uiState = MutableStateFlow<UiState<HomeFeedData>>(UiState.Loading)
    val uiState: StateFlow<UiState<HomeFeedData>> = _uiState.asStateFlow()

    init {
        loadHomeData()
    }

    fun loadHomeData() {
        viewModelScope.launch {
            preferencesDataSource.preferencesFlow.collectLatest { prefs ->
                val serverId = prefs.activeServerId ?: return@collectLatest
                val serverUrl = prefs.activeServerUrl ?: ""
                val username = prefs.activeUsername ?: ""
                val profileId = prefs.activeProfileId ?: ""
                val isKids = prefs.isKidsMode

                // First try to load cached shows immediately for instant responsiveness
                catalogRepository.getCachedShows(serverId, isKids).collectLatest { cachedShows ->
                    if (cachedShows.isNotEmpty() && _uiState.value !is UiState.Content) {
                        emitContent(cachedShows, emptyList(), serverUrl)
                    }

                    // Refresh from network
                    val networkResult = catalogRepository.refreshCatalog(serverId, isKids)
                    val shows = networkResult.getOrDefault(cachedShows)

                    // Refresh history for continue watching
                    var historyItems = emptyList<WatchHistoryItem>()
                    if (username.isNotBlank() && profileId.isNotBlank()) {
                        val histRes = historyRepository.refreshHistory(serverId, username, profileId)
                        historyItems = histRes.getOrDefault(emptyList()).filter { !it.completed && it.progressSeconds > 10f }
                    }

                    if (shows.isEmpty() && historyItems.isEmpty()) {
                        _uiState.value = UiState.Empty("No hay contenido disponible en el catálogo")
                    } else {
                        emitContent(shows, historyItems, serverUrl)
                    }
                }
            }
        }
    }

    private fun emitContent(shows: List<Show>, continueWatching: List<WatchHistoryItem>, baseUrl: String) {
        val hero = shows.firstOrNull { it.backdropPath.isNotBlank() } ?: shows.firstOrNull()
        val airing = shows.filter { it.isAiring }
        val anime = shows.filter { it.mediaType.equals("anime", ignoreCase = true) }
        val movies = shows.filter { it.mediaType.equals("movie", ignoreCase = true) }
        val recent = shows.sortedByDescending { it.year ?: 0 }

        _uiState.value = UiState.Content(
            HomeFeedData(
                heroShow = hero,
                continueWatching = continueWatching,
                recentlyAdded = recent,
                animeList = anime,
                movieList = movies,
                airingList = airing,
                baseUrl = baseUrl
            )
        )
    }
}
