package com.kurastream.app.core.repository

import com.kurastream.app.core.database.HistoryDao
import com.kurastream.app.core.network.KuraApiService
import com.kurastream.app.core.network.dto.SaveProgressResponseDto
import com.kurastream.app.core.network.dto.SaveProgressRequestDto
import com.kurastream.app.core.player.PlaybackConnectionManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

class ProgressDeliveryTest {

    private val profileA = ProgressIdentity("srv", "familia", "perfil-a")
    private val profileB = ProgressIdentity("srv", "familia", "perfil-b")

    private val sent = mutableListOf<Pair<String, Float>>()
    private var networkUp = true
    private var active: ProgressIdentity? = profileA

    private fun httpError(code: Int): HttpException =
        HttpException(Response.error<Any>(code, "".toResponseBody("application/json".toMediaType())))

    private val api = mockk<KuraApiService>().also { api ->
        coEvery { api.saveProgress(any(), any()) } answers {
            if (!networkUp) throw IOException("hotspot caído")
            val body = secondArg<SaveProgressRequestDto>()
            sent += body.episodeId to body.progress
            SaveProgressResponseDto(success = true)
        }
    }
    private val store = InMemoryPendingProgressStore()
    private val repo = HistoryRepository(api, mockk<HistoryDao>(relaxed = true), store) { active }

    @Test
    fun `an intentional rewind ends where the viewer left it`() = runTest {
        repo.saveProgress(profileA, "ep1", 120f, 1400f)
        repo.saveProgress(profileA, "ep1", 150f, 1400f)
        repo.saveProgress(profileA, "ep1", 30f, 1400f)

        assertEquals(listOf("ep1" to 120f, "ep1" to 150f, "ep1" to 30f), sent)
        assertTrue(store.pendingFor(profileA).isEmpty())
    }

    @Test
    fun `progress recorded offline is kept and delivered once the network is back`() = runTest {
        networkUp = false
        assertTrue(repo.saveProgress(profileA, "ep1", 300f, 1400f).isFailure)
        assertTrue(repo.saveProgress(profileA, "ep2", 60f, 1400f).isFailure)
        assertEquals(2, store.pendingFor(profileA).size)

        networkUp = true
        assertTrue(repo.flushPendingProgress().isSuccess)

        assertEquals(listOf("ep1" to 300f, "ep2" to 60f), sent)
        assertTrue(store.pendingFor(profileA).isEmpty())
    }

    @Test
    fun `progress of profile A is never sent while profile B is active`() = runTest {
        active = profileB
        assertTrue(repo.saveProgress(profileA, "ep1", 500f, 1400f).isFailure)
        repo.flushPendingProgress()
        coVerify(exactly = 0) { api.saveProgress(any(), any()) }
        assertEquals(1, store.pendingFor(profileA).size)

        active = profileA
        repo.flushPendingProgress()
        assertEquals(listOf("ep1" to 500f), sent)
    }

    @Test
    fun `an old confirmation does not drop a newer point`() {
        val oldSeq = store.put(profileA, "ep1", 100f, 1400f)
        store.put(profileA, "ep1", 40f, 1400f)
        store.removeIfSeq(profileA, "ep1", oldSeq)
        assertEquals(40f, store.pendingFor(profileA).single().positionSeconds)
    }

    @Test
    fun `the outgoing owner is told before the new one takes the player`() {
        val manager = PlaybackConnectionManager(mockk(relaxed = true))
        val events = mutableListOf<String>()
        val episodeA = Any()
        val episodeB = Any()

        manager.claim(episodeA) { events += "A revoked" }
        manager.claim(episodeA) { events += "A revoked" } // re-claiming its own player is not a takeover
        manager.claim(episodeB) { events += "B revoked" }
        events += "B owns"

        assertEquals(listOf("A revoked", "B owns"), events)
        assertTrue(!manager.stopIfOwner(episodeA))
    }

    @Test
    fun `episode 404 is discarded and next is delivered`() = runTest {
        coEvery { api.saveProgress("ep-deleted", any()) } throws httpError(404)
        store.put(profileA, "ep-deleted", 100f, 1400f)
        store.put(profileA, "ep-valid", 200f, 1400f)

        val result = repo.flushPendingProgress(profileA)
        assertTrue(result.isSuccess)
        assertEquals(listOf("ep-valid" to 200f), sent)
        assertTrue(store.pendingFor(profileA).isEmpty())
    }

    private fun kotlinx.coroutines.test.TestScope.pumpUntil(condition: () -> Boolean) {
        repeat(200) {
            testScheduler.runCurrent()
            if (condition()) return
            Thread.sleep(10)
        }
    }

    @Test
    fun `retry in saveProgressDetached does not overwrite a newer position`() = runTest {
        repo.detachedScope = this
        networkUp = false
        repo.saveProgressDetached(profileA, "ep1", 120f, 1400f)
        // The store write hops to Dispatchers.IO (a real thread): pump the test scheduler until it lands.
        pumpUntil { store.pendingFor(profileA).isNotEmpty() }
        assertEquals(120f, store.pendingFor(profileA).single().positionSeconds)

        // Newer point recorded for the same episode while still offline
        repo.recordProgress(profileA, "ep1", 30f, 1400f)
        assertEquals(30f, store.pendingFor(profileA).single().positionSeconds)

        // Network recovers and retry timer fires
        networkUp = true
        testScheduler.advanceTimeBy(SAVE_RETRY_BASE_MS)
        pumpUntil { sent.isNotEmpty() && store.pendingFor(profileA).isEmpty() }

        // 30f was delivered, and 120f was not re-saved by retry
        assertEquals(listOf("ep1" to 30f), sent)
        assertTrue(store.pendingFor(profileA).isEmpty())
    }

    @Test
    fun `deleting history purges pending items for that identity`() = runTest {
        store.put(profileA, "ep1", 100f, 1400f)
        store.put(profileA, "ep2", 200f, 1400f)
        store.put(profileB, "ep3", 300f, 1400f)

        repo.deleteHistoryItem("srv", "familia", "perfil-a", "ep1")
        assertEquals(listOf("ep2"), store.pendingFor(profileA).map { it.episodeId })
        assertEquals(listOf("ep3"), store.pendingFor(profileB).map { it.episodeId })

        repo.clearAllHistory("srv", "familia", "perfil-a")
        assertTrue(store.pendingFor(profileA).isEmpty())
        assertEquals(listOf("ep3"), store.pendingFor(profileB).map { it.episodeId })
    }

    @Test
    fun `identity change mid-flush halts delivery and preserves remaining pending items`() = runTest {
        store.put(profileA, "ep1", 100f, 1400f)
        store.put(profileA, "ep2", 200f, 1400f)

        coEvery { api.saveProgress("ep1", any()) } answers {
            val body = secondArg<SaveProgressRequestDto>()
            sent += body.episodeId to body.progress
            // Profile switched while ep1 was in transit
            active = profileB
            SaveProgressResponseDto(success = true)
        }

        val result = repo.flushPendingProgress(profileA)
        assertTrue(result.isFailure)
        assertEquals(listOf("ep1" to 100f), sent)
        assertEquals(listOf("ep2"), store.pendingFor(profileA).map { it.episodeId })
    }
}
