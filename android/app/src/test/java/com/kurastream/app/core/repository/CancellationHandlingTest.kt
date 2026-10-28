package com.kurastream.app.core.repository

import com.kurastream.app.core.database.ShowDao
import com.kurastream.app.core.network.KuraApiService
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import com.kurastream.app.core.network.WatchPartyClient
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CancellationHandlingTest {

    private val apiService = mockk<KuraApiService>()
    private val showDao = mockk<ShowDao>(relaxed = true)
    private val catalogRepository = CatalogRepository(apiService, showDao)

    @Test
    fun `cancelled call rethrows CancellationException and does not return Result failure`() = runTest {
        coEvery { apiService.getShows(any()) } throws CancellationException("Job was cancelled")

        try {
            val deferred = async {
                catalogRepository.refreshCatalog(serverId = "server1", isKidsMode = false)
            }
            deferred.await()
            fail("Expected CancellationException to be thrown, but call completed")
        } catch (e: CancellationException) {
            // Verified: CancellationException was rethrown and not swallowed into Result.failure
            assertEquals("Job was cancelled", e.message)
        }
    }

    @Test
    fun `watch party syncPlayback rethrows CancellationException`() = runTest {
        val watchPartyRepo = WatchPartyRepository(apiService, mockk<WatchPartyClient>(relaxed = true).also { every { it.events } returns MutableSharedFlow() })
        val session = ActivePartySession(roomId = "room1", memberId = "m1", memberToken = "t1", streamTicket = null, sseTicket = null, isHost = true)
        coEvery { apiService.syncPartyPlayback(any(), any(), any()) } throws CancellationException("Party sync cancelled")

        try {
            val deferred = async {
                watchPartyRepo.syncPlayback(session, currentTime = 10f, isPlaying = true)
            }
            deferred.await()
            fail("Expected CancellationException to be rethrown")
        } catch (e: CancellationException) {
            assertEquals("Party sync cancelled", e.message)
        }
    }

    @Test
    fun `watch party syncPlayback returns failure Result on exception instead of swallowing it`() = runTest {
        val watchPartyRepo = WatchPartyRepository(apiService, mockk<WatchPartyClient>(relaxed = true).also { every { it.events } returns MutableSharedFlow() })
        val session = ActivePartySession(roomId = "room1", memberId = "m1", memberToken = "t1", streamTicket = null, sseTicket = null, isHost = true)
        coEvery { apiService.syncPartyPlayback(any(), any(), any()) } throws RuntimeException("Network timeout")

        val result = watchPartyRepo.syncPlayback(session, currentTime = 10f, isPlaying = true)
        org.junit.Assert.assertTrue(result.isFailure)
    }
}
