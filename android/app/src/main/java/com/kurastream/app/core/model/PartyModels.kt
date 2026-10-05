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
    val showTitle: String? = null,
    /** Guests may play/pause/seek for everyone (the web lets them when the host allows it). */
    val allowGuestControls: Boolean = false
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
    val timestamp: String = "",
    /** "chat", "system" or "reaction" (message is then a reaction key such as "flame"). */
    val type: String = "chat"
)

@Serializable
data class PartySyncEvent(
    val currentTime: Float,
    val isPlaying: Boolean,
    val updatedBy: String,
    val playbackRate: Float = 1.0f,
    val episodeId: String? = null,
    /** Server epoch millis of the host's last state write (party_rooms.last_sync_timestamp). */
    val lastSyncTimestampMs: Long = 0L,
    /** Server clock when the frame was built (server_time_ms); 0 on servers that do not send it. */
    val serverTimeMs: Long = 0L,
    /** Device clock when the frame arrived, paired with [serverTimeMs] to avoid clock skew. */
    val receivedAtMs: Long = 0L
)
