package com.kurastream.app.core.player

import com.kurastream.app.core.model.AudioTrack
import com.kurastream.app.core.model.Episode
import com.kurastream.app.core.model.SubtitleTrack
import org.junit.Assert.*
import org.junit.Test

class StreamResolverTest {

    @Test
    fun `direct play is eligible for mp4 h264 with default audio`() {
        val ep = Episode(
            id = "ep1",
            container = "mp4",
            videoCodec = "h264",
            audioTracks = listOf(AudioTrack(index = 0, trackNumber = 0, title = "Default", language = "jpn"))
        )
        assertTrue(StreamResolver.canDirectPlay(ep, selectedAudioTrackIndex = 0))
    }

    @Test
    fun `direct play is rejected for mkv container to trigger server remux`() {
        val ep = Episode(
            id = "ep1",
            container = "mkv",
            videoCodec = "h264",
            audioTracks = listOf(AudioTrack(index = 0, trackNumber = 0, title = "Default", language = "jpn"))
        )
        assertFalse(StreamResolver.canDirectPlay(ep, selectedAudioTrackIndex = 0))
    }

    @Test
    fun `direct play is rejected when non-default secondary audio track is selected`() {
        val ep = Episode(
            id = "ep1",
            container = "mp4",
            videoCodec = "h264",
            audioTracks = listOf(
                AudioTrack(index = 1, trackNumber = 0, title = "Japanese", language = "jpn"),
                AudioTrack(index = 2, trackNumber = 1, title = "Spanish Latino", language = "spa")
            )
        )
        // Default track 0 is direct playable
        assertTrue(StreamResolver.canDirectPlay(ep, selectedAudioTrackIndex = 0))
        // Secondary track 1 requires server audio extraction remux
        assertFalse(StreamResolver.canDirectPlay(ep, selectedAudioTrackIndex = 1))
    }

    @Test
    fun `direct play resolution does NOT append start parameter to url and flags internal seek`() {
        val ep = Episode(
            id = "ep1",
            container = "mp4",
            videoCodec = "h264",
            duration = 1400f
        )
        val resolved = StreamResolver.resolvePlaybackStream(
            baseUrl = "http://192.168.1.10:3000",
            episode = ep,
            requestedResumePositionSeconds = 150f,
            selectedAudioTrackIndex = 0
        )

        assertTrue(resolved.isDirectPlay)
        assertEquals(0f, resolved.streamStartOffsetSeconds, 0.001f)
        assertFalse(resolved.streamUrl.contains("start="))
        assertTrue(resolved.requiresInternalSeek)
        assertEquals(150f, resolved.targetSeekPositionSeconds, 0.001f)
    }

    @Test
    fun `remux transcode resolution appends start parameter and stores streamStartOffset`() {
        val ep = Episode(
            id = "ep2",
            container = "mkv",
            videoCodec = "h264",
            duration = 1400f
        )
        val resolved = StreamResolver.resolvePlaybackStream(
            baseUrl = "http://192.168.1.10:3000",
            episode = ep,
            requestedResumePositionSeconds = 300f,
            selectedAudioTrackIndex = 1
        )

        assertFalse(resolved.isDirectPlay)
        assertEquals(300f, resolved.streamStartOffsetSeconds, 0.001f)
        assertTrue(resolved.streamUrl.contains("start=300.0") || resolved.streamUrl.contains("start=300"))
        assertTrue(resolved.streamUrl.contains("audio=1"))
        assertFalse(resolved.requiresInternalSeek)
    }

    @Test
    fun `calculateAbsolutePosition adds streamStartOffset to player internal position`() {
        val streamOffsetSeconds = 300f // Stream started at 5:00 min
        val playerMs = 45000L          // ExoPlayer is 45s into its local fragmented stream

        val absolute = StreamResolver.calculateAbsolutePositionSeconds(streamOffsetSeconds, playerMs)
        assertEquals(345f, absolute, 0.001f) // 5:45 absolute
    }

    @Test
    fun `normalizeLanguageCode maps various language notations correctly`() {
        assertEquals("jpn", StreamResolver.normalizeLanguageCode("ja"))
        assertEquals("jpn", StreamResolver.normalizeLanguageCode("JPN"))
        assertEquals("jpn", StreamResolver.normalizeLanguageCode("Japanese"))

        assertEquals("spa", StreamResolver.normalizeLanguageCode("es"))
        assertEquals("spa", StreamResolver.normalizeLanguageCode("es-ES"))
        assertEquals("spa", StreamResolver.normalizeLanguageCode("castellano"))

        assertEquals("es-419", StreamResolver.normalizeLanguageCode("es-419"))
        assertEquals("es-419", StreamResolver.normalizeLanguageCode("lat"))
        assertEquals("es-419", StreamResolver.normalizeLanguageCode("latino"))

        assertEquals("eng", StreamResolver.normalizeLanguageCode("en"))
        assertEquals("eng", StreamResolver.normalizeLanguageCode("eng"))
    }

    @Test
    fun `findBestAudioTrack matches track by normalized language preference`() {
        val tracks = listOf(
            AudioTrack(index = 1, trackNumber = 0, title = "Original Audio", language = "ja"),
            AudioTrack(index = 2, trackNumber = 1, title = "Español Latino", language = "es-419"),
            AudioTrack(index = 3, trackNumber = 2, title = "English Dub", language = "en")
        )

        val idxJpn = StreamResolver.findBestAudioTrack(tracks, "jpn")
        assertEquals(0, idxJpn)

        val idxLat = StreamResolver.findBestAudioTrack(tracks, "lat")
        assertEquals(1, idxLat)

        val idxEng = StreamResolver.findBestAudioTrack(tracks, "eng")
        assertEquals(2, idxEng)
    }

