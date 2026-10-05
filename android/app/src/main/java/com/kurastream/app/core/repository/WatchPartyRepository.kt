package com.kurastream.app.core.repository

import com.kurastream.app.core.network.toUserFacingError
import com.kurastream.app.core.model.PartyRoom
import com.kurastream.app.core.network.KuraApiService
import com.kurastream.app.core.network.PartyRealtimeEvent
import com.kurastream.app.core.network.WatchPartyClient
import com.kurastream.app.core.network.dto.PartyCreateRequestDto
import com.kurastream.app.core.network.dto.PartyJoinRequestDto
import com.kurastream.app.core.network.dto.PartyMessageRequestDto
import com.kurastream.app.core.network.dto.PartySyncRequestDto
import com.kurastream.app.core.network.dto.PartyTicketRequestDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Stream tickets last 15 minutes on the server: renew them well before (the web does the same every 8). */
private const val TICKET_REFRESH_INTERVAL_MS = 8 * 60_000L

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

    private val _activeSession = kotlinx.coroutines.flow.MutableStateFlow<ActivePartySession?>(null)
    val activeSession: kotlinx.coroutines.flow.StateFlow<ActivePartySession?> = _activeSession

    /** Work that must outlive any one screen: renewing the ticket, telling the room about an episode change. */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var ticketRefreshJob: Job? = null

    init {
        // The room was closed (or this member was removed): the session is over for every screen, not only the
        // one that happens to be listening. It used to linger as an "active" party forever.
        scope.launch {
            watchPartyClient.events.collect { event ->
                if (event is PartyRealtimeEvent.RoomClosed) endSession()
            }
        }
    }

    fun setActiveSession(session: ActivePartySession?) {
        _activeSession.value = session
        if (session == null) stopTicketRefresh() else startTicketRefresh()
    }

    private fun endSession() {
        _activeSession.value = null
        stopTicketRefresh()
        watchPartyClient.disconnect()
    }

    private fun startTicketRefresh() {
        ticketRefreshJob?.cancel()
        ticketRefreshJob = scope.launch {
            while (isActive) {
                delay(TICKET_REFRESH_INTERVAL_MS)
                refreshStreamTicketNow()
            }
        }
    }

    private fun stopTicketRefresh() {
        ticketRefreshJob?.cancel()
        ticketRefreshJob = null
    }

    /** Asks the server for a fresh stream ticket and stores it (the media client reads it for every request). */
    suspend fun refreshStreamTicketNow(): Boolean {
        val session = _activeSession.value ?: return false
        return try {
            val res = apiService.refreshPartyTicket(
                memberId = session.memberId,
                memberToken = session.memberToken,
                body = PartyTicketRequestDto(roomId = session.roomId, memberId = session.memberId, memberToken = session.memberToken)
            )
            val ticket = res.streamCapabilityToken
            if (res.success && !ticket.isNullOrBlank()) {
                updateStreamTicket(ticket)
                true
            } else {
                false
            }
        } catch (e: retrofit2.HttpException) {
            // The server no longer knows this member or room: the session is over.
            if (e.code() == 401 || e.code() == 403 || e.code() == 404) endSession()
            false
        } catch (_: Exception) {
            false   // offline for a moment: the next round tries again, and the session cookie/bearer still works
        }
    }

    /** Like syncPlayback, but not tied to a screen: it completes even if the player is closed right after. */
    fun syncPlaybackDetached(
        session: ActivePartySession,
        currentTime: Float,
        isPlaying: Boolean,
        rate: Float = 1.0f,
        action: String? = null,
        episodeId: String? = null
    ) {
        scope.launch { syncPlayback(session, currentTime, isPlaying, rate, action, episodeId) }
    }

    fun updatePlaybackState(currentTime: Float, isPlaying: Boolean, episodeId: String? = null) {
        val current = _activeSession.value ?: return
        val updatedRoom = current.room?.copy(
            currentTime = currentTime,
            isPlaying = isPlaying,
            episodeId = episodeId ?: current.room.episodeId
        )
        _activeSession.value = current.copy(room = updatedRoom)
    }

    fun updateStreamTicket(ticket: String) {
        val current = _activeSession.value ?: return
        _activeSession.value = current.copy(streamTicket = ticket)
    }

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
                        memberCount = it.memberCount,
                        allowGuestControls = true
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
                setActiveSession(session)
                Result.success(session)
            } else {
                Result.failure(Exception("Error al crear la sala de Watch Party"))
            }
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
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
                    memberCount = res.room.memberCount,
                    allowGuestControls = res.room.allowGuestControls
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
                setActiveSession(session)
                Result.success(session)
            } else {
                Result.failure(Exception("Error al unirse a la sala de Watch Party"))
            }
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
        }
    }

    suspend fun leaveRoom(roomId: String, memberId: String, memberToken: String = "") {
        try {
            apiService.leavePartyRoom(
                memberId = memberId,
                memberToken = memberToken,
                roomId = roomId,
                memberIdQuery = memberId
            )
        } catch (_: Exception) {}
        _activeSession.value = null
        stopTicketRefresh()
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

    suspend fun sendMessage(session: ActivePartySession, text: String, type: String = "chat"): Result<Unit> {
        return try {
            apiService.sendPartyMessage(
                memberId = session.memberId,
                memberToken = session.memberToken,
                body = PartyMessageRequestDto(
                    roomId = session.roomId,
                    message = text,
                    type = type
                )
            )
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
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
