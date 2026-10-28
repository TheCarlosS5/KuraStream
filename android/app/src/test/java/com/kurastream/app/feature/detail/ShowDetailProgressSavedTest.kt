package com.kurastream.app.feature.detail

import androidx.lifecycle.SavedStateHandle
import com.kurastream.app.core.model.Episode
import com.kurastream.app.core.model.Show
import com.kurastream.app.core.model.ShowDetail
import com.kurastream.app.core.model.WatchHistoryItem
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.preferences.UserSessionPreferences
import com.kurastream.app.core.repository.CatalogRepository
import com.kurastream.app.core.repository.HistoryRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ShowDetailProgressSavedTest {

    private val testDispatcher = StandardTestDispatcher()
    private val catalogRepository = mockk<CatalogRepository>()
    private val historyRepository = mockk<HistoryRepository>()
    private val preferencesDataSource = mockk<KuraPreferencesDataSource>()
    private val progressSavedFlow = MutableSharedFlow<String>(extraBufferCapacity = 8)

    private val prefsFlow = MutableStateFlow(
        UserSessionPreferences(
            activeServerId = "server_1",
            activeServerUrl = "http://localhost:3000",
            activeUsername = "test_user",
            activeProfileId = "prof_1"
        )
    )

    private val testShow = Show(id = "show_1", title = "Show Test")
    private val testEpisode = Episode(id = "ep_1", seasonNumber = 1, episodeNumber = 1, showId = "show_1")
    private val testDetail = ShowDetail(
        show = testShow,
        episodes = listOf(testEpisode),
        seasons = mapOf(1 to listOf(testEpisode))
    )

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        every { preferencesDataSource.preferencesFlow } returns prefsFlow
        every { historyRepository.progressSaved } returns progressSavedFlow
        coEvery { catalogRepository.checkFavorite("show_1") } returns Result.success(false)
        coEvery { catalogRepository.getShowDetails("show_1") } returns Result.success(testDetail)
        coEvery { historyRepository.refreshHistory("server_1", "test_user", "prof_1") } returns Result.success(emptyList())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `progressSaved for show episode refreshes history immediately`() = runTest(testDispatcher) {
        val savedHandle = SavedStateHandle(mapOf("showId" to "show_1"))
        val viewModel = ShowDetailViewModel(
            savedStateHandle = savedHandle,
            catalogRepository = catalogRepository,
            historyRepository = historyRepository,
            preferencesDataSource = preferencesDataSource
        )
        testScheduler.advanceUntilIdle()

        // History initially empty
        assertEquals(emptyMap<String, Float>(), viewModel.uiState.value.episodeProgressMap)

        // Mock history after saving progress
        val updatedHistoryItem = WatchHistoryItem(
            episodeId = "ep_1",
            showId = "show_1",
            seasonNumber = 1,
            episodeNumber = 1,
            progressSeconds = 450f,
            duration = 1400f,
            completed = false,
            updatedAt = "2026-10-06 22:00:00"
        )
        coEvery { historyRepository.refreshHistory("server_1", "test_user", "prof_1") } returns Result.success(listOf(updatedHistoryItem))

        // Emit progressSaved for ep_1
        progressSavedFlow.emit("ep_1")
        testScheduler.advanceUntilIdle()

        // Verified: refreshHistory was called and UI state updated without waiting for fixed delay
        assertEquals(450f, viewModel.uiState.value.episodeProgressMap["ep_1"])
        assertEquals("ep_1", viewModel.uiState.value.resumeEpisode?.id)
    }

    @Test
    fun `progressSaved for another show does not trigger history refresh`() = runTest(testDispatcher) {
        val savedHandle = SavedStateHandle(mapOf("showId" to "show_1"))
        val viewModel = ShowDetailViewModel(
            savedStateHandle = savedHandle,
            catalogRepository = catalogRepository,
            historyRepository = historyRepository,
            preferencesDataSource = preferencesDataSource
        )
        testScheduler.advanceUntilIdle()

        coVerify(exactly = 1) { historyRepository.refreshHistory("server_1", "test_user", "prof_1") }

        // Emit progressSaved for an episode of another show
        progressSavedFlow.emit("other_ep")
        testScheduler.advanceUntilIdle()

        // Verified: no extra refreshHistory call was triggered
        coVerify(exactly = 1) { historyRepository.refreshHistory("server_1", "test_user", "prof_1") }
    }
}
