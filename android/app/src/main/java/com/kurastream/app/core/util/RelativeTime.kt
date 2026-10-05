package com.kurastream.app.core.util

import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The server sends ISO-8601 UTC timestamps ("2026-10-05T14:03:00Z"); people read "hace 5 min". */
object RelativeTime {

    private val dateFormat = DateTimeFormatter.ofPattern("d MMM yyyy", Locale("es"))

    /** Falls back to the original text when it is not a timestamp, so nothing disappears. */
    fun format(iso: String, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        val instant = parse(iso) ?: return iso
        val elapsed = Duration.between(instant, now)
        return when {
            elapsed.isNegative || elapsed.toMinutes() < 1 -> "ahora"
            elapsed.toMinutes() < 60 -> "hace ${elapsed.toMinutes()} min"
            elapsed.toHours() < 24 -> "hace ${elapsed.toHours()} h"
            elapsed.toDays() < 7 -> "hace ${elapsed.toDays()} d"
            else -> dateFormat.format(instant.atZone(zone))
        }
    }

    private fun parse(iso: String): Instant? = try {
        Instant.parse(iso.trim())
    } catch (_: Exception) {
        try {
            // Older rows: "2026-10-05 14:03:00" (stored in UTC)
            Instant.parse(iso.trim().replace(' ', 'T') + "Z")
        } catch (_: Exception) {
            null
        }
    }
}
