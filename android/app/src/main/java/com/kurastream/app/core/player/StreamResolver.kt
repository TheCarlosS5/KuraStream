package com.kurastream.app.core.player

import com.kurastream.app.core.model.AudioTrack
import com.kurastream.app.core.model.Episode
import com.kurastream.app.core.network.ServerUrlResolver

data class ResolvedStream(
    val streamUrl: String,
    val isDirectPlay: Boolean,
    val streamStartOffsetSeconds: Float,
    val requiresInternalSeek: Boolean,
    val targetSeekPositionSeconds: Float
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

    /**
     * Resolves the stream URL and start offsets for playback.
     */
    fun resolvePlaybackStream(
        baseUrl: String,
        episode: Episode,
        requestedResumePositionSeconds: Float,
        selectedAudioTrackIndex: Int = 0,
        needsDownmix: Boolean = false,
        forceH264: Boolean = false
    ): ResolvedStream {
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
            val audioParam = if (selectedAudioTrackIndex >= 0) selectedAudioTrackIndex else null

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
            normalizeLanguageCode(it.language) == targetNorm ||
                    it.title.contains(preferredLanguage, ignoreCase = true)
        }
        return if (match >= 0) match else 0
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
     * Finds next consecutive episode in show (handles S1E12 -> S2E1 automatically).
     */
    fun findNextEpisode(currentEpisodeId: String, episodes: List<Episode>): Episode? {
        val sorted = episodes.sortedWith(compareBy({ it.seasonNumber }, { it.episodeNumber }))
        val idx = sorted.indexOfFirst { it.id == currentEpisodeId }
        return if (idx >= 0 && idx + 1 < sorted.size) sorted[idx + 1] else null
    }

    /**
     * KuraStream considers an episode completed when 90% or more of its duration has been watched.
     */
    fun isCompletedProgress(progressSeconds: Float, durationSeconds: Float): Boolean {
        if (durationSeconds <= 0f) return false
        return (progressSeconds / durationSeconds) >= 0.90f
    }
}
