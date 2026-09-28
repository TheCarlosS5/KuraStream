package com.kurastream.app.core.model

import kotlinx.serialization.Serializable

@Serializable
data class PartyRoom(
    val id: String,
    val name: String,
    val episodeId: String,
    val hostUser: String = "",
    val currentTime: Float = 0f,
    val isPlaying: Boolean = false,
    val isPublic: Boolean = true,
    val memberCount: Int = 1,
    val showTitle: String? = null
)

@Serializable
data class PartyMember(
    val memberId: String,
    val username: String,
    val role: String = "member",
    val isHost: Boolean = false
)

@Serializable
data class PartyMessage(
    val id: String,
    val username: String,
    val message: String,
    val timestamp: String = ""
)

@Serializable
data class PartySyncEvent(
    val currentTime: Float,
    val isPlaying: Boolean,
    val updatedBy: String,
    val playbackRate: Float = 1.0f
)
