package com.kurastream.app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class CalendarItem(
    val scheduleId: String,
    val airingAt: Long,
    val timeUntil: Long,
    val episode: Int,
    val title: String,
    val romajiTitle: String = "",
    val englishTitle: String = "",
    val coverImage: String = "",
    val genres: String = "",
    val studio: String = "",
    val inLibrary: Boolean = false,
    val libraryShowId: String? = null
)

@Serializable
data class NotificationItem(
    val id: Int,
    val title: String,
    val message: String,
    val showId: String? = null,
    val episodeId: String? = null,
    val createdAt: String = "",
    val isRead: Boolean = false
)
