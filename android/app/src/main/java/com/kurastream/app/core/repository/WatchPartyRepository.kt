package com.kurastream.app.core.repository

import com.kurastream.app.core.model.PartyRoom
import com.kurastream.app.core.network.KuraApiService
import com.kurastream.app.core.network.PartyRealtimeEvent
import com.kurastream.app.core.network.WatchPartyClient
import com.kurastream.app.core.network.dto.PartyCreateRequestDto
import com.kurastream.app.core.network.dto.PartyJoinRequestDto
import com.kurastream.app.core.network.dto.PartyMessageRequestDto
import com.kurastream.app.core.network.dto.PartySyncRequestDto
import kotlinx.coroutines.flow.Flow

data class ActivePartySession(
    val roomId: String,
    val memberId: String,
    val memberToken: String,
    val streamTicket: String?,
    val sseTicket: String?,
    val isHost: Boolean,
    val room: PartyRoom? = null
)

class WatchPartyRepository(
    private val apiService: KuraApiService,
    private val watchPartyClient: WatchPartyClient
) {
    val realtimeEvents: Flow<PartyRealtimeEvent> = watchPartyClient.events

    suspend fun createRoom(episodeId: String, roomName: String, isPublic: Boolean): Result<ActivePartySession> {
        return try {
            val res = apiService.createPartyRoom(
                PartyCreateRequestDto(
                    episodeId = episodeId,
                    name = roomName,
                    isPublic = isPublic,
                    allowGuestControls = true
                )
            )
            if (res.success && res.roomId.isNotBlank()) {
                val room = res.room?.let {
                    PartyRoom(
                        id = it.id,
                        name = it.name,
                        episodeId = it.episodeId,
                        hostUser = it.hostUser,
                        currentTime = it.currentTime,
                        isPlaying = it.isPlaying,
                        isPublic = it.isPublic,
                        memberCount = it.memberCount
                    )
                }
                val session = ActivePartySession(
                    roomId = res.roomId,
                    memberId = res.memberId,
                    memberToken = res.memberToken,
                    streamTicket = res.effectiveStreamToken,
                    sseTicket = res.sseTicket,
                    isHost = true,
                    room = room
                )
                Result.success(session)
            } else {
                Result.failure(Exception("Error al crear la sala de Watch Party"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun joinRoom(roomId: String, username: String? = null): Result<ActivePartySession> {
        return try {
            val res = apiService.joinPartyRoom(PartyJoinRequestDto(roomId = roomId, username = username))
            if (res.success && res.room != null) {
                val room = PartyRoom(
                    id = res.room.id,
                    name = res.room.name,
                    episodeId = res.room.episodeId,
                    hostUser = res.room.hostUser,
                    currentTime = res.room.currentTime,
                    isPlaying = res.room.isPlaying,
                    isPublic = res.room.isPublic,
                    memberCount = res.room.memberCount
                )
                val session = ActivePartySession(
                    roomId = res.room.id,
                    memberId = res.memberId,
                    memberToken = res.memberToken,
                    streamTicket = res.effectiveStreamToken,
                    sseTicket = res.sseTicket,
                    isHost = res.isHost,
                    room = room
                )
                Result.success(session)
            } else {
                Result.failure(Exception("Error al unirse a la sala de Watch Party"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun leaveRoom(roomId: String, memberId: String) {
        try {
            apiService.leavePartyRoom(roomId, memberId)
        } catch (_: Exception) {}
        watchPartyClient.disconnect()
    }

    suspend fun syncPlayback(
        session: ActivePartySession,
        currentTime: Float,
        isPlaying: Boolean,
        rate: Float = 1.0f,
        action: String? = null,
        episodeId: String? = null
    ) {
        try {
            apiService.syncPartyPlayback(
                memberId = session.memberId,
                memberToken = session.memberToken,
                body = PartySyncRequestDto(
                    roomId = session.roomId,
                    currentTime = currentTime,
                    isPlaying = isPlaying,
                    playbackRate = rate,
                    action = action,
                    episodeId = episodeId
                )
            )
        } catch (_: Exception) {}
    }

    suspend fun sendMessage(session: ActivePartySession, text: String): Result<Unit> {
        return try {
            apiService.sendPartyMessage(
                memberId = session.memberId,
                memberToken = session.memberToken,
                body = PartyMessageRequestDto(
                    roomId = session.roomId,
                    message = text
                )
            )
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun startListening(baseUrl: String, session: ActivePartySession) {
        watchPartyClient.connect(
            baseUrl = baseUrl,
            roomId = session.roomId,
            sseTicket = session.sseTicket,
            memberId = session.memberId,
            memberToken = session.memberToken
        )
    }

    fun stopListening() {
        watchPartyClient.disconnect()
    }
}
