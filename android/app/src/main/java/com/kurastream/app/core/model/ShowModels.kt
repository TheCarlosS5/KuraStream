package com.kurastream.app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class Show(
    val id: String,
    val title: String,
    val synopsis: String = "",
    val rating: Float = 0f,
    val year: Int? = null,
    val studio: String = "",
    val director: String = "",
    val writer: String = "",
    val posterPath: String = "",
    val backdropPath: String = "",
    val mediaType: String = "anime",
    val genres: String = "",
    val trailerKey: String? = null,
    val ageRating: String = "TV-14",
    val status: String = "finished",
    val tmdbId: Int? = null
) {
    val genreList: List<String>
        get() = if (genres.isBlank()) emptyList() else genres.split(",").map { it.trim() }

    val isAiring: Boolean
        get() = status.equals("airing", ignoreCase = true)
}

@Serializable
data class ShowDetail(
    val show: Show,
    val episodes: List<Episode> = emptyList(),
    val seasons: Map<Int, List<Episode>> = emptyMap(),
    /** Own poster/banner/synopsis per season; the show's art is its latest season's. */
    val seasonInfo: Map<Int, SeasonInfo> = emptyMap()
) {
    /** Regular seasons in order, specials (season 0) last. */
    val orderedSeasons: List<Int>
        get() = seasons.keys.sortedWith(compareBy({ it <= 0 }, { it }))
}

@Serializable
data class SeasonInfo(
    val seasonNumber: Int,
    val name: String = "",
    val title: String = "",
    val synopsis: String = "",
    val year: Int? = null,
    val status: String? = null,
    val posterPath: String = "",
    val backdropPath: String = ""
)

@Serializable
data class Episode(
    val id: String,
    val showId: String = "",
    val seasonNumber: Int = 1,
    val episodeNumber: Int = 1,
    val title: String = "",
    val synopsis: String = "",
    val duration: Float = 0f,
    val size: Long = 0L,
    val videoCodec: String = "",
    val audioCodec: String = "",
    val resolution: String = "",
    val fps: Float = 0f,
    val audioTracks: List<AudioTrack> = emptyList(),
    val subtitleTracks: List<SubtitleTrack> = emptyList(),
    val thumbnailPath: String = "",
    val introStart: Float? = null,
    val introEnd: Float? = null,
    val outroStart: Float? = null,
    /** End of the ending credits; a scene may follow (null: credits run to the end). */
    val outroEnd: Float? = null,
    val chapters: List<Chapter> = emptyList(),
    val streamUrl: String = "",
    val directPlayable: Boolean = false,
    val container: String = "mp4"
)

@Serializable
data class AudioTrack(
    val index: Int = 0,
    val trackNumber: Int = 0,
    val title: String = "",
    val language: String = "jpn",
    val codec: String = "aac",
    val channels: Int = 2
)

@Serializable
data class SubtitleTrack(
    val index: Int = 0,
    val trackNumber: Int = 0,
    val title: String = "",
    val language: String = "spa",
    val format: String = "ass",
    val isDefault: Boolean = false,
    val isForced: Boolean = false,
    val isBitmap: Boolean = false
)

@Serializable
data class Chapter(
    val title: String,
    val start: Float,
    val end: Float
)
