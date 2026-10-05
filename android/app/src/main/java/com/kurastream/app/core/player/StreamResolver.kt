package com.kurastream.app.core.player

import com.kurastream.app.core.model.AudioTrack
import com.kurastream.app.core.model.Episode
import com.kurastream.app.core.model.SubtitleTrack
import com.kurastream.app.core.network.ServerUrlResolver

data class ResolvedStream(
    val streamUrl: String,
    val isDirectPlay: Boolean,
    val streamStartOffsetSeconds: Float,
    val requiresInternalSeek: Boolean,
    val targetSeekPositionSeconds: Float,
    /**
     * True when the server sends the raw file (`?direct=1`): every audio/subtitle track is inside it and the player
     * must pick the right one itself, because the server no longer remuxes a single track for it.
     */
    val clientSelectsTracks: Boolean = false
)

object StreamResolver {

    /**
     * Determines whether an episode can be direct-played using HTTP Range requests
     * without launching FFmpeg on the server.
     */
    fun canDirectPlay(
        episode: Episode,
        selectedAudioTrackIndex: Int = 0,
        needsDownmix: Boolean = false,
        forceH264: Boolean = false
    ): Boolean {
        if (forceH264) return false
        if (needsDownmix) return false

        val ext = episode.container.lowercase().trim()
        val isDirectContainer = ext == "mp4" || ext == "webm" || ext == "m4v"

        val codec = episode.videoCodec.lowercase().trim()
        val isDirectCodec = codec.isEmpty() || codec == "h264" || codec == "avc1" || codec == "avc"

        val isDefaultAudio = selectedAudioTrackIndex <= 0 || episode.audioTracks.size <= 1

        return isDirectContainer && isDirectCodec && isDefaultAudio
    }

    private val RAW_CONTAINERS = setOf("mkv", "mp4", "m4v", "webm", "mov")
    private val RAW_AUDIO_CODECS = setOf("aac", "mp3", "opus", "vorbis", "flac", "ac3", "eac3", "alac", "pcm_s16le", "pcm_s24le")

    /**
     * True when this device can play the file as it is stored (any container ExoPlayer reads, any video codec the
     * phone decodes in hardware/software, every track chosen on the client). The server then only serves bytes.
     * An episode whose audio is something ExoPlayer cannot decode (DTS, TrueHD) is left to the server.
     */
    fun canRawDirectPlay(
        episode: Episode,
        decoders: VideoDecoderSupport,
        needsDownmix: Boolean = false,
        forceH264: Boolean = false
    ): Boolean {
        if (forceH264 || needsDownmix) return false
        if (episode.container.lowercase().trim() !in RAW_CONTAINERS) return false
        val codec = episode.videoCodec.lowercase().trim()
        if (codec.isEmpty()) return false   // not probed yet: only the server knows what is inside
        val bitDepth = if (episode.bitDepth > 0) episode.bitDepth else 8
        if (!decoders.canDecode(codec, bitDepth)) return false
        val audioCodecs = episode.audioTracks.map { it.codec.lowercase().trim() }
            .ifEmpty { listOf(episode.audioCodec.lowercase().trim()) }
        return audioCodecs.all { it.isEmpty() || it in RAW_AUDIO_CODECS }
    }

