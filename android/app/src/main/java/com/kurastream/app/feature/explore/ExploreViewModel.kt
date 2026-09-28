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
    val baseUrl: String = ""
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

    init {
        loadData()

        viewModelScope.launch {
            searchQueryFlow
                .debounce(300)
                .collectLatest { query ->
                    applyFilters()
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

    fun loadData() {
        viewModelScope.launch {
            preferencesDataSource.preferencesFlow.collectLatest { prefs ->
                val serverId = prefs.activeServerId ?: return@collectLatest
                val serverUrl = prefs.activeServerUrl ?: ""
                val isKids = prefs.isKidsMode

                _uiState.update { it.copy(baseUrl = serverUrl) }

                catalogRepository.getCachedShows(serverId, isKids).collectLatest { cachedShows ->
                    allCatalogShows = cachedShows
                    extractGenres(cachedShows)
                    applyFilters()

                    // Background network refresh
                    val refreshRes = catalogRepository.refreshCatalog(serverId, isKids)
                    if (refreshRes.isSuccess) {
                        allCatalogShows = refreshRes.getOrThrow()
                        extractGenres(allCatalogShows)
                        applyFilters()
                    }
                }
            }
        }
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
            _uiState.update { it.copy(catalogState = UiState.Empty("No se encontraron coincidencias")) }
        } else {
            _uiState.update { it.copy(catalogState = UiState.Content(filtered)) }
        }
    }
}