    @Test
    fun `findNextEpisode advances S1E12 to S2E1 across season boundary`() {
        val episodes = listOf(
            Episode(id = "ep_s1_11", seasonNumber = 1, episodeNumber = 11),
            Episode(id = "ep_s1_12", seasonNumber = 1, episodeNumber = 12),
            Episode(id = "ep_s2_01", seasonNumber = 2, episodeNumber = 1),
            Episode(id = "ep_s2_02", seasonNumber = 2, episodeNumber = 2)
        )

        val nextFrom11 = StreamResolver.findNextEpisode("ep_s1_11", episodes)
        assertNotNull(nextFrom11)
        assertEquals("ep_s1_12", nextFrom11?.id)

        // S1E12 -> S2E1 across season boundary
        val nextFrom12 = StreamResolver.findNextEpisode("ep_s1_12", episodes)
        assertNotNull(nextFrom12)
        assertEquals("ep_s2_01", nextFrom12?.id)
        assertEquals(2, nextFrom12?.seasonNumber)
        assertEquals(1, nextFrom12?.episodeNumber)

        // Last episode in series returns null
        val nextFromLast = StreamResolver.findNextEpisode("ep_s2_02", episodes)
        assertNull(nextFromLast)
    }

    @Test
    fun `isCompletedProgress verifies 90 percent threshold`() {
        val duration = 1400f // 23m 20s episode

        // 89% watched -> not completed
        assertFalse(StreamResolver.isCompletedProgress(1240f, duration))

        // 90% watched -> completed
        assertTrue(StreamResolver.isCompletedProgress(1260f, duration))

        // 98% watched -> completed
        assertTrue(StreamResolver.isCompletedProgress(1372f, duration))

        // Zero or negative duration safeguards
        assertFalse(StreamResolver.isCompletedProgress(100f, 0f))
        assertFalse(StreamResolver.isCompletedProgress(0f, -10f))
    }

    @Test
    fun `audio param is the track_number even when it is 0 and the stream index is not`() {
        // Real scan data (Mushoku Tensei): Spanish is track_number 0 / stream index 1, Japanese 1 / 2.
        // Sending the stream index for the first track used to select Japanese for both choices.
        val ep = Episode(
            id = "ep1",
            container = "mkv",
            audioTracks = listOf(
                AudioTrack(index = 1, trackNumber = 0, title = "GATON", language = "spa"),
                AudioTrack(index = 2, trackNumber = 1, title = "GATON", language = "jpn")
            )
        )
        assertEquals(0, StreamResolver.resolveAudioTrackBackendParam(ep, 0))
        assertEquals(1, StreamResolver.resolveAudioTrackBackendParam(ep, 1))
        assertTrue(StreamResolver.resolvePlaybackStream("http://h", ep, 0f, 0).streamUrl.contains("audio=0"))
    }

    @Test
    fun `audio param falls back to the list position when track numbers are not unique`() {
        val ep = Episode(
            id = "ep1",
            audioTracks = listOf(
                AudioTrack(index = 10, trackNumber = 0, language = "spa"),
                AudioTrack(index = 11, trackNumber = 0, language = "jpn")
            )
        )
        assertEquals(1, StreamResolver.resolveAudioTrackBackendParam(ep, 1))
        assertEquals(99, StreamResolver.resolveAudioTrackBackendParam(ep, 99))
    }

    @Test
    fun `subtitle param uses track_number like the web player`() {
        val ep = Episode(
            id = "ep1",
            subtitleTracks = listOf(
                SubtitleTrack(index = 3, trackNumber = 0, language = "spa"),
                SubtitleTrack(index = 4, trackNumber = 1, language = "eng")
            )
        )
        assertEquals(0, StreamResolver.resolveSubtitleTrackBackendParam(ep, 0))
        assertEquals(1, StreamResolver.resolveSubtitleTrackBackendParam(ep, 1))
    }

    @Test
    fun `dubbed audio starts without subtitles in the same language`() {
        val subs = listOf(
            SubtitleTrack(index = 3, trackNumber = 0, title = "GATON", language = "spa", isDefault = true),
            SubtitleTrack(index = 4, trackNumber = 1, title = "GATON", language = "eng")
        )
        assertEquals(-1, StreamResolver.chooseSubtitleTrack(subs, "spa", "spa"))
        assertEquals(0, StreamResolver.chooseSubtitleTrack(subs, "spa", "jpn"))
        assertEquals(-1, StreamResolver.chooseSubtitleTrack(subs, "", "jpn"))
    }

    @Test
    fun `dubbed audio still uses a forced signs track`() {
        val subs = listOf(
            SubtitleTrack(index = 3, trackNumber = 0, title = "Completos", language = "spa"),
            SubtitleTrack(index = 4, trackNumber = 1, title = "Carteles", language = "spa")
        )
        assertEquals(1, StreamResolver.chooseSubtitleTrack(subs, "spa", "es-419"))
    }

    @Test
    fun `untagged tracks are recognised from release titles`() {
        assertEquals("spa", StreamResolver.trackLanguage("und", "GATON [SPA]"))
        assertEquals("es-419", StreamResolver.trackLanguage("und", "Español Latino"))
        assertEquals("jpn", StreamResolver.trackLanguage("", "Japanese"))
        assertEquals("und", StreamResolver.trackLanguage("und", "Pista 1"))
    }

    @Test
    fun `track labels use language names instead of release tags`() {
        val labels = TrackLabels.audio(
            listOf(
                AudioTrack(index = 1, trackNumber = 0, title = "GATON", language = "spa"),
                AudioTrack(index = 2, trackNumber = 1, title = "GATON", language = "jpn")
            )
        )
        assertEquals(listOf("Español", "Japonés"), labels.map { it.label })
        assertTrue(labels.all { it.detail.isEmpty() })
    }
}
