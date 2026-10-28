package com.kurastream.app.core.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SleepTimerTest {

    private class FakeSleepTimerClock(var currentTimeMs: Long = 100_000L) : SleepTimerClock {
        override fun elapsedRealtimeMs(): Long = currentTimeMs

        fun advanceSeconds(seconds: Long) {
            currentTimeMs += seconds * 1000L
        }
    }

    private lateinit var clock: FakeSleepTimerClock
    private lateinit var sleepTimer: SleepTimer

    @Before
    fun setUp() {
        clock = FakeSleepTimerClock()
        sleepTimer = SleepTimer(clock)
    }

    @Test
    fun `starts inactive`() {
        assertFalse(sleepTimer.isActive)
        assertFalse(sleepTimer.blocksAutoAdvance())
        assertEquals(SleepTimerState.Inactive, sleepTimer.state.value)
    }

    @Test
    fun `sets 15 minutes timer and formats label correctly`() {
        sleepTimer.setTimer(SleepTimerMode.Minutes(15), "profile_1")
        assertTrue(sleepTimer.isActive)
        val state = sleepTimer.state.value as SleepTimerState.Active
        assertEquals(15 * 60, state.remainingSeconds)
        assertEquals("15:00", state.label)
        assertFalse(state.isEndOfEpisode)
    }

    @Test
    fun `advancing clock decrements remaining time`() {
        sleepTimer.setTimer(SleepTimerMode.Minutes(15), "profile_1")
        clock.advanceSeconds(65) // 1 min and 5 sec

        val ticked = sleepTimer.tick() as SleepTimerState.Active
        assertEquals(15 * 60 - 65, ticked.remainingSeconds)
        assertEquals("13:55", ticked.label)
    }

    @Test
    fun `expiration triggers expired state and blocks auto advance`() {
        sleepTimer.setTimer(SleepTimerMode.Minutes(30), "profile_1")
        assertFalse(sleepTimer.blocksAutoAdvance())

        clock.advanceSeconds(30 * 60) // exactly 30 minutes
        val ticked = sleepTimer.tick()

        assertEquals(SleepTimerState.Expired, ticked)
        assertFalse(sleepTimer.isActive)
        assertTrue(sleepTimer.blocksAutoAdvance())
    }

    @Test
    fun `end of episode mode remains active until episode ended is called`() {
        sleepTimer.setTimer(SleepTimerMode.EndOfEpisode, "profile_1")
        assertTrue(sleepTimer.isActive)
        assertTrue(sleepTimer.blocksAutoAdvance())

        val state = sleepTimer.state.value as SleepTimerState.Active
        assertTrue(state.isEndOfEpisode)
        assertEquals("Fin cap.", state.label)

        // Advancing time doesn't expire EndOfEpisode
        clock.advanceSeconds(3600)
        val ticked = sleepTimer.tick() as SleepTimerState.Active
        assertTrue(ticked.isEndOfEpisode)

        // Episode ends
        val handled = sleepTimer.onEpisodeEnded()
        assertTrue(handled)
        assertEquals(SleepTimerState.Expired, sleepTimer.state.value)
        assertTrue(sleepTimer.blocksAutoAdvance())
    }

    @Test
    fun `cancel timer resets state and unblocks auto advance`() {
        sleepTimer.setTimer(SleepTimerMode.Minutes(15), "profile_1")
        sleepTimer.cancel()

        assertFalse(sleepTimer.isActive)
        assertFalse(sleepTimer.blocksAutoAdvance())
        assertEquals(SleepTimerState.Inactive, sleepTimer.state.value)
    }

    @Test
    fun `switching profile cancels timer`() {
        sleepTimer.setTimer(SleepTimerMode.Minutes(15), "profile_1")
        assertTrue(sleepTimer.isActive)

        // Same profile maintains timer
        sleepTimer.onProfileChanged("profile_1")
        assertTrue(sleepTimer.isActive)

        // Different profile cancels
        sleepTimer.onProfileChanged("profile_2")
        assertFalse(sleepTimer.isActive)
        assertEquals(SleepTimerState.Inactive, sleepTimer.state.value)
    }

    @Test
    fun `watch party disables timer`() {
        sleepTimer.setTimer(SleepTimerMode.Minutes(15), "profile_1", isWatchParty = true)
        assertFalse(sleepTimer.isActive)
        assertEquals(SleepTimerState.Inactive, sleepTimer.state.value)
    }

    @Test
    fun `timer persists across simulated episode navigation`() {
        // Episode 1 sets 30m timer
        sleepTimer.setTimer(SleepTimerMode.Minutes(30), "profile_1")
        clock.advanceSeconds(10 * 60) // 10 minutes pass in episode 1

        val stateEp1 = sleepTimer.tick() as SleepTimerState.Active
        assertEquals(20 * 60, stateEp1.remainingSeconds)

        // User navigates to Episode 2 on same profile
        sleepTimer.onProfileChanged("profile_1")
        clock.advanceSeconds(5 * 60) // 5 minutes pass in episode 2

        val stateEp2 = sleepTimer.tick() as SleepTimerState.Active
        assertEquals(15 * 60, stateEp2.remainingSeconds)
        assertEquals("15:00", stateEp2.label)
    }

    @Test
    fun `clear auto advance block unblocks auto advance after expiration`() {
        sleepTimer.setTimer(SleepTimerMode.Minutes(30), "profile_1")
        clock.advanceSeconds(30 * 60)
        val ticked = sleepTimer.tick()
        assertEquals(SleepTimerState.Expired, ticked)
        assertTrue(sleepTimer.blocksAutoAdvance())

        sleepTimer.clearAutoAdvanceBlock()
        assertFalse(sleepTimer.blocksAutoAdvance())
        assertEquals(SleepTimerState.Inactive, sleepTimer.state.value)
    }

    @Test
    fun `clear auto advance block unblocks auto advance after end of episode`() {
        sleepTimer.setTimer(SleepTimerMode.EndOfEpisode, "profile_1")
        val handled = sleepTimer.onEpisodeEnded()
        assertTrue(handled)
        assertTrue(sleepTimer.blocksAutoAdvance())

        sleepTimer.clearAutoAdvanceBlock()
        assertFalse(sleepTimer.blocksAutoAdvance())
        assertEquals(SleepTimerState.Inactive, sleepTimer.state.value)
    }
}
