package com.kurastream.app.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kurastream.app.core.model.*
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.repository.CatalogRepository
import com.kurastream.app.core.repository.HistoryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HomeFeedData(
    val heroShow: Show? = null,
    /** Up to 5 billboard candidates for the hero carousel (first == heroShow). */
    val heroShows: List<Show> = emptyList(),
    val continueWatching: List<WatchHistoryItem> = emptyList(),
    val recentlyAdded: List<Show> = emptyList(),
    val animeList: List<Show> = emptyList(),
    val movieList: List<Show> = emptyList(),
    val airingList: List<Show> = emptyList(),
    val baseUrl: String = "",
    val isRefreshing: Boolean = false
)

@OptIn(FlowPreview::class)
@HiltViewModel
class HomeViewModel @Inject constructor(
    private val catalogRepository: CatalogRepository,
    private val historyRepository: HistoryRepository,
    private val preferencesDataSource: KuraPreferencesDataSource
) : ViewModel() {

    private val _uiState = MutableStateFlow<UiState<HomeFeedData>>(UiState.Loading)
    val uiState: StateFlow<UiState<HomeFeedData>> = _uiState.asStateFlow()

    private val _notifications = MutableStateFlow<List<com.kurastream.app.core.network.dto.NotificationItemDto>>(emptyList())
    val notifications: StateFlow<List<com.kurastream.app.core.network.dto.NotificationItemDto>> = _notifications.asStateFlow()

    private val _unreadCount = MutableStateFlow(0)
    val unreadCount: StateFlow<Int> = _unreadCount.asStateFlow()

    private var cacheObservationJob: Job? = null
    private var networkRefreshJob: Job? = null
    private var historyRefreshJob: Job? = null

    /** Last /api/history/continue answer for the current profile; null until one arrives. */
    private val serverContinue = MutableStateFlow<List<WatchHistoryItem>?>(null)

    private var currentServerId: String = ""
    private var currentServerUrl: String = ""
    private var currentUsername: String = ""
    private var currentProfileId: String = ""
    private var currentIsKids: Boolean = false

    init {
        observePreferencesAndInitialize()
        // The profile's saved preferences (set on the web or on another phone) apply on this device too.
        viewModelScope.launch {
            historyRepository.getUserPreferences().onSuccess { server ->
                preferencesDataSource.applyServerPreferences(
                    autoSkipIntro = server.autoSkipIntro,
                    autoPlayNext = server.autoPlayNext,
                    audioLang = server.preferredAudioLanguage,
                    subLang = server.preferredSubtitleLanguage
                )
            }
        }
        // The player saves on exit from a detached scope; refresh once that save has landed
        // (a fixed delay raced it and the row looked like nothing had been saved).
        viewModelScope.launch {
            historyRepository.progressSaved
                .debounce(400)
                .collect { refreshContinueWatching() }
        }
    }

    fun loadNotifications() {
        viewModelScope.launch {
            val res = catalogRepository.getNotifications()
            if (res.isSuccess) {
                val data = res.getOrThrow()
                _notifications.value = data.notifications
                _unreadCount.value = data.unreadCount
            }
        }
    }

    fun markNotificationsSeen() {
        viewModelScope.launch {
            catalogRepository.markNotificationsSeen()
            _unreadCount.value = 0
            _notifications.update { list -> list.map { it.copy(isUnread = false) } }
        }
    }

    private fun observePreferencesAndInitialize() {
        viewModelScope.launch {
            preferencesDataSource.preferencesFlow.collectLatest { prefs ->
                val serverId = prefs.activeServerId ?: return@collectLatest
                val serverUrl = prefs.activeServerUrl ?: ""
                val username = prefs.activeUsername ?: ""
                val profileId = prefs.activeProfileId ?: ""
                val isKids = prefs.isKidsMode

                val sessionChanged = serverId != currentServerId ||
                        username != currentUsername ||
                        profileId != currentProfileId ||
                        isKids != currentIsKids

                currentServerId = serverId
                currentServerUrl = serverUrl
                currentUsername = username
                currentProfileId = profileId
                currentIsKids = isKids

                if (sessionChanged) {
                    // Reset UI to Loading when switching servers or profiles to prevent leakage
                    _uiState.value = UiState.Loading
                    serverContinue.value = null
                    startCacheObservation(serverId, isKids, username, profileId, serverUrl)
                    triggerNetworkRefresh(serverId, isKids, username, profileId)
                }
            }
        }
    }

    private fun startCacheObservation(
        serverId: String,
        isKids: Boolean,
        username: String,
        profileId: String,
        serverUrl: String
    ) {
        cacheObservationJob?.cancel()
        cacheObservationJob = viewModelScope.launch {
            combine(
                catalogRepository.getCachedShows(serverId, username, profileId, isKids),
                historyRepository.getCachedHistory(serverId, username, profileId),
                serverContinue,
                preferencesDataSource.dismissedContinueFlow
            ) { shows, historyItems, fromServer, dismissed ->
                // Offline (no server answer yet) the cached history stands in, with the same rules.
                val rows = fromServer ?: ContinueWatchingRules.fromHistory(historyItems)
                Pair(shows, rows.filterNot { "$profileId|${it.episodeId}" in dismissed })
            }.collect { (shows, continueItems) ->
                if (shows.isNotEmpty() || continueItems.isNotEmpty()) {
                    emitContent(shows, continueItems, serverUrl, isRefreshing = false)
                }
            }
        }
    }

    fun refresh() {
        if (currentServerId.isBlank()) return
        triggerNetworkRefresh(currentServerId, currentIsKids, currentUsername, currentProfileId)
    }

    fun loadHomeData() = refresh()

    /** Long-press "Quitar de Continuar viendo": hides that card for this profile (history is kept). */
    fun removeFromContinueWatching(episodeId: String) {
        if (currentProfileId.isBlank()) return
        viewModelScope.launch {
            preferencesDataSource.dismissContinueEntry("$currentProfileId|$episodeId")
        }
    }

    /**
     * Resolves what "Reproducir" in the hero should open: the profile's unfinished episode of the
     * show, otherwise its first episode. Calls [onEpisode] with the episode id, or [onFallback]
     * when the episodes cannot be loaded (the detail page is shown instead).
     */
    fun playShow(showId: String, onEpisode: (String) -> Unit, onFallback: () -> Unit) {
        val content = (_uiState.value as? UiState.Content)?.data
        val resume = content?.continueWatching?.firstOrNull { it.showId == showId }
        if (resume != null) {
            onEpisode(resume.episodeId)
            return
        }
        viewModelScope.launch {
            val first = catalogRepository.getShowDetails(showId).getOrNull()?.let { EpisodeOrder.first(it.episodes) }
            if (first != null) onEpisode(first.id) else onFallback()
        }
    }

    /** Re-fetches "Continuar viendo" quietly (no spinner, no catalog reload). */
    fun refreshContinueWatching() {
        if (currentServerId.isBlank() || currentUsername.isBlank() || currentProfileId.isBlank()) return
        if (networkRefreshJob?.isActive == true) return
        historyRefreshJob?.cancel()
        historyRefreshJob = viewModelScope.launch {
            delay(300)
            loadServerContinue()
            historyRepository.refreshHistory(currentServerId, currentUsername, currentProfileId)
        }
    }

    private suspend fun loadServerContinue() {
        historyRepository.getContinueWatching().onSuccess { serverContinue.value = it }
    }

    private fun triggerNetworkRefresh(
        serverId: String,
        isKids: Boolean,
        username: String,
        profileId: String
    ) {
        networkRefreshJob?.cancel()
        networkRefreshJob = viewModelScope.launch {
            val currentContent = (_uiState.value as? UiState.Content)?.data
            if (currentContent != null) {
                _uiState.value = UiState.Content(currentContent.copy(isRefreshing = true))
            }

            loadNotifications()
            val catalogResult = catalogRepository.refreshCatalog(serverId, username, profileId, isKids)
            var continueItems = emptyList<WatchHistoryItem>()
            if (username.isNotBlank() && profileId.isNotBlank()) {
                val histRes = historyRepository.refreshHistory(serverId, username, profileId)
                loadServerContinue()
                continueItems = serverContinue.value ?: ContinueWatchingRules.fromHistory(histRes.getOrDefault(emptyList()))
            }
            val dismissed = preferencesDataSource.dismissedContinueFlow.first()
            continueItems = continueItems.filterNot { "$profileId|${it.episodeId}" in dismissed }

            val shows = catalogResult.getOrNull()
            if (shows != null) {
                if (shows.isEmpty() && continueItems.isEmpty()) {
                    _uiState.value = UiState.Empty("No hay contenido disponible en el catálogo de este servidor")
                } else {
                    emitContent(shows, continueItems, currentServerUrl, isRefreshing = false)
                }
            } else if (_uiState.value !is UiState.Content) {
                // If network failed and no cached data exists in UI state
                val err = catalogResult.exceptionOrNull()?.message ?: "Error al conectar con el servidor multimedia"
                _uiState.value = UiState.Error(err)
            } else {
                val currentState = _uiState.value as? UiState.Content
                if (currentState != null) {
                    _uiState.value = UiState.Content(currentState.data.copy(isRefreshing = false))
                }
            }
        }
    }

    /**
     * Up to five billboard titles: artwork first, then rating, recent additions and airing status,
     * rotated once a day so the home screen does not always open on the same show.
     */
    private fun pickHeroShows(shows: List<Show>): List<Show> {
        val candidates = shows
            .filter { it.backdropPath.isNotBlank() }
            .sortedWith(compareByDescending<Show> { it.rating + (if (it.isAiring) 1f else 0f) })
            .take(10)
        if (candidates.isEmpty()) return listOfNotNull(shows.firstOrNull())
        val day = (System.currentTimeMillis() / 86_400_000L).toInt()
        val offset = day % candidates.size
        return (candidates.drop(offset) + candidates.take(offset)).take(5)
    }

    private fun emitContent(
        shows: List<Show>,
        continueWatching: List<WatchHistoryItem>,
        baseUrl: String,
        isRefreshing: Boolean
    ) {
        val heroes = pickHeroShows(shows)
        val hero = heroes.firstOrNull()
        val airing = shows.filter { it.isAiring }
        val anime = shows.filter { it.mediaType.equals("anime", ignoreCase = true) }
        val movies = shows.filter { it.mediaType.equals("movie", ignoreCase = true) }
        val recent = shows.sortedByDescending { it.year ?: 0 }

        _uiState.value = UiState.Content(
            HomeFeedData(
                heroShow = hero,
                heroShows = heroes,
                continueWatching = continueWatching,
                recentlyAdded = recent,
                animeList = anime,
                movieList = movies,
                airingList = airing,
                baseUrl = baseUrl,
                isRefreshing = isRefreshing
            )
        )
    }
}