    /**
     * Resolves the stream URL and start offsets for playback.
     */
    fun resolvePlaybackStream(
        baseUrl: String,
        episode: Episode,
        requestedResumePositionSeconds: Float,
        selectedAudioTrackIndex: Int = 0,
        needsDownmix: Boolean = false,
        forceH264: Boolean = false,
        decoders: VideoDecoderSupport = VideoDecoderSupport.None
    ): ResolvedStream {
        if (canRawDirectPlay(episode, decoders, needsDownmix, forceH264)) {
            // Range requests handle every seek; the container's own tracks are selected by the player
            val url = ServerUrlResolver.buildStreamUrl(
                baseUrl = baseUrl,
                episodeId = episode.id,
                direct = true
            )
            return ResolvedStream(
                streamUrl = url,
                isDirectPlay = true,
                streamStartOffsetSeconds = 0f,
                requiresInternalSeek = requestedResumePositionSeconds > 2f,
                targetSeekPositionSeconds = requestedResumePositionSeconds,
                clientSelectsTracks = true
            )
        }

        val isDirect = canDirectPlay(
            episode = episode,
            selectedAudioTrackIndex = selectedAudioTrackIndex,
            needsDownmix = needsDownmix,
            forceH264 = forceH264
        )

        return if (isDirect) {
            // Direct Play: HTTP Range handles the seek; do NOT add start= to URL
            val url = ServerUrlResolver.buildStreamUrl(
                baseUrl = baseUrl,
                episodeId = episode.id,
                startSeconds = null,
                audioTrack = null,
                forceH264 = false,
                downmixStereo = false
            )
            ResolvedStream(
                streamUrl = url,
                isDirectPlay = true,
                streamStartOffsetSeconds = 0f,
                requiresInternalSeek = requestedResumePositionSeconds > 2f,
                targetSeekPositionSeconds = requestedResumePositionSeconds
            )
        } else {
            // Remux / Transcode: Server FFmpeg starts from the requested position
            val startOffset = if (requestedResumePositionSeconds > 2f) requestedResumePositionSeconds else 0f
            val audioParam = resolveAudioTrackBackendParam(episode, selectedAudioTrackIndex)

            val url = ServerUrlResolver.buildStreamUrl(
                baseUrl = baseUrl,
                episodeId = episode.id,
                startSeconds = if (startOffset > 0f) startOffset else null,
                audioTrack = audioParam,
                forceH264 = forceH264,
                downmixStereo = needsDownmix
            )
            ResolvedStream(
                streamUrl = url,
                isDirectPlay = false,
                streamStartOffsetSeconds = startOffset,
                requiresInternalSeek = false,
                targetSeekPositionSeconds = 0f
            )
        }
    }

    /**
     * Calculates the absolute episode timestamp given the stream's starting offset
     * and the ExoPlayer instance's internal playback position.
     */
    fun calculateAbsolutePositionSeconds(
        streamStartOffsetSeconds: Float,
        playerCurrentPositionMs: Long
    ): Float {
        val playerSeconds = (playerCurrentPositionMs.coerceAtLeast(0L)) / 1000f
        return streamStartOffsetSeconds + playerSeconds
    }

    /**
     * Finds matching audio track based on user's preferred language code.
     */
    fun findBestAudioTrack(tracks: List<AudioTrack>, preferredLanguage: String): Int {
        if (tracks.isEmpty()) return 0
        val targetNorm = normalizeLanguageCode(preferredLanguage)

        val match = tracks.indexOfFirst {
            sameLanguageFamily(trackLanguage(it.language, it.title), targetNorm) ||
                    (preferredLanguage.length > 2 && it.title.contains(preferredLanguage, ignoreCase = true))
        }
        return if (match >= 0) match else 0
    }

    /**
     * Translates a UI track position to the identifier the server expects. PHP matches
     * track_number first, then the array position, then the ffmpeg stream index; sending the
     * stream index for a track_number of 0 (the first track) used to select the *second* track.
     * track_number is used when the scan numbered the tracks uniquely, the list position otherwise.
     */
    fun resolveAudioTrackBackendParam(episode: Episode, selectedAudioTrackIndex: Int): Int? {
        if (selectedAudioTrackIndex < 0) return null
        val track = episode.audioTracks.getOrNull(selectedAudioTrackIndex) ?: return selectedAudioTrackIndex
        val numbers = episode.audioTracks.map { it.trackNumber }
        return if (numbers.toSet().size == numbers.size) track.trackNumber else selectedAudioTrackIndex
    }

    /** Same rule as [resolveAudioTrackBackendParam] for /api/subtitles/{episode}/{track}. */
    fun resolveSubtitleTrackBackendParam(episode: Episode, selectedSubtitleTrackIndex: Int): Int {
        val track = episode.subtitleTracks.getOrNull(selectedSubtitleTrackIndex) ?: return selectedSubtitleTrackIndex
        val numbers = episode.subtitleTracks.map { it.trackNumber }
        return if (numbers.toSet().size == numbers.size) track.trackNumber else selectedSubtitleTrackIndex
    }

    /** Language of a track from its code, or from cues in its title when the code is "und". */
    fun trackLanguage(language: String, title: String): String {
        val code = normalizeLanguageCode(language)
        if (code.isNotBlank() && code != "und") return code
        val words = titleWords(title)
        return when {
            words.any { it in LATINO_CUES } -> "es-419"
            words.any { it in SPANISH_CUES } -> "spa"
            words.any { it in JAPANESE_CUES } -> "jpn"
            words.any { it in ENGLISH_CUES } -> "eng"
            else -> "und"
        }
    }

