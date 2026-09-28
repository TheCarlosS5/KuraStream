package com.kurastream.app.core.player

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Thread-safe in-memory context holding active Watch Party playback authorization.
 * Avoids leaking capability tokens into navigation URLs or persistent backstack bundles.
 */
@Singleton
class PartyPlaybackContext @Inject constructor() {

    private val _streamCapabilityToken = MutableStateFlow<String?>(null)
    val streamCapabilityToken: StateFlow<String?> = _streamCapabilityToken.asStateFlow()

    private val _activePartyRoomId = MutableStateFlow<String?>(null)
    val activePartyRoomId: StateFlow<String?> = _activePartyRoomId.asStateFlow()

    fun setPartyPlayback(roomId: String?, token: String?) {
        _activePartyRoomId.value = roomId
        _streamCapabilityToken.value = token
    }

    fun clear() {
        _activePartyRoomId.value = null
        _streamCapabilityToken.value = null
    }
}
