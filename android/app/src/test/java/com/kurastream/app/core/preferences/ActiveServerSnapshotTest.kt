package com.kurastream.app.core.preferences

import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class ActiveServerSnapshotTest {

    @Test
    fun `current returns initial value even when collect has not executed yet`() {
        val initialPrefs = UserSessionPreferences(
            activeServerId = "server_1",
            activeServerUrl = "https://kurastream1.lan"
        )
        val preferencesDataSource = mockk<KuraPreferencesDataSource>()
        val flow = MutableStateFlow(initialPrefs)
        every { preferencesDataSource.preferencesFlow } returns flow

        val testDispatcher = StandardTestDispatcher()
        val testScope = CoroutineScope(testDispatcher)
        val snapshot = ActiveServerSnapshot(preferencesDataSource, testScope)

        // The background collect on testDispatcher has not executed yet because the scheduler was not advanced.
        // current() must fall back to reading preferencesFlow.firstOrNull() synchronously.
        val result = snapshot.current()

        assertEquals(initialPrefs, result)
        assertEquals("server_1", snapshot.activeServerId)
        assertEquals("https://kurastream1.lan", snapshot.activeServerUrl)
    }

    @Test
    fun `current eventually returns updated preferences after MutableStateFlow emits new value`() {
        val initialPrefs = UserSessionPreferences(
            activeServerId = "server_1",
            activeServerUrl = "https://kurastream1.lan"
        )
        val updatedPrefs = UserSessionPreferences(
            activeServerId = "server_2",
            activeServerUrl = "https://kurastream2.lan"
        )
        val flow = MutableStateFlow(initialPrefs)
        val preferencesDataSource = mockk<KuraPreferencesDataSource>()
        every { preferencesDataSource.preferencesFlow } returns flow

        val snapshot = ActiveServerSnapshot(preferencesDataSource)
        assertEquals(initialPrefs, snapshot.current())

        flow.value = updatedPrefs

        // Wait for the background collector on Dispatchers.IO to receive the emission
        val deadline = System.currentTimeMillis() + 3000
        while (snapshot.current() != updatedPrefs && System.currentTimeMillis() < deadline) {
            Thread.sleep(10)
        }

        assertEquals(updatedPrefs, snapshot.current())
        assertEquals("server_2", snapshot.activeServerId)
        assertEquals("https://kurastream2.lan", snapshot.activeServerUrl)
    }

    @Test
    fun `current returns updated preferences when test dispatcher advances`() = runTest {
        val initialPrefs = UserSessionPreferences(
            activeServerId = "server_1",
            activeServerUrl = "https://kurastream1.lan"
        )
        val updatedPrefs = UserSessionPreferences(
            activeServerId = "server_2",
            activeServerUrl = "https://kurastream2.lan"
        )
        val flow = MutableStateFlow(initialPrefs)
        val preferencesDataSource = mockk<KuraPreferencesDataSource>()
        every { preferencesDataSource.preferencesFlow } returns flow

        val snapshot = ActiveServerSnapshot(preferencesDataSource, backgroundScope)
        assertEquals(initialPrefs, snapshot.current())

        flow.value = updatedPrefs
        testScheduler.runCurrent()

        assertEquals(updatedPrefs, snapshot.current())
        assertEquals("server_2", snapshot.activeServerId)
        assertEquals("https://kurastream2.lan", snapshot.activeServerUrl)
    }
}
