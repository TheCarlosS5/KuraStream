package com.kurastream.app.feature.party

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kurastream.app.core.model.PartyMessage
import com.kurastream.app.core.network.PartyRealtimeEvent
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.repository.ActivePartySession
import com.kurastream.app.core.repository.WatchPartyRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class WatchPartyUiState(
    val activeSession: ActivePartySession? = null,
    val roomIdInput: String = "",
    val roomNameInput: String = "",
    val isCreatingRoom: Boolean = false,
    val isJoiningRoom: Boolean = false,
    val messages: List<PartyMessage> = emptyList(),
    val chatInput: String = "",
    val members: List<String> = emptyList(),
    val lastSync: com.kurastream.app.core.model.PartySyncEvent? = null,
    val errorMessage: String? = null,
    val baseUrl: String = ""
)

@HiltViewModel
class WatchPartyViewModel @Inject constructor(
    private val partyRepository: WatchPartyRepository,
    private val preferencesDataSource: KuraPreferencesDataSource,
    private val partyPlaybackContext: com.kurastream.app.core.player.PartyPlaybackContext
) : ViewModel() {

    private val _uiState = MutableStateFlow(WatchPartyUiState())
    val uiState: StateFlow<WatchPartyUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val prefs = preferencesDataSource.preferencesFlow.first()
            _uiState.update { it.copy(baseUrl = prefs.activeServerUrl ?: "") }
        }

        viewModelScope.launch {
            partyRepository.realtimeEvents.collect { event ->
                when (event) {
                    is PartyRealtimeEvent.Sync -> {
                        _uiState.update { current ->
                            val currentRoom = current.activeSession?.room
                            val updatedRoom = currentRoom?.copy(
                                currentTime = event.sync.currentTime,
                                isPlaying = event.sync.isPlaying,
                                episodeId = event.sync.episodeId ?: currentRoom.episodeId
                            )
                            val updatedSession = current.activeSession?.copy(room = updatedRoom)
                            current.copy(
                                activeSession = updatedSession,
                                lastSync = event.sync
                            )
                        }
                        partyRepository.updatePlaybackState(
                            currentTime = event.sync.currentTime,
                            isPlaying = event.sync.isPlaying,
                            episodeId = event.sync.episodeId
                        )
                    }
                    is PartyRealtimeEvent.Message -> {
                        _uiState.update { it.copy(messages = it.messages + event.message) }
                    }
                    is PartyRealtimeEvent.MessagesBatch -> {
                        _uiState.update { current ->
                            val existingIds = current.messages.map { it.id }.toSet()
                            val newOnes = event.messages.filter { it.id !in existingIds }
                            current.copy(messages = current.messages + newOnes)
                        }
                    }
                    is PartyRealtimeEvent.MembersUpdated -> {
                        _uiState.update { it.copy(members = event.members) }
                    }
                    is PartyRealtimeEvent.MemberJoined -> {
                        _uiState.update {
                            if (!it.members.contains(event.username)) it.copy(members = it.members + event.username) else it
                        }
                    }
                    is PartyRealtimeEvent.MemberLeft -> {
                        _uiState.update { it.copy(members = it.members - event.username) }
                    }
                    is PartyRealtimeEvent.RoomClosed -> {
                        partyPlaybackContext.clear()
                        _uiState.update { it.copy(errorMessage = "La sala ha sido cerrada por el anfitrión") }
                    }
                    is PartyRealtimeEvent.ConnectionError -> {
                        _uiState.update { it.copy(errorMessage = "Problema de conexión con la sala. Reintentando...") }
                    }
                    else -> {}
                }
            }
        }
    }

    fun onRoomIdChanged(id: String) {
        _uiState.update { it.copy(roomIdInput = id, errorMessage = null) }
    }

    fun onRoomNameChanged(name: String) {
        _uiState.update { it.copy(roomNameInput = name, errorMessage = null) }
    }

    fun onChatInputChanged(text: String) {
        _uiState.update { it.copy(chatInput = text) }
    }

    fun joinRoom(onJoined: (ActivePartySession) -> Unit) {
        val state = _uiState.value
        if (state.roomIdInput.isBlank()) {
            _uiState.update { it.copy(errorMessage = "Ingresa el ID de la sala") }
            return
        }

        _uiState.update { it.copy(isJoiningRoom = true, errorMessage = null) }
        viewModelScope.launch {
            val res = partyRepository.joinRoom(state.roomIdInput.trim())
            if (res.isSuccess) {
                val session = res.getOrThrow()
                partyPlaybackContext.setPartyPlayback(session.roomId, session.streamTicket)
                _uiState.update {
                    it.copy(
                        isJoiningRoom = false,
                        activeSession = session,
                        members = listOf("Tú")
                    )
                }
                partyRepository.startListening(_uiState.value.baseUrl, session)
                onJoined(session)
            } else {
                _uiState.update {
                    it.copy(
                        isJoiningRoom = false,
                        errorMessage = res.exceptionOrNull()?.message ?: "Error al unirse a la sala"
                    )
                }
            }
        }
    }

    fun createRoom(episodeId: String, onCreated: (ActivePartySession) -> Unit) {
        val state = _uiState.value
        val name = state.roomNameInput.ifBlank { "Sala KuraStream" }

        _uiState.update { it.copy(isCreatingRoom = true, errorMessage = null) }
        viewModelScope.launch {
            val res = partyRepository.createRoom(episodeId, name, isPublic = true)
            if (res.isSuccess) {
                val session = res.getOrThrow()
                partyPlaybackContext.setPartyPlayback(session.roomId, session.streamTicket)
                _uiState.update {
                    it.copy(
                        isCreatingRoom = false,
                        activeSession = session,
                        members = listOf("Tú (Host)")
                    )
                }
                partyRepository.startListening(_uiState.value.baseUrl, session)
                onCreated(session)
            } else {
                _uiState.update {
                    it.copy(
                        isCreatingRoom = false,
                        errorMessage = res.exceptionOrNull()?.message ?: "Error al crear la sala"
                    )
                }
            }
        }
    }

    fun setPartyPlaybackTicket(ticket: String) {
        val session = _uiState.value.activeSession
        partyPlaybackContext.setPartyPlayback(session?.roomId, ticket)
        partyRepository.updateStreamTicket(ticket)
    }

    fun sendMessage() {
        val session = _uiState.value.activeSession ?: return
        val text = _uiState.value.chatInput.trim()
        if (text.isBlank()) return

        _uiState.update { it.copy(chatInput = "") }
        viewModelScope.launch {
            partyRepository.sendMessage(session, text)
        }
    }

    fun leaveRoom() {
        partyPlaybackContext.clear()
        val session = _uiState.value.activeSession ?: return
        viewModelScope.launch {
            partyRepository.leaveRoom(session.roomId, session.memberId, session.memberToken)
            _uiState.update { it.copy(activeSession = null, messages = emptyList(), members = emptyList()) }
        }
    }

    override fun onCleared() {
        leaveRoom()
        super.onCleared()
    }
}
