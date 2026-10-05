package com.kurastream.app.core.player

import com.kurastream.app.core.model.AudioTrack
import com.kurastream.app.core.model.SubtitleTrack

/** Human label for a track list entry: "Español", "Japonés" plus a hint when two share a language. */
data class TrackLabel(val label: String, val detail: String = "")

/**
 * Release files tag tracks with group names ("GATON") and "und" codes; the player lists them by
 * language instead (same wording as the web player).
 */
object TrackLabels {

    private val LANGUAGE_NAMES = mapOf(
        "spa" to "Español",
        "es-419" to "Español (Latino)",
        "jpn" to "Japonés",
        "eng" to "Inglés",
        "fra" to "Francés",
        "deu" to "Alemán",
        "ita" to "Italiano",
        "por" to "Portugués",
        "pt-br" to "Portugués (Brasil)",
        "kor" to "Coreano",
        "zho" to "Chino"
    )

    private val RELEASE_GROUPS = setOf(
        "gaton", "erai-raws", "subsplease", "horriblesubs", "judas", "ember", "asw", "puya", "crunchyroll", "netflix", "animetime"
    )

    fun languageName(code: String): String = LANGUAGE_NAMES[code] ?: if (code.isBlank() || code == "und") "" else code.uppercase()

    /** Title without release-group tags, brackets or generic "Pista 1" names. */
    private fun cleanTitle(title: String): String {
        var t = title
        listOf('[' to ']', '(' to ')').forEach { (open, close) ->
            while (true) {
                val start = t.indexOf(open)
                val end = t.indexOf(close, start + 1)
                if (start < 0 || end < 0) break
                t = t.removeRange(start, end + 1)
            }
        }
        val words = t.replace('_', ' ').split(' ').filter { it.isNotBlank() && it.lowercase() !in RELEASE_GROUPS }
        val joined = words.joinToString(" ").trim()
        return if (joined.lowercase().matches(Regex("pista [0-9]+"))) "" else joined
    }

    private fun channelName(channels: Int): String = when (channels) {
        1 -> "Mono"
        2 -> "Estéreo"
        6 -> "5.1"
        8 -> "7.1"
        else -> if (channels > 0) "$channels canales" else ""
    }

    fun audio(tracks: List<AudioTrack>): List<TrackLabel> {
        val base = tracks.mapIndexed { index, track ->
            val lang = StreamResolver.trackLanguage(track.language, track.title)
            val cleaned = cleanTitle(track.title)
            Triple(languageName(lang).ifBlank { cleaned.ifBlank { "Audio ${index + 1}" } }, cleaned, channelName(track.channels))
        }
        return disambiguate(base)
    }

    fun subtitles(tracks: List<SubtitleTrack>): List<TrackLabel> {
        val base = tracks.mapIndexed { index, track ->
            val lang = StreamResolver.trackLanguage(track.language, track.title)
            val cleaned = cleanTitle(track.title)
            val extra = when {
                track.isBitmap -> "No compatible (imagen)"
                track.isForced -> "Forzados"
                else -> ""
            }
            Triple(languageName(lang).ifBlank { cleaned.ifBlank { "Subtítulos ${index + 1}" } }, cleaned, extra)
        }
        return disambiguate(base, alwaysShowExtra = true)
    }

    private fun disambiguate(base: List<Triple<String, String, String>>, alwaysShowExtra: Boolean = false): List<TrackLabel> {
        val counts = base.groupingBy { it.first }.eachCount()
        val labels = base.map { (label, cleaned, extra) ->
            val duplicated = (counts[label] ?: 0) > 1
            val hints = mutableListOf<String>()
            if (duplicated && cleaned.isNotBlank() && cleaned != label) hints += cleaned
            if (extra.isNotBlank() && (alwaysShowExtra || duplicated)) hints += extra
            TrackLabel(label, hints.joinToString(" · "))
        }
        // Still identical: number them.
        val full = labels.map { "${it.label}|${it.detail}" }
        val seen = mutableMapOf<String, Int>()
        return labels.mapIndexed { i, item ->
            if (full.count { it == full[i] } > 1) {
                val n = (seen[full[i]] ?: 0) + 1
                seen[full[i]] = n
                item.copy(detail = listOf(item.detail, n.toString()).filter { it.isNotBlank() }.joinToString(" · "))
            } else {
                item
            }
        }
    }
}
