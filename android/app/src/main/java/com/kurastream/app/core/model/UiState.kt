package com.kurastream.app.core.model

/**
 * Standard UI state hierarchy for KuraStream screens.
 * Strictly avoids ambiguous nulls and ensures explicit state transitions.
 */
sealed interface UiState<out T> {
    data object Loading : UiState<Nothing>
    data class Content<T>(val data: T) : UiState<T>
    data class Empty(val message: String = "No hay contenido disponible") : UiState<Nothing>
    data class Error(val message: String, val canRetry: Boolean = true, val code: Int? = null) : UiState<Nothing>
    data class Refreshing<T>(val currentData: T) : UiState<T>
}
