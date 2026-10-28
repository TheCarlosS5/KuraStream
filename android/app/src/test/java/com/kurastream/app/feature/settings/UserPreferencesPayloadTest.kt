package com.kurastream.app.feature.settings

import com.kurastream.app.core.di.AppModule
import com.kurastream.app.core.model.UserPreferences
import com.kurastream.app.core.model.UserPreferencesPatch
import com.kurastream.app.core.network.KuraApiService
import com.kurastream.app.core.network.dto.BaseResponseDto
import com.kurastream.app.core.network.dto.UserPreferencesDto
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.preferences.UserSessionPreferences
import com.kurastream.app.core.repository.HistoryRepository
import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class UserPreferencesPayloadTest {

    private val testDispatcher = StandardTestDispatcher()
    private val json = AppModule.provideJson()
    private val historyRepository = mockk<HistoryRepository>(relaxed = true)
    private val preferencesDataSource = mockk<KuraPreferencesDataSource>(relaxed = true)

    private val prefsFlow = MutableStateFlow(
        UserSessionPreferences(
            preferredAudioLanguage = "jpn",
            preferredSubtitleLanguage = "spa"
        )
    )

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        every { preferencesDataSource.preferencesFlow } returns prefsFlow
        coEvery { historyRepository.getUserStats() } returns Result.failure(IllegalStateException("offline"))
        coEvery { historyRepository.saveUserPreferences(any()) } returns Result.success(Unit)
        coEvery { historyRepository.patchUserPreferences(any()) } returns Result.success(Unit)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `serialization of partial UserPreferencesDto omits null fields from json`() {
        val dto = UserPreferencesDto(preferredAudioLanguage = "es-419")
        val jsonString = json.encodeToString(UserPreferencesDto.serializer(), dto)

        assertTrue(jsonString.contains(""""preferred_audio_language":"es-419""""))
        assertFalse(jsonString.contains("auto_skip_intro"))
        assertFalse(jsonString.contains("auto_play_next"))
        assertFalse(jsonString.contains("preferred_subtitle_language"))
        assertFalse(jsonString.contains("audio_boost"))
        assertFalse(jsonString.contains("audio_preset"))
    }

    @Test
    fun `setPreferredAudio sends a patch with only preferredAudioLanguage`() = runTest(testDispatcher) {
        val viewModel = SettingsViewModel(
            context = mockk(relaxed = true),
            authRepository = mockk(relaxed = true),
            historyRepository = historyRepository,
            catalogShowDao = mockk(relaxed = true),
            preferencesDataSource = preferencesDataSource
        )
        testScheduler.advanceUntilIdle()

        viewModel.setPreferredAudio("es-419")
        testScheduler.advanceUntilIdle()

        val slot = slot<UserPreferencesPatch>()
        coVerify { historyRepository.patchUserPreferences(capture(slot)) }

        val captured = slot.captured
        assertEquals("es-419", captured.preferredAudioLanguage)
        assertNull(captured.autoSkipIntro)
        assertNull(captured.autoPlayNext)
        assertNull(captured.preferredSubtitleLanguage)
        assertNull(captured.audioBoost)
        assertNull(captured.audioPreset)
    }

    @Test
    fun `historyRepository saveUserPreferences forwards only non-null fields to apiService`() = runTest {
        val apiService = mockk<KuraApiService>()
        val historyDao = mockk<com.kurastream.app.core.database.HistoryDao>(relaxed = true)
        val repo = HistoryRepository(apiService, historyDao)

        val dtoSlot = slot<UserPreferencesDto>()
        coEvery { apiService.saveUserPreferences(capture(dtoSlot)) } returns BaseResponseDto(success = true)

        repo.saveUserPreferences(UserPreferences(preferredSubtitleLanguage = "en"))

        val capturedDto = dtoSlot.captured
        assertEquals("en", capturedDto.preferredSubtitleLanguage)
        assertNull(capturedDto.preferredAudioLanguage)
        assertNull(capturedDto.autoSkipIntro)
        assertNull(capturedDto.autoPlayNext)
    }
}
