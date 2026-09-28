package com.kurastream.app.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kurastream.app.core.model.*
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.repository.CatalogRepository
import com.kurastream.app.core.repository.HistoryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
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
    val baseUrl: String = "",
    val isRefreshing: Boolean = false
)

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

    private var currentServerId: String = ""
    private var currentServerUrl: String = ""
    private var currentUsername: String = ""
    private var currentProfileId: String = ""
    private var currentIsKids: Boolean = false

    init {
        observePreferencesAndInitialize()
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
            _notifications.update { list -> list.map { it.copy(isRead = true) } }
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
                historyRepository.getCachedHistory(serverId, username, profileId)
            ) { shows, historyItems ->
                val filteredHistory = historyItems.filter { !it.completed && it.progressSeconds > 10f }
                Pair(shows, filteredHistory)
            }.collect { (shows, historyItems) ->
                if (shows.isNotEmpty() || historyItems.isNotEmpty()) {
                    emitContent(shows, historyItems, serverUrl, isRefreshing = false)
                }
            }
        }
    }

    fun refresh() {
        if (currentServerId.isBlank()) return
        triggerNetworkRefresh(currentServerId, currentIsKids, currentUsername, currentProfileId)
    }

    fun loadHomeData() = refresh()

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
            var historyItems = emptyList<WatchHistoryItem>()
            if (username.isNotBlank() && profileId.isNotBlank()) {
                val histRes = historyRepository.refreshHistory(serverId, username, profileId)
                historyItems = histRes.getOrDefault(emptyList()).filter { !it.completed && it.progressSeconds > 10f }
            }

            val shows = catalogResult.getOrNull()
            if (shows != null) {
                if (shows.isEmpty() && historyItems.isEmpty()) {
                    _uiState.value = UiState.Empty("No hay contenido disponible en el catálogo de este servidor")
                } else {
                    emitContent(shows, historyItems, currentServerUrl, isRefreshing = false)
                }
            } else if (_uiState.value !is UiState.Content) {
                // If network failed and no cached data exists in UI state
                val err = catalogResult.exceptionOrNull()?.message ?: "Error al conectar con el servidor multimedia"
                _uiState.value = UiState.Error(err)
            } else if (currentContent != null) {
                _uiState.value = UiState.Content(currentContent.copy(isRefreshing = false))
            }
        }
    }

    private fun emitContent(
        shows: List<Show>,
        continueWatching: List<WatchHistoryItem>,
        baseUrl: String,
        isRefreshing: Boolean
    ) {
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
                baseUrl = baseUrl,
                isRefreshing = isRefreshing
            )
        )
    }
}
