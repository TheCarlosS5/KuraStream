package com.kurastream.app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class WatchHistoryItem(
    val episodeId: String,
    val showId: String,
    val seasonNumber: Int = 1,
    val episodeNumber: Int = 1,
    val progressSeconds: Float = 0f,
    val duration: Float = 0f,
    val completed: Boolean = false,
    val updatedAt: String = "",
    val showTitle: String = "",
    val thumbnailPath: String = "",
    val posterPath: String = "",
    val backdropPath: String = ""
) {
    val progressPercentage: Int
        get() = if (duration > 0f) ((progressSeconds / duration) * 100).toInt().coerceIn(0, 100) else 0

    val remainingSeconds: Int
        get() = (duration - progressSeconds).toInt().coerceAtLeast(0)
}

@Serializable
data class Progress(
    val progress: Float = 0f,
    val completed: Boolean = false,
    val duration: Float = 0f
)

@Serializable
data class UserPreferences(
    val autoSkipIntro: Boolean = false,
    val autoSkipOutro: Boolean = false,
    val autoPlayNext: Boolean = true,
    val preferredAudioLanguage: String = "jpn",
    val preferredSubtitleLanguage: String = "spa",
    val audioBoost: Int = 100,
    val audioPreset: String = "flat",
    val doubleTapSeekSeconds: Int = 10
)

@Serializable
data class UserStats(
    val totalTimeSeconds: Long = 0L,
    val watchedEpisodes: Int = 0,
    val completedShows: Int = 0,
    val topGenre: String = "Ninguno",
    val genresBreakdown: Map<String, Int> = emptyMap()
)
