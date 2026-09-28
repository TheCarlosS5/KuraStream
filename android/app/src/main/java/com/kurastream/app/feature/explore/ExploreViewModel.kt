package com.kurastream.app.feature.explore

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kurastream.app.core.model.CalendarItem
import com.kurastream.app.core.model.Show
import com.kurastream.app.core.model.UiState
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.repository.CatalogRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class ExploreTab {
    CATALOG, CALENDAR
}

enum class TypeFilter(val label: String, val queryValue: String) {
    ALL("Todos", "all"),
    ANIME("Anime", "anime"),
    MOVIE("Películas", "movie")
}

enum class StatusFilter(val label: String) {
    ALL("Cualquiera"),
    AIRING("En emisión"),
    FINISHED("Finalizado")
}

data class ExploreUiState(
    val activeTab: ExploreTab = ExploreTab.CATALOG,
    val searchQuery: String = "",
    val typeFilter: TypeFilter = TypeFilter.ALL,
    val statusFilter: StatusFilter = StatusFilter.ALL,
    val selectedGenre: String? = null,
    val catalogState: UiState<List<Show>> = UiState.Loading,
    val calendarState: UiState<Map<String, List<CalendarItem>>> = UiState.Loading,
    val availableGenres: List<String> = emptyList(),
    val baseUrl: String = "",
    val isRefreshing: Boolean = false
)

@OptIn(FlowPreview::class)
@HiltViewModel
class ExploreViewModel @Inject constructor(
    private val catalogRepository: CatalogRepository,
    private val preferencesDataSource: KuraPreferencesDataSource
) : ViewModel() {

    private val _uiState = MutableStateFlow(ExploreUiState())
    val uiState: StateFlow<ExploreUiState> = _uiState.asStateFlow()

    private val searchQueryFlow = MutableStateFlow("")
    private var allCatalogShows = listOf<Show>()

    private var cacheObservationJob: Job? = null
    private var networkRefreshJob: Job? = null

    private var currentServerId: String = ""
    private var currentUsername: String = ""
    private var currentProfileId: String = ""
    private var currentIsKids: Boolean = false

    init {
        observePreferencesAndInitialize()

        viewModelScope.launch {
            searchQueryFlow
                .debounce(300)
                .collectLatest {
                    applyFilters()
                }
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

                _uiState.update { it.copy(baseUrl = serverUrl) }

                val sessionChanged = serverId != currentServerId || username != currentUsername || isKids != currentIsKids || profileId != currentProfileId
                currentServerId = serverId
                currentUsername = username
                currentProfileId = profileId
                currentIsKids = isKids

                if (sessionChanged) {
                    _uiState.update { it.copy(catalogState = UiState.Loading) }
                    startCacheObservation(serverId, username, profileId, isKids)
                    triggerNetworkRefresh(serverId, username, profileId, isKids)
                }
            }
        }
    }

    private fun startCacheObservation(serverId: String, username: String, profileId: String, isKids: Boolean) {
        cacheObservationJob?.cancel()
        cacheObservationJob = viewModelScope.launch {
            catalogRepository.getCachedShows(serverId, username, profileId, isKids).collect { cachedShows ->
                allCatalogShows = cachedShows
                extractGenres(cachedShows)
                applyFilters()
            }
        }
    }

    fun refresh() {
        if (currentServerId.isBlank()) return
        triggerNetworkRefresh(currentServerId, currentUsername, currentProfileId, currentIsKids)
    }

    fun loadData() = refresh()

    private fun triggerNetworkRefresh(serverId: String, username: String, profileId: String, isKids: Boolean) {
        networkRefreshJob?.cancel()
        networkRefreshJob = viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true) }
            val refreshRes = catalogRepository.refreshCatalog(serverId, username, profileId, isKids)
            _uiState.update { it.copy(isRefreshing = false) }

            if (refreshRes.isFailure && allCatalogShows.isEmpty()) {
                _uiState.update {
                    it.copy(catalogState = UiState.Error(refreshRes.exceptionOrNull()?.message ?: "Error al actualizar catálogo"))
                }
            }
        }
    }

    fun setTab(tab: ExploreTab) {
        _uiState.update { it.copy(activeTab = tab) }
        if (tab == ExploreTab.CALENDAR && _uiState.value.calendarState !is UiState.Content) {
            loadCalendar()
        }
    }

    fun onSearchQueryChanged(newQuery: String) {
        _uiState.update { it.copy(searchQuery = newQuery) }
        searchQueryFlow.value = newQuery
    }

    fun setTypeFilter(filter: TypeFilter) {
        _uiState.update { it.copy(typeFilter = filter) }
        applyFilters()
    }

    fun setStatusFilter(filter: StatusFilter) {
        _uiState.update { it.copy(statusFilter = filter) }
        applyFilters()
    }

    fun setGenreFilter(genre: String?) {
        val next = if (_uiState.value.selectedGenre == genre) null else genre
        _uiState.update { it.copy(selectedGenre = next) }
        applyFilters()
    }

    fun surpriseMe(onShowFound: (String) -> Unit) {
        viewModelScope.launch {
            val random = catalogRepository.getRandomShow()
            if (random.isSuccess) {
                onShowFound(random.getOrThrow().id)
            } else if (allCatalogShows.isNotEmpty()) {
                onShowFound(allCatalogShows.random().id)
            }
        }
    }

    private fun loadCalendar() {
        _uiState.update { it.copy(calendarState = UiState.Loading) }
        viewModelScope.launch {
            val res = catalogRepository.getCalendarSchedule()
            if (res.isSuccess) {
                val data = res.getOrThrow()
                if (data.isEmpty() || data.values.all { it.isEmpty() }) {
                    _uiState.update { it.copy(calendarState = UiState.Empty("No hay emisiones programadas esta semana")) }
                } else {
                    _uiState.update { it.copy(calendarState = UiState.Content(data)) }
                }
            } else {
                _uiState.update {
                    it.copy(calendarState = UiState.Error(res.exceptionOrNull()?.message ?: "Error al cargar calendario"))
                }
            }
        }
    }

    private fun extractGenres(shows: List<Show>) {
        val genres = shows.flatMap { it.genreList }.distinct().sorted()
        _uiState.update { it.copy(availableGenres = genres) }
    }

    private fun applyFilters() {
        val query = _uiState.value.searchQuery.trim().lowercase()
        val type = _uiState.value.typeFilter
        val status = _uiState.value.statusFilter
        val genre = _uiState.value.selectedGenre

        var filtered = allCatalogShows

        if (query.isNotBlank()) {
            filtered = filtered.filter {
                it.title.lowercase().contains(query) ||
                        it.genres.lowercase().contains(query) ||
                        it.synopsis.lowercase().contains(query)
            }
        }

        if (type != TypeFilter.ALL) {
            filtered = filtered.filter { it.mediaType.equals(type.queryValue, ignoreCase = true) }
        }

        if (status != StatusFilter.ALL) {
            when (status) {
                StatusFilter.AIRING -> filtered = filtered.filter { it.isAiring }
                StatusFilter.FINISHED -> filtered = filtered.filter { !it.isAiring }
                else -> {}
            }
        }

        if (!genre.isNullOrBlank()) {
            filtered = filtered.filter { it.genreList.any { g -> g.equals(genre, ignoreCase = true) } }
        }

        if (filtered.isEmpty()) {
            if (_uiState.value.catalogState !is UiState.Loading) {
                _uiState.update { it.copy(catalogState = UiState.Empty("No se encontraron coincidencias")) }
            }
        } else {
            _uiState.update { it.copy(catalogState = UiState.Content(filtered)) }
        }
    }
}
