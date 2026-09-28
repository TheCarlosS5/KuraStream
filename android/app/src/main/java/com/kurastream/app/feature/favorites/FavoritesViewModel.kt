package com.kurastream.app.feature.favorites

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kurastream.app.core.model.Show
import com.kurastream.app.core.model.UiState
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.repository.CatalogRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class FavoritesViewModel @Inject constructor(
    private val catalogRepository: CatalogRepository,
    private val preferencesDataSource: KuraPreferencesDataSource
) : ViewModel() {

    private val _uiState = MutableStateFlow<UiState<List<Show>>>(UiState.Loading)
    val uiState: StateFlow<UiState<List<Show>>> = _uiState.asStateFlow()

    private val _baseUrl = MutableStateFlow("")
    val baseUrl: StateFlow<String> = _baseUrl.asStateFlow()

    init {
        loadFavorites()
    }

    fun loadFavorites() {
        _uiState.value = UiState.Loading
        viewModelScope.launch {
            val prefs = preferencesDataSource.preferencesFlow.first()
            _baseUrl.value = prefs.activeServerUrl ?: ""

            val result = catalogRepository.getFavorites()
            if (result.isSuccess) {
                val list = result.getOrThrow()
                if (list.isEmpty()) {
                    _uiState.value = UiState.Empty("Aún no tienes series o películas en Mi Lista")
                } else {
                    _uiState.value = UiState.Content(list)
                }
            } else {
                _uiState.value = UiState.Error(
                    result.exceptionOrNull()?.message ?: "Error al cargar Mi Lista"
                )
            }
        }
    }

    fun removeFavorite(showId: String) {
        val current = (_uiState.value as? UiState.Content)?.data ?: return
        val updated = current.filter { it.id != showId }

        // Optimistic update
        _uiState.value = if (updated.isEmpty()) {
            UiState.Empty("Aún no tienes series o películas en Mi Lista")
        } else {
            UiState.Content(updated)
        }

        viewModelScope.launch {
            val res = catalogRepository.toggleFavorite(showId)
            if (res.isFailure) {
                // Rollback on failure
                _uiState.value = UiState.Content(current)
            }
        }
    }
}
