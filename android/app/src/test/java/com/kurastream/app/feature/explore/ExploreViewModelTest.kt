package com.kurastream.app.feature.explore

import com.kurastream.app.core.model.Show
import com.kurastream.app.core.model.UiState
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.preferences.UserSessionPreferences
import com.kurastream.app.core.repository.CatalogRepository
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ExploreViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private val catalogRepository = mockk<CatalogRepository>()
    private val preferencesDataSource = mockk<KuraPreferencesDataSource>()

    private val prefsFlow = MutableStateFlow(
        UserSessionPreferences(
            activeServerId = "server1",
            activeServerUrl = "http://localhost:3000",
            activeUsername = "test_user",
            activeProfileId = "prof_1",
            isKidsMode = false
        )
    )

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        every { preferencesDataSource.preferencesFlow } returns prefsFlow
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `empty dao flow and api returning empty list publishes Empty state and isRefreshing false`() = runTest(testDispatcher) {
        every { catalogRepository.getCachedShows("server1", "test_user", "prof_1", false) } returns flowOf(emptyList())
        coEvery { catalogRepository.refreshCatalog("server1", "test_user", "prof_1", false) } returns Result.success(emptyList())

        val viewModel = ExploreViewModel(catalogRepository, preferencesDataSource)

        testScheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.isRefreshing)
        assertTrue(state.catalogState is UiState.Empty)
        assertEquals("El catálogo está vacío", (state.catalogState as UiState.Empty).message)
    }

    @Test
    fun `cached shows present with non-matching filter publishes Empty during initial loading`() = runTest(testDispatcher) {
        val cached = listOf(
            Show(id = "1", title = "Attack on Titan", genres = "Action")
        )
        every { catalogRepository.getCachedShows("server1", "test_user", "prof_1", false) } returns flowOf(cached)
        coEvery { catalogRepository.refreshCatalog("server1", "test_user", "prof_1", false) } coAnswers {
            delay(10_000)
            Result.success(cached)
        }

        val viewModel = ExploreViewModel(catalogRepository, preferencesDataSource)
        testScheduler.runCurrent()

        assertTrue(viewModel.uiState.value.catalogState is UiState.Content)

        viewModel.onSearchQueryChanged("NonExistent")
        testScheduler.advanceTimeBy(350)
        testScheduler.runCurrent()

        val state = viewModel.uiState.value
        assertTrue(state.catalogState is UiState.Empty)
        assertEquals("No se encontraron coincidencias", (state.catalogState as UiState.Empty).message)
    }

    @Test
    fun `when refresh finishes with failure but cache exists filters are reapplied`() = runTest(testDispatcher) {
        val cached = listOf(
            Show(id = "1", title = "Attack on Titan", genres = "Action")
        )
        every { catalogRepository.getCachedShows("server1", "test_user", "prof_1", false) } returns flowOf(cached)
        coEvery { catalogRepository.refreshCatalog("server1", "test_user", "prof_1", false) } returns Result.failure(Exception("network error"))

        val viewModel = ExploreViewModel(catalogRepository, preferencesDataSource)
        testScheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.isRefreshing)
        assertTrue(state.catalogState is UiState.Content)
        val content = state.catalogState as UiState.Content
        assertEquals(1, content.data.size)
        assertEquals("Attack on Titan", content.data.first().title)
    }
}
