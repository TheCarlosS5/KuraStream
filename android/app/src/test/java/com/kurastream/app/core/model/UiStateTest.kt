package com.kurastream.app.core.model

import org.junit.Assert.*
import org.junit.Test

class UiStateTest {

    @Test
    fun `UiState transitions handle loading content error correctly`() {
        var state: UiState<String> = UiState.Loading
        assertTrue(state is UiState.Loading)

        state = UiState.Content("KuraStream data")
        assertTrue(state is UiState.Content)
        assertEquals("KuraStream data", (state as UiState.Content).data)

        state = UiState.Error("Network error", canRetry = true, code = 503)
        assertTrue(state is UiState.Error)
        assertEquals("Network error", (state as UiState.Error).message)
        assertEquals(503, (state as UiState.Error).code)
        assertTrue((state as UiState.Error).canRetry)

        state = UiState.Empty("Catálogo vacío")
        assertTrue(state is UiState.Empty)
        assertEquals("Catálogo vacío", (state as UiState.Empty).message)
    }

    @Test
    fun `WatchHistoryItem progress percentage and remaining seconds calculation`() {
        val item = WatchHistoryItem(
            episodeId = "ep1",
            showId = "show1",
            progressSeconds = 720f,
            duration = 1440f
        )
        assertEquals(50, item.progressPercentage)
        assertEquals(720, item.remainingSeconds)

        val completedItem = WatchHistoryItem(
            episodeId = "ep2",
            showId = "show1",
            progressSeconds = 1440f,
            duration = 1440f
        )
        assertEquals(100, completedItem.progressPercentage)
        assertEquals(0, completedItem.remainingSeconds)
    }
}