    private fun titleWords(title: String): Set<String> =
        title.lowercase().split(Regex("[^a-z0-9ñáéíóú-]+")).filter { it.isNotBlank() }.toSet()

    private val LATINO_CUES = setOf("latino", "lat", "es-la", "es-419", "latam")
    private val SPANISH_CUES = setOf("spa", "esp", "es", "spanish", "español", "espanol", "castellano")
    private val JAPANESE_CUES = setOf("jpn", "jap", "ja", "japanese", "japonés", "japones")
    private val ENGLISH_CUES = setOf("eng", "en", "english", "inglés", "ingles")
    private val FORCED_CUES = setOf("forced", "forzado", "forzados", "signs", "carteles")

    private fun sameLanguageFamily(a: String, b: String): Boolean {
        if (a == "und" || b == "und" || a.isBlank() || b.isBlank()) return false
        val spanish = setOf("spa", "es-419")
        return a == b || (a in spanish && b in spanish)
    }

    private fun isForcedSubtitle(track: SubtitleTrack): Boolean =
        track.isForced || titleWords(track.title).any { it in FORCED_CUES }

    /**
     * Subtitle track to start with (-1 = off), same rules as the web player: text tracks only;
     * when the audio already is in the viewer's language (a dub) full subtitles in that language
     * are skipped and only forced/signs tracks are used; foreign audio falls back to the file's
     * default track if there is none in the viewer's language.
     */
    fun chooseSubtitleTrack(tracks: List<SubtitleTrack>, preferredLanguage: String, audioLanguage: String): Int {
        val pref = preferredLanguage.trim().lowercase()
        if (tracks.isEmpty() || pref.isEmpty() || pref == "off") return -1
        val target = if (pref == "default") "spa" else normalizeLanguageCode(pref)
        val text = tracks.withIndex().filter { !it.value.isBitmap }
        val inTarget = text.filter { sameLanguageFamily(trackLanguage(it.value.language, it.value.title), target) }
        val match = if (sameLanguageFamily(audioLanguage, target)) {
            inTarget.firstOrNull { isForcedSubtitle(it.value) }
        } else {
            inTarget.firstOrNull { !isForcedSubtitle(it.value) }
                ?: inTarget.firstOrNull()
                ?: text.firstOrNull { it.value.isDefault && !isForcedSubtitle(it.value) }
        }
        return match?.index ?: -1
    }

    /**
     * Normalizes language codes across common variants (e.g. spa, es, es-419, jpn, ja, eng, en).
     */
    fun normalizeLanguageCode(raw: String): String {
        val clean = raw.lowercase().trim().replace("_", "-")
        return when {
            clean.startsWith("ja") || clean == "jpn" || clean == "jap" -> "jpn"
            clean.startsWith("es-419") || clean == "lat" || clean.contains("latino") -> "es-419"
            clean.startsWith("es") || clean == "spa" || clean.contains("castellano") -> "spa"
            clean.startsWith("en") || clean == "eng" -> "eng"
            clean.startsWith("fr") || clean == "fra" || clean == "fre" -> "fra"
            clean.startsWith("de") || clean == "ger" || clean == "deu" -> "deu"
            clean.startsWith("pt-br") || clean == "pob" -> "pt-br"
            clean.startsWith("pt") || clean == "por" -> "por"
            clean.startsWith("it") || clean == "ita" -> "ita"
            clean.startsWith("ko") || clean == "kor" -> "kor"
            clean.startsWith("zh") || clean == "zho" || clean == "chi" -> "zho"
            else -> clean
        }
    }

    /**
     * Next episode of the show (S1E12 -> S2E1; specials only lead to other specials).
     */
    fun findNextEpisode(currentEpisodeId: String, episodes: List<Episode>): Episode? =
        com.kurastream.app.core.model.EpisodeOrder.next(episodes, currentEpisodeId)

    /**
     * KuraStream considers an episode completed when 90% or more of its duration has been watched.
     */
    fun isCompletedProgress(progressSeconds: Float, durationSeconds: Float): Boolean {
        if (durationSeconds <= 0f) return false
        return (progressSeconds / durationSeconds) >= 0.90f
    }
}
