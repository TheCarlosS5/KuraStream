package com.kurastream.app.core.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset

class RelativeTimeTest {
    private val now = Instant.parse("2026-10-05T15:00:00Z")

    @Test
    fun `recent timestamps read as relative time`() {
        assertEquals("ahora", RelativeTime.format("2026-10-05T14:59:40Z", now))
        assertEquals("hace 5 min", RelativeTime.format("2026-10-05T14:55:00Z", now))
        assertEquals("hace 3 h", RelativeTime.format("2026-10-05T12:00:00Z", now))
        assertEquals("hace 2 d", RelativeTime.format("2026-10-03T15:00:00Z", now))
    }

    @Test
    fun `old timestamps show the date and legacy rows parse as UTC`() {
        val old = RelativeTime.format("2026-09-01T10:00:00Z", now, ZoneOffset.UTC)
        assertTrue(old.startsWith("1 ") && old.endsWith("2026"))
        assertEquals("hace 1 h", RelativeTime.format("2026-10-05 14:00:00", now))
    }

    @Test
    fun `text that is not a timestamp is returned unchanged`() {
        assertEquals("ayer", RelativeTime.format("ayer", now))
    }
}
