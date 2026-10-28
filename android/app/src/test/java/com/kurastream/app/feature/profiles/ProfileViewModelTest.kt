package com.kurastream.app.feature.profiles

import com.kurastream.app.core.model.Profile
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.preferences.UserSessionPreferences
import com.kurastream.app.core.repository.AuthRepository
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
class ProfileViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private val authRepository = mockk<AuthRepository>()
    private val preferencesDataSource = mockk<KuraPreferencesDataSource>()

    private val prefsFlow = MutableStateFlow(
        UserSessionPreferences(
            activeServerId = "server1",
            activeServerUrl = "http://localhost:3000",
            activeUsername = "test_user"
        )
    )

    private val profileWithoutPin = Profile(
        id = "prof_1",
        username = "test_user",
        name = "Profile 1",
        color = "#818CF8",
        hasPin = false
    )

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        every { preferencesDataSource.preferencesFlow } returns prefsFlow
        coEvery { authRepository.getProfiles() } returns Result.success(listOf(profileWithoutPin))
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `profile without PIN selection failure shows general error without navigation`() = runTest(testDispatcher) {
        coEvery { authRepository.selectProfile(profileWithoutPin.id, null) } returns Result.failure(Exception("Error de red"))

        val viewModel = ProfileViewModel(authRepository, preferencesDataSource)
        testScheduler.advanceUntilIdle()

        var navigated = false
        viewModel.onProfileClicked(profileWithoutPin) { navigated = true }

        testScheduler.advanceUntilIdle()

        assertFalse("Navigation should not occur on failure", navigated)
        val state = viewModel.uiState.value
        assertEquals("Error de red", state.generalError)
        assertNull(state.pinError)
        assertFalse(state.isSelecting)
    }

    @Test
    fun `double click while selecting triggers only a single API request`() = runTest(testDispatcher) {
        coEvery { authRepository.selectProfile(profileWithoutPin.id, null) } coAnswers {
            Result.failure(Exception("Fallo"))
        }

        val viewModel = ProfileViewModel(authRepository, preferencesDataSource)
        testScheduler.advanceUntilIdle()

        var navCount = 0
        // Double click immediately before advancing dispatcher
        viewModel.onProfileClicked(profileWithoutPin) { navCount++ }
        viewModel.onProfileClicked(profileWithoutPin) { navCount++ }

        testScheduler.advanceUntilIdle()

        coVerify(exactly = 1) { authRepository.selectProfile(profileWithoutPin.id, null) }
        assertEquals(0, navCount)
    }
}
