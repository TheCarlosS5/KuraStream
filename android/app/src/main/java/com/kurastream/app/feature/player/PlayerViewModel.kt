package com.kurastream.app.feature.player

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import com.kurastream.app.core.model.*
import com.kurastream.app.core.player.*
import com.kurastream.app.core.network.PartyRealtimeEvent
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.preferences.UserSessionPreferences
import com.kurastream.app.core.repository.ActivePartySession
import com.kurastream.app.core.repository.CatalogRepository
import com.kurastream.app.core.repository.HistoryRepository
import com.kurastream.app.core.repository.WatchPartyRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import javax.inject.Inject

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@HiltViewModel
class PlayerViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    @ApplicationContext private val context: Context,
    private val catalogRepository: CatalogRepository,
    private val historyRepository: HistoryRepository,
    private val preferencesDataSource: KuraPreferencesDataSource,
    private val playbackConnectionManager: PlaybackConnectionManager,
    private val watchPartyRepository: WatchPartyRepository,
    private val partyPlaybackContext: com.kurastream.app.core.player.PartyPlaybackContext
) : ViewModel() {

    val episodeId: String = checkNotNull(savedStateHandle["episodeId"])

    private val _playerState = MutableStateFlow(PlayerState())
    val playerState: StateFlow<PlayerState> = _playerState.asStateFlow()

    private val _navigationEvents = MutableSharedFlow<String>(extraBufferCapacity = 1)
    val navigationEvents: SharedFlow<String> = _navigationEvents.asSharedFlow()

    /** Short notices for the player HUD (e.g. an action the Watch Party does not allow). */
    private val _hudMessages = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val hudMessages: SharedFlow<String> = _hudMessages.asSharedFlow()

    /** Last room state from the host, used to tell a real end of episode from a stale jump. */
    private var lastPartySync: PartySyncEvent? = null
    private var partyChatOpen = false

    private var player: Player? = null
    private var progressTrackingJob: Job? = null
    private var autoHideControlsJob: Job? = null
    private var nextCountdownJob: Job? = null
    private var retry503Job: Job? = null
    private var hasRetried503: Boolean = false

    private var baseUrl: String = ""
    private var userPreferences = UserSessionPreferences()
    private var hasAppliedCodecFallback = false
    private var lastSavedProgress = 0f
    private var speedBeforeTemporary2x: Float? = null

    /** Whether the media item currently loaded is a byte-range direct play (seekable in place). */
    private var currentStreamIsDirect = true
    private var introAutoSkipped = false
    private var creditsAutoSkipped = false
    private var lastPartySeekAtMs = 0L
    private var lastHostHeartbeatAtMs = 0L
    private var isCleared = false

    /** Remux seeks are coalesced: every one restarts ffmpeg on the server. */
    private var pendingSeekJob: Job? = null
    private var pendingSeekTarget: Float? = null

    /** "Up next" card: shown with the credits (or the last 20 s); dismissed by "Ver créditos". */
    private var upNextDismissed = false

    /** Live player handle for the UI; null until the MediaController connects. */
    val playerFlow: StateFlow<Player?> = playbackConnectionManager.player

    val doubleTapSeekSeconds: Int
        get() = userPreferences.doubleTapSeekSeconds

    private val playerListener = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            when (playbackState) {
                Player.STATE_BUFFERING -> {
                    _playerState.update { it.copy(isBuffering = true) }
                }
                Player.STATE_READY -> {
                    val ep = _playerState.value.episode
                    val duration = if (ep != null && ep.duration > 0) {
                        ep.duration
                    } else {
                        val playerDur = player?.duration ?: 0L
                        (playerDur / 1000f).coerceAtLeast(0f)
                    }
                    hasRetried503 = false
                    _playerState.update {
                        it.copy(isBuffering = false, durationSeconds = duration)
                    }
                }
                Player.STATE_ENDED -> {
                    onPlaybackEnded()
                }
                Player.STATE_IDLE -> {}
            }
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            _playerState.update { it.copy(isPlaying = isPlaying) }
            if (isPlaying) {
                startProgressTracker()
                scheduleControlsAutoHide()
            } else {
                stopProgressTracker()
                saveCurrentProgress()
            }
        }

        override fun onPlayerError(error: PlaybackException) {
            _playerState.value.episode?.let { handlePlaybackError(error, it) }
        }
    }

    init {
        viewModelScope.launch {
            userPreferences = preferencesDataSource.preferencesFlow.first()
            baseUrl = userPreferences.activeServerUrl ?: ""
            _playerState.update {
                it.copy(
                    doubleTapSeekSeconds = userPreferences.doubleTapSeekSeconds,
                    subtitleScale = userPreferences.subtitleScale
                )
            }

            playbackConnectionManager.getPlayer { p ->
                // The controller connects asynchronously; the screen may already be gone.
                if (isCleared) return@getPlayer
                player = p
                p.addListener(playerListener)
                viewModelScope.launch {
                    loadEpisodeAndInitPlayer()
                }
            }
        }

        // Track active Watch Party session
        viewModelScope.launch {
            watchPartyRepository.activeSession.collect { session ->
                if (session != null && _playerState.value.playbackSpeed != 1f) {
                    // Everyone in a room plays at 1x (same rule as the web); otherwise guests drift.
                    speedBeforeTemporary2x = null
                    setPlaybackSpeed(1f)
                }
                _playerState.update {
                    it.copy(
                        isWatchPartyActive = session != null,
                        watchPartyRoomId = session?.roomId,
                        isPartyHost = session?.isHost == true,
                        canControlPlayback = session == null || session.isHost || session.room?.allowGuestControls == true,
                        partyMessages = if (session == null) emptyList() else it.partyMessages,
                        partyUnreadCount = if (session == null) 0 else it.partyUnreadCount
                    )
                }
            }
        }

        // Handle Watch Party realtime events (Sync, RoomClosed)
        viewModelScope.launch {
            watchPartyRepository.realtimeEvents.collect { event ->
                when (event) {
                    is PartyRealtimeEvent.Sync -> {
                        lastPartySync = event.sync
                        handlePartySync(event.sync)
                    }
                    is PartyRealtimeEvent.MessagesBatch -> appendPartyMessages(event.messages)
                    is PartyRealtimeEvent.Message -> appendPartyMessages(listOf(event.message))
                    is PartyRealtimeEvent.RoomClosed -> {
                        partyPlaybackContext.clear()
                        watchPartyRepository.stopListening()
                        watchPartyRepository.setActiveSession(null)
                        _playerState.update {
                            it.copy(
                                isWatchPartyActive = false,
                                watchPartyRoomId = null,
                                errorMessage = "La sala de Watch Party ha sido cerrada por el anfitrión."
                            )
                        }
                    }
                    else -> {}
                }
            }
        }
    }

    private suspend fun loadEpisodeAndInitPlayer() {
        _playerState.update { it.copy(isBuffering = true, errorMessage = null) }

        // Fetch episode details using GET /api/episodes/{id} directly
        val epResult = catalogRepository.getEpisodeDetails(episodeId)
        if (epResult.isFailure) {
            _playerState.update {
                it.copy(
                    isBuffering = false,
                    errorMessage = "Episodio no encontrado en el servidor: ${epResult.exceptionOrNull()?.message}"
                )
            }
            return
        }

        val ep = epResult.getOrThrow()

        // Fetch show details using showId from episode
        val showResult = if (ep.showId.isNotBlank()) catalogRepository.getShowDetails(ep.showId) else null
        val show = showResult?.getOrNull()?.show

        // Regular seasons in order, specials after them (and never auto-advancing across).
        val sortedEpisodes = EpisodeOrder.ordered(showResult?.getOrNull()?.episodes.orEmpty())
        val nextEp = EpisodeOrder.next(sortedEpisodes, episodeId)

        // Initial tracks: preferred audio language; subtitles only when the audio is not already in
        // the viewer's language (a Spanish dub starts without Spanish subtitles).
        val preferredAudioIdx = StreamResolver.findBestAudioTrack(ep.audioTracks, userPreferences.preferredAudioLanguage)
        val audioLanguage = ep.audioTracks.getOrNull(preferredAudioIdx)
            ?.let { StreamResolver.trackLanguage(it.language, it.title) } ?: "und"
        val preferredSubIdx = StreamResolver.chooseSubtitleTrack(
            ep.subtitleTracks,
            userPreferences.preferredSubtitleLanguage,
            audioLanguage
        )

        _playerState.update {
            it.copy(
                episode = ep,
                show = show,
                durationSeconds = ep.duration,
                selectedAudioTrackIndex = preferredAudioIdx,
                selectedSubtitleTrackIndex = preferredSubIdx,
                availableAudioTracks = ep.audioTracks,
                availableSubtitleTracks = ep.subtitleTracks,
                chapters = ep.chapters,
                nextEpisode = nextEp,
                showEpisodes = sortedEpisodes,
                mediaBaseUrl = baseUrl
            )
        }

        // Resume point: the server is the source of truth (the local cache is empty on a fresh install
        // and stale after watching on another device). Finished episodes restart from the beginning.
        val serverProgress = historyRepository.getProgress(episodeId)
        val resumeSeconds = if (serverProgress != null) {
            if (serverProgress.completed) 0f else serverProgress.progressSeconds
        } else {
            val cached = historyRepository.getCachedHistory(
                serverId = userPreferences.activeServerId ?: "",
                username = userPreferences.activeUsername ?: "",
                profileId = userPreferences.activeProfileId ?: ""
            ).firstOrNull()?.firstOrNull { it.episodeId == episodeId }
            if (cached == null || cached.completed) 0f else cached.progressSeconds
        }

        setupPlayerInstance(ep, resumeSeconds, preferredAudioIdx, preferredSubIdx, initialPlayWhenReady = true)
        // Offer "start over" only for a meaningful resume point, and never inside a Watch Party
        // (the room decides the position there).
        if (resumeSeconds >= RESUME_NOTICE_MIN_SECONDS && watchPartyRepository.activeSession.value == null) {
            _playerState.update { it.copy(resumedFromSeconds = resumeSeconds) }
        }
    }

    /** Remembered across episodes and sessions; 0 restores the subtitle file's own sizes. */
    fun setSubtitleScale(scale: Float) {
        _playerState.update { it.copy(subtitleScale = scale) }
        viewModelScope.launch { preferencesDataSource.setSubtitleScale(scale) }
    }

    fun restartFromBeginning() {
        _playerState.update { it.copy(resumedFromSeconds = null) }
        introAutoSkipped = false
        creditsAutoSkipped = false
        seekToAbsolute(0f)
    }

    fun dismissResumeNotice() {
        _playerState.update { it.copy(resumedFromSeconds = null) }
    }

    /** Loads this show's watch progress for the episode panel. */
    fun loadEpisodeProgress() {
        val showId = _playerState.value.episode?.showId?.takeIf { it.isNotBlank() } ?: return
        viewModelScope.launch {
            val history = historyRepository.refreshHistory(
                serverId = userPreferences.activeServerId ?: "",
                username = userPreferences.activeUsername ?: "",
                profileId = userPreferences.activeProfileId ?: ""
            ).getOrNull()?.filter { it.showId == showId } ?: return@launch
            _playerState.update { state ->
                state.copy(
                    episodeProgress = history.associate { it.episodeId to it.progressSeconds },
                    episodeCompleted = history.associate { it.episodeId to it.completed }
                )
            }
        }
    }

    private fun setupPlayerInstance(
        episode: Episode,
        resumePositionSeconds: Float,
        audioTrackIndex: Int,
        subtitleTrackIndex: Int,
        forceH264: Boolean = false,
        initialPlayWhenReady: Boolean? = null
    ) {
        val p = player ?: return
        playbackConnectionManager.claim(this)
        pendingSeekJob?.cancel()
        pendingSeekJob = null
        pendingSeekTarget = null

        val wasPlaying = initialPlayWhenReady ?: (p.playWhenReady && p.playbackState != Player.STATE_ENDED)
        val currentSpeed = _playerState.value.playbackSpeed

        val resolved = StreamResolver.resolvePlaybackStream(
            baseUrl = baseUrl,
            episode = episode,
            requestedResumePositionSeconds = resumePositionSeconds,
            selectedAudioTrackIndex = audioTrackIndex,
            forceH264 = forceH264
        )

        currentStreamIsDirect = resolved.isDirectPlay

        _playerState.update {
            it.copy(
                streamStartOffsetSeconds = resolved.streamStartOffsetSeconds,
                positionSeconds = 0f,
                absolutePositionSeconds = resolved.streamStartOffsetSeconds,
                isBuffering = true
            )
        }

        val metadata = MediaMetadata.Builder()
            .setTitle(episode.title)
            .setArtist(_playerState.value.show?.title ?: "KuraStream")
            .setAlbumTitle(_playerState.value.show?.title)
            .build()

        val mediaItemBuilder = MediaItem.Builder()
            .setUri(resolved.streamUrl)
            .setMediaMetadata(metadata)

        // Sideload subtitle track if selected and not bitmap
        if (subtitleTrackIndex >= 0 && subtitleTrackIndex < episode.subtitleTracks.size) {
            val subTrack = episode.subtitleTracks[subtitleTrackIndex]
            if (subTrack.isBitmap) {
                _playerState.update {
                    it.copy(errorMessage = "Subtítulos bitmap (PGS/VobSub) no son compatibles con el renderizador de texto")
                }
            } else {
                // /api/subtitles converts every track (embedded, SRT, VTT) to ASS, so the MIME type is
                // always SSA regardless of the source format.
                val subUrl = com.kurastream.app.core.network.ServerUrlResolver.buildSubtitleUrl(
                    baseUrl = baseUrl,
                    episodeId = episode.id,
                    trackIndex = StreamResolver.resolveSubtitleTrackBackendParam(episode, subtitleTrackIndex),
                    startSeconds = resolved.streamStartOffsetSeconds
                )
                val subConfig = MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(subUrl))
                    .setMimeType(MimeTypes.TEXT_SSA)
                    .setLanguage(subTrack.language)
                    .setSelectionFlags(androidx.media3.common.C.SELECTION_FLAG_DEFAULT)
                    .build()
                mediaItemBuilder.setSubtitleConfigurations(listOf(subConfig))
            }
        }

        p.setMediaItem(mediaItemBuilder.build())
        p.prepare()

        if (resolved.requiresInternalSeek) {
            p.seekTo((resolved.targetSeekPositionSeconds * 1000).toLong())
        }

        p.setPlaybackSpeed(currentSpeed)
        p.playWhenReady = wasPlaying
        _playerState.update { it.copy(playWhenReady = wasPlaying, playbackSpeed = currentSpeed) }
        startProgressTracker()
    }

    private fun handlePlaybackError(error: PlaybackException, episode: Episode) {
        val isDecoderFailure = error.errorCode == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED ||
                error.errorCode == PlaybackException.ERROR_CODE_DECODING_FAILED

        if (isDecoderFailure && !hasAppliedCodecFallback) {
            hasAppliedCodecFallback = true
            val currentPos = _playerState.value.absolutePositionSeconds
            setupPlayerInstance(
                episode = episode,
                resumePositionSeconds = currentPos,
                audioTrackIndex = _playerState.value.selectedAudioTrackIndex,
                subtitleTrackIndex = _playerState.value.selectedSubtitleTrackIndex,
                forceH264 = true
            )
            return
        }

        // Check for HTTP 503 (Transcoding Service Unavailable / Busy)
        val causeMsg = error.cause?.message ?: ""
        val invalidResponseCode = (error.cause as? androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException)
            ?: (error.cause?.cause as? androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException)
        val is503 = invalidResponseCode?.responseCode == 503 || causeMsg.contains("503")

        if (is503) {
            if (!hasRetried503) {
                hasRetried503 = true
                val retryAfterSec = invalidResponseCode?.headerFields?.get("Retry-After")?.firstOrNull()?.toIntOrNull()
                    ?: invalidResponseCode?.headerFields?.get("retry-after")?.firstOrNull()?.toIntOrNull()
                    ?: 5

                _playerState.update {
                    it.copy(
                        isBuffering = true,
                        isTranscodingBusy = true,
                        retryAfterSeconds = retryAfterSec,
                        errorMessage = "El servidor de transcodificación está ocupado. Reintentando en ${retryAfterSec}s..."
                    )
                }

                retry503Job?.cancel()
                retry503Job = viewModelScope.launch {
                    delay(retryAfterSec * 1000L)
                    _playerState.update {
                        it.copy(
                            isTranscodingBusy = false,
                            retryAfterSeconds = null,
                            errorMessage = null
                        )
                    }
                    val currentPos = _playerState.value.absolutePositionSeconds
                    setupPlayerInstance(
                        episode = episode,
                        resumePositionSeconds = currentPos,
                        audioTrackIndex = _playerState.value.selectedAudioTrackIndex,
                        subtitleTrackIndex = _playerState.value.selectedSubtitleTrackIndex,
                        forceH264 = hasAppliedCodecFallback
                    )
                }
                return
            } else {
                _playerState.update {
                    it.copy(
                        isBuffering = false,
                        isTranscodingBusy = false,
                        retryAfterSeconds = null,
                        errorMessage = "El servidor de transcodificación continúa ocupado tras el reintento. Inténtalo más tarde."
                    )
                }
                return
            }
        }

        val msg = when (error.errorCode) {
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ->
                "Error de conexión con el servidor multimedia. Comprueba la red local."
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> {
                when {
                    causeMsg.contains("401") -> "Sesión expirada o no autorizada para reproducir este flujo."
                    causeMsg.contains("403") -> "Acceso denegado: contenido restringido para este perfil."
                    causeMsg.contains("404") -> "El archivo de video no fue encontrado en el servidor."
                    causeMsg.contains("416") -> "Rango de reproducción inválido."
                    else -> "El servidor devolvió un error de reproducción HTTP ($causeMsg)"
                }
            }
            else -> "Error en la reproducción: ${error.localizedMessage ?: "formato no compatible"}"
        }
        _playerState.update { it.copy(isBuffering = false, errorMessage = msg) }
    }

    private fun startProgressTracker() {
        progressTrackingJob?.cancel()
        progressTrackingJob = viewModelScope.launch {
            while (isActive) {
                val p = player ?: break
                // While a (re)started remux is loading, currentPosition still reflects the previous item;
                // combining it with the new offset would produce bogus jumps (and bogus saves/syncs).
                if (p.playbackState != Player.STATE_READY || pendingSeekTarget != null) {
                    delay(250)
                    continue
                }
                val posMs = p.currentPosition
                val offset = _playerState.value.streamStartOffsetSeconds
                val absPos = StreamResolver.calculateAbsolutePositionSeconds(offset, posMs)
                val duration = _playerState.value.durationSeconds

                val ep = _playerState.value.episode
                val inIntro = ep?.introStart != null && ep.introEnd != null &&
                        absPos >= ep.introStart && absPos <= ep.introEnd
                val outroStart = validOutroStart(ep, duration)
                val credits = creditsWithScene(ep, duration)
                val inCredits = credits != null && absPos >= credits.first && absPos < credits.second - 1f
                // With a scene after the credits there is no "outro" to jump over to the next episode.
                val inOutro = outroStart != null && credits == null && absPos >= outroStart

                // Auto skip intro once per episode, so seeking back into the intro is respected
                if (inIntro && !introAutoSkipped && userPreferences.autoSkipIntro && ep?.introEnd != null) {
                    introAutoSkipped = true
                    seekToAbsolute(ep.introEnd + 1f)
                    delay(500)
                    continue
                }

                // Auto skip outro: only the credits when a scene follows them, else to the next episode
                if (inCredits && !creditsAutoSkipped && userPreferences.autoSkipOutro && credits != null) {
                    creditsAutoSkipped = true
                    seekToAbsolute(credits.second)
                    delay(500)
                    continue
                }
                if (inOutro && userPreferences.autoSkipOutro && _playerState.value.nextEpisode != null) {
                    playNextEpisode()
                    break
                }

                _playerState.update {
                    it.copy(
                        positionSeconds = posMs / 1000f,
                        absolutePositionSeconds = absPos,
                        bufferedPercentage = p.bufferedPercentage,
                        isInIntro = inIntro,
                        isInOutro = inOutro,
                        isInCredits = inCredits
                    )
                }

                updateUpNext(absPos, duration)

                // Periodically save progress every 10 seconds
                if (kotlin.math.abs(absPos - lastSavedProgress) >= 10f) {
                    saveCurrentProgress()
                }

                // Host heartbeat: lets late joiners and drifting guests re-align without host action
                val session = watchPartyRepository.activeSession.value
                val nowMs = System.currentTimeMillis()
                if (session != null && session.isHost && p.isPlaying && nowMs - lastHostHeartbeatAtMs >= HOST_HEARTBEAT_MS) {
                    lastHostHeartbeatAtMs = nowMs
                    launch {
                        watchPartyRepository.syncPlayback(
                            session = session,
                            currentTime = absPos,
                            isPlaying = true,
                            rate = _playerState.value.playbackSpeed,
                            action = "heartbeat",
                            episodeId = episodeId
                        )
                    }
                }

                delay(500)
            }
        }
    }

    private fun stopProgressTracker() {
        progressTrackingJob?.cancel()
        progressTrackingJob = null
    }

    fun saveCurrentProgress() {
        val absPos = _playerState.value.absolutePositionSeconds
        val duration = _playerState.value.durationSeconds
        if (absPos > 2f) {
            lastSavedProgress = absPos
            viewModelScope.launch {
                historyRepository.saveProgress(episodeId, absPos, duration)
            }
        }
    }

    private fun appendPartyMessages(messages: List<PartyMessage>) {
        if (messages.isEmpty()) return
        _playerState.update { state ->
            val known = state.partyMessages.map { it.id }.toHashSet()
            val fresh = messages.filter { it.id !in known }
            if (fresh.isEmpty()) return@update state
            val unreadDelta = if (partyChatOpen) 0 else fresh.count { it.type == "chat" }
            state.copy(
                partyMessages = (state.partyMessages + fresh).takeLast(MAX_PARTY_MESSAGES),
                partyUnreadCount = state.partyUnreadCount + unreadDelta
            )
        }
    }

    fun setPartyChatOpen(open: Boolean) {
        partyChatOpen = open
        if (open) _playerState.update { it.copy(partyUnreadCount = 0) }
    }

    fun sendPartyMessage(text: String) {
        val message = text.trim()
        val session = watchPartyRepository.activeSession.value ?: return
        if (message.isEmpty()) return
        viewModelScope.launch {
            if (watchPartyRepository.sendMessage(session, message).isFailure) {
                _hudMessages.tryEmit("No se pudo enviar el mensaje")
            }
        }
    }

    /** Reactions use the same keys as the web ("flame", "heart", "smile", "sparkles", "thumbs-up"). */
    fun sendPartyReaction(key: String) {
        val session = watchPartyRepository.activeSession.value ?: return
        viewModelScope.launch { watchPartyRepository.sendMessage(session, key, type = "reaction") }
    }

    /** Guests in a host-only room cannot play, pause or seek for everyone. */
    private fun ensureCanControl(): Boolean {
        if (_playerState.value.canControlPlayback) return true
        _hudMessages.tryEmit("El anfitrión controla la reproducción")
        return false
    }

    /** Host, or a guest allowed to drive playback, broadcasts its actions to the room. */
    private fun broadcastPlayback(action: String, currentTime: Float, isPlaying: Boolean, episodeId: String = this.episodeId) {
        val session = watchPartyRepository.activeSession.value ?: return
        if (!session.isHost && session.room?.allowGuestControls != true) return
        viewModelScope.launch {
            watchPartyRepository.syncPlayback(
                session = session,
                currentTime = currentTime,
                isPlaying = isPlaying,
                rate = 1f,
                action = action,
                episodeId = episodeId
            )
        }
    }

    private fun handlePartySync(sync: PartySyncEvent) {
        val session = watchPartyRepository.activeSession.value ?: return
        if (session.isHost) return

        // Host moved to another episode: follow them instead of seeking inside the wrong file.
        val hostEpisode = sync.episodeId
        if (!hostEpisode.isNullOrBlank() && hostEpisode != episodeId) {
            saveCurrentProgress()
            _navigationEvents.tryEmit(hostEpisode)
            return
        }

        val currentAbs = _playerState.value.absolutePositionSeconds
        val isPlaying = _playerState.value.isPlaying
        val nowMs = System.currentTimeMillis()

        var decision = WatchPartySyncController.evaluateSync(
            hostEvent = sync,
            clientAbsolutePositionSeconds = currentAbs,
            clientIsPlaying = isPlaying,
            isClientHost = false,
            nowMs = nowMs,
            driftToleranceSeconds = if (currentStreamIsDirect) {
                WatchPartySyncController.DRIFT_TOLERANCE_SECONDS
            } else {
                WatchPartySyncController.TRANSCODED_DRIFT_TOLERANCE_SECONDS
            }
        )

        // Give a just-issued seek time to buffer before judging drift again (avoids seek storms).
        val isSeek = decision.action == PartySyncAction.SEEK ||
                decision.action == PartySyncAction.SEEK_AND_PLAY ||
                decision.action == PartySyncAction.SEEK_AND_PAUSE
        if (isSeek) {
            if (nowMs - lastPartySeekAtMs < PARTY_SEEK_COOLDOWN_MS || _playerState.value.isBuffering) {
                decision = when (decision.action) {
                    PartySyncAction.SEEK_AND_PLAY -> SyncDecision(if (isPlaying) PartySyncAction.NONE else PartySyncAction.PLAY)
                    PartySyncAction.SEEK_AND_PAUSE -> SyncDecision(if (isPlaying) PartySyncAction.PAUSE else PartySyncAction.NONE)
                    else -> SyncDecision(PartySyncAction.NONE)
                }
            } else {
                lastPartySeekAtMs = nowMs
            }
        }

        when (decision.action) {
            PartySyncAction.NONE -> {}
            PartySyncAction.SEEK -> {
                decision.targetPositionSeconds?.let { seekToAbsolute(it, fromPartySync = true) }
            }
            PartySyncAction.PLAY -> {
                play(fromPartySync = true)
            }
            PartySyncAction.PAUSE -> {
                pause(fromPartySync = true)
            }
            PartySyncAction.SEEK_AND_PLAY -> {
                decision.targetPositionSeconds?.let { seekToAbsolute(it, fromPartySync = true) }
                play(fromPartySync = true)
            }
            PartySyncAction.SEEK_AND_PAUSE -> {
                decision.targetPositionSeconds?.let { seekToAbsolute(it, fromPartySync = true) }
                pause(fromPartySync = true)
            }
        }
    }

    fun play(fromPartySync: Boolean = false) {
        if (!fromPartySync && !ensureCanControl()) return
        // Play after the end starts the episode over (ExoPlayer ignores play() once ended).
        if (!fromPartySync && player?.playbackState == Player.STATE_ENDED) {
            upNextDismissed = false
            seekToAbsolute(0f)
        }
        player?.play()
        _playerState.update { it.copy(playWhenReady = true, endScreenVisible = false) }
        scheduleControlsAutoHide()
        if (!fromPartySync) broadcastPlayback("play", _playerState.value.absolutePositionSeconds, isPlaying = true)
    }

    fun pause(fromPartySync: Boolean = false) {
        if (!fromPartySync && !ensureCanControl()) return
        player?.pause()
        _playerState.update { it.copy(playWhenReady = false) }
        showControlsPermanently()
        if (!fromPartySync) broadcastPlayback("pause", _playerState.value.absolutePositionSeconds, isPlaying = false)
    }

    /** Called when the app goes to the background: the periodic save can be up to 10 s behind. */
    fun onAppBackgrounded() {
        val absPos = _playerState.value.absolutePositionSeconds
        if (absPos > 2f) {
            lastSavedProgress = absPos
            historyRepository.saveProgressDetached(episodeId, absPos, _playerState.value.durationSeconds)
        }
    }

    fun togglePlayPause() {
        if (_playerState.value.isPlaying) pause() else play()
    }

    fun seekRelative(seconds: Float) {
        if (!ensureCanControl()) return
        val currentAbs = pendingSeekTarget ?: _playerState.value.absolutePositionSeconds
        val duration = _playerState.value.durationSeconds
        val target = (currentAbs + seconds).coerceIn(0f, if (duration > 0) duration else Float.MAX_VALUE)
        seekToAbsolute(target)
    }

    fun seekDoubleTap(forward: Boolean) {
        val seconds = _playerState.value.doubleTapSeekSeconds.toFloat()
        val delta = if (forward) seconds else -seconds
        seekRelative(delta)
    }

    fun seekToAbsolute(requestedSeconds: Float, fromPartySync: Boolean = false) {
        val ep = _playerState.value.episode ?: return
        if (!fromPartySync && !ensureCanControl()) return
        val duration = _playerState.value.durationSeconds
        // Never seek past the last second: landing on the very end fires "ended" right away.
        val targetSeconds = if (duration > 0f) requestedSeconds.coerceIn(0f, (duration - 1f).coerceAtLeast(0f)) else requestedSeconds.coerceAtLeast(0f)
        if (_playerState.value.endScreenVisible && targetSeconds < duration - 1f) {
            _playerState.update { it.copy(endScreenVisible = false) }
        }

        // Must match what is actually loaded: after a codec fallback or audio switch the stream is a
        // remux even if the file itself could be direct-played, and seekTo() cannot move inside it.
        if (currentStreamIsDirect) {
            player?.seekTo((targetSeconds * 1000).toLong())
        } else {
            // Several quick seeks (double taps, scrubbing) become a single stream restart.
            pendingSeekTarget = targetSeconds
            pendingSeekJob?.cancel()
            pendingSeekJob = viewModelScope.launch {
                delay(REMUX_SEEK_DEBOUNCE_MS)
                val target = pendingSeekTarget ?: return@launch
                pendingSeekJob = null
                setupPlayerInstance(
                    episode = ep,
                    resumePositionSeconds = target,
                    audioTrackIndex = _playerState.value.selectedAudioTrackIndex,
                    subtitleTrackIndex = _playerState.value.selectedSubtitleTrackIndex,
                    forceH264 = hasAppliedCodecFallback
                )
            }
        }
        if (targetSeconds < upNextTriggerSeconds() - 1f) {
            upNextDismissed = false
            if (_playerState.value.upNextVisible) hideUpNext()
        }
        _playerState.update { it.copy(absolutePositionSeconds = targetSeconds) }
        scheduleControlsAutoHide()
        if (!fromPartySync) broadcastPlayback("seek", targetSeconds, isPlaying = _playerState.value.isPlaying)
    }

    fun selectAudioTrack(index: Int) {
        val ep = _playerState.value.episode ?: return
        val currentAbs = _playerState.value.absolutePositionSeconds
        _playerState.update { it.copy(selectedAudioTrackIndex = index) }

        setupPlayerInstance(
            episode = ep,
            resumePositionSeconds = currentAbs,
            audioTrackIndex = index,
            subtitleTrackIndex = _playerState.value.selectedSubtitleTrackIndex,
            forceH264 = hasAppliedCodecFallback
        )
    }

    fun selectSubtitleTrack(index: Int) {
        val ep = _playerState.value.episode ?: return
        val currentAbs = _playerState.value.absolutePositionSeconds
        _playerState.update { it.copy(selectedSubtitleTrackIndex = index) }

        setupPlayerInstance(
            episode = ep,
            resumePositionSeconds = currentAbs,
            audioTrackIndex = _playerState.value.selectedAudioTrackIndex,
            subtitleTrackIndex = index,
            forceH264 = hasAppliedCodecFallback
        )
    }

    fun setPlaybackSpeed(speed: Float) {
        if (speed != 1f && watchPartyRepository.activeSession.value != null) {
            _hudMessages.tryEmit("La velocidad es fija durante un Watch Party")
            return
        }
        player?.setPlaybackSpeed(speed)
        _playerState.update { it.copy(playbackSpeed = speed) }
    }

    fun startTemporary2x() {
        if (watchPartyRepository.activeSession.value != null) return
        if (speedBeforeTemporary2x == null) {
            speedBeforeTemporary2x = _playerState.value.playbackSpeed
            setPlaybackSpeed(2.0f)
        }
    }

    fun stopTemporary2x() {
        val restore = speedBeforeTemporary2x ?: return
        speedBeforeTemporary2x = null
        setPlaybackSpeed(restore)
    }

    fun toggleFitMode() {
        val next = when (_playerState.value.videoFitMode) {
            VideoFitMode.FIT -> VideoFitMode.ZOOM
            VideoFitMode.ZOOM -> VideoFitMode.STRETCH
            VideoFitMode.STRETCH -> VideoFitMode.FIT
        }
        _playerState.update { it.copy(videoFitMode = next) }
    }

    fun onScreenTap() {
        if (_playerState.value.controlsLocked) {
            // When locked, tapping shows ONLY the unlock button for 3s
            _playerState.update { it.copy(controlsVisible = true) }
            scheduleControlsAutoHide()
        } else {
            toggleControls()
        }
    }

    fun toggleControls() {
        if (_playerState.value.controlsLocked) return
        val visible = !_playerState.value.controlsVisible
        _playerState.update { it.copy(controlsVisible = visible) }
        if (visible && _playerState.value.isPlaying) {
            scheduleControlsAutoHide()
        }
    }

    fun toggleLock() {
        val nextLocked = !_playerState.value.controlsLocked
        _playerState.update {
            it.copy(
                controlsLocked = nextLocked,
                controlsVisible = !nextLocked // hide controls immediately when locking
            )
        }
    }

    fun skipIntro() {
        val ep = _playerState.value.episode
        val target = ep?.introEnd
        if (target != null) {
            introAutoSkipped = true
            seekToAbsolute(target + 1f)
        }
    }

    fun skipOutro() {
        playNextEpisode()
    }

    /** Jumps over ending credits to the scene that follows them. */
    fun skipCredits() {
        val ep = _playerState.value.episode
        val credits = creditsWithScene(ep, _playerState.value.durationSeconds) ?: return
        creditsAutoSkipped = true
        seekToAbsolute(credits.second)
    }

    /** Outro mark if plausible: one in the first half of the episode is a bad AniSkip submission. */
    private fun validOutroStart(ep: Episode?, duration: Float): Float? =
        ep?.outroStart?.takeIf { duration <= 0f || (it > duration * 0.5f && it < duration - 5f) }

    /** Ending credits with a scene after them (start, end), or null. */
    private fun creditsWithScene(ep: Episode?, duration: Float): Pair<Float, Float>? {
        val start = validOutroStart(ep, duration) ?: return null
        val end = ep?.outroEnd ?: return null
        if (duration <= 0f || end <= start || duration - end < 30f) return null
        return start to end
    }

    fun playNextEpisode() {
        val next = _playerState.value.nextEpisode ?: return
        playEpisode(next.id)
    }

    /** Switches to another episode of the show (episode panel, next episode, auto-advance). */
    fun playEpisode(targetEpisodeId: String) {
        if (targetEpisodeId == episodeId) return
        val next = _playerState.value.showEpisodes.firstOrNull { it.id == targetEpisodeId }
            ?: _playerState.value.nextEpisode?.takeIf { it.id == targetEpisodeId }
            ?: return
        val session = watchPartyRepository.activeSession.value
        if (session != null && !session.isHost) {
            _hudMessages.tryEmit("El anfitrión elige el episodio")
            return
        }
        saveCurrentProgress()
        cancelNextEpisodeCountdown()

        if (session != null) {
            viewModelScope.launch {
                watchPartyRepository.syncPlayback(
                    session = session,
                    currentTime = 0f,
                    isPlaying = true,
                    rate = 1f,
                    action = "change_episode",
                    episodeId = next.id
                )
            }
        }

        _navigationEvents.tryEmit(next.id)
    }

    fun createWatchParty(
        roomName: String = "Watch Party",
        isPublic: Boolean = true,
        onCreated: ((ActivePartySession) -> Unit)? = null
    ) {
        viewModelScope.launch {
            val ep = _playerState.value.episode ?: return@launch
            val defaultName = _playerState.value.show?.let { "${it.title} - T${ep.seasonNumber}E${ep.episodeNumber}" }
                ?: roomName
            val result = watchPartyRepository.createRoom(
                episodeId = ep.id,
                roomName = defaultName,
                isPublic = isPublic
            )
            if (result.isSuccess) {
                val session = result.getOrThrow()
                partyPlaybackContext.setPartyPlayback(session.roomId, session.streamTicket)
                watchPartyRepository.startListening(baseUrl, session)
                onCreated?.invoke(session)
            } else {
                _playerState.update {
                    it.copy(errorMessage = "Error al crear la sala: ${result.exceptionOrNull()?.message}")
                }
            }
        }
    }

    fun leaveWatchParty() {
        partyPlaybackContext.clear()
        viewModelScope.launch {
            val session = watchPartyRepository.activeSession.value ?: return@launch
            watchPartyRepository.leaveRoom(
                roomId = session.roomId,
                memberId = session.memberId,
                memberToken = session.memberToken
            )
        }
    }

    private fun onPlaybackEnded() {
        val duration = _playerState.value.durationSeconds
        // A guest that ran off the end while the host is still mid-episode re-aligns instead.
        val session = watchPartyRepository.activeSession.value
        val hostSync = lastPartySync
        if (session != null && !session.isHost && hostSync != null && duration > 0f) {
            val hostAt = WatchPartySyncController.expectedHostPositionSeconds(hostSync, System.currentTimeMillis())
            if (duration - hostAt > END_GUARD_SECONDS) {
                seekToAbsolute(hostAt, fromPartySync = true)
                if (hostSync.isPlaying) play(fromPartySync = true)
                return
            }
        }
        // A remux can report the end long before the episode does when the connection drops.
        val position = _playerState.value.absolutePositionSeconds
        if (!currentStreamIsDirect && duration > 0f && duration - position > END_GUARD_SECONDS) {
            retryPlayback()
            return
        }

        saveCurrentProgress()
        val next = _playerState.value.nextEpisode
        if (next != null && canAutoAdvance() && !upNextDismissed) {
            playNextEpisode()
        } else {
            nextCountdownJob?.cancel()
            _playerState.update { it.copy(upNextVisible = false, nextEpisodeCountdown = null, endScreenVisible = true) }
            showControlsPermanently()
        }
    }

    /** End screen "Volver a ver". */
    fun replayEpisode() {
        upNextDismissed = false
        introAutoSkipped = false
        creditsAutoSkipped = false
        _playerState.update { it.copy(endScreenVisible = false) }
        seekToAbsolute(0f)
        play()
    }

    private fun canAutoAdvance(): Boolean {
        val session = watchPartyRepository.activeSession.value
        return userPreferences.autoPlayNext && (session == null || session.isHost)
    }

    /** Credits start (when the episode has a valid outro mark) or the last 20 seconds. */
    private fun upNextTriggerSeconds(): Float {
        val duration = _playerState.value.durationSeconds
        val ep = _playerState.value.episode
        // A scene after the credits must not be skipped by the countdown.
        val outro = validOutroStart(ep, duration)
        if (outro != null && creditsWithScene(ep, duration) == null) return outro
        return if (duration > 120f) duration - 20f else Float.MAX_VALUE
    }

    private fun updateUpNext(absPos: Float, duration: Float) {
        if (_playerState.value.nextEpisode == null || upNextDismissed || duration <= 0f) return
        if (absPos >= upNextTriggerSeconds()) {
            if (!_playerState.value.upNextVisible) showUpNext(absPos, duration)
        } else if (_playerState.value.upNextVisible) {
            hideUpNext()
        }
    }

    private fun showUpNext(absPos: Float, duration: Float) {
        _playerState.update { it.copy(upNextVisible = true) }
        nextCountdownJob?.cancel()
        if (!canAutoAdvance()) return
        var seconds = minOf(UP_NEXT_COUNTDOWN_SECONDS, kotlin.math.ceil(duration - absPos).toInt().coerceAtLeast(1))
        nextCountdownJob = viewModelScope.launch {
            _playerState.update { it.copy(nextEpisodeCountdown = seconds) }
            while (seconds > 0) {
                delay(1000)
                // The countdown waits while the video is paused.
                if (player?.isPlaying == true) seconds--
                _playerState.update { it.copy(nextEpisodeCountdown = seconds) }
            }
            playNextEpisode()
        }
    }

    private fun hideUpNext() {
        nextCountdownJob?.cancel()
        _playerState.update { it.copy(upNextVisible = false, nextEpisodeCountdown = null) }
    }

    /** "Ver créditos": hide the card and do not jump to the next episode on its own. */
    fun cancelNextEpisodeCountdown() {
        upNextDismissed = true
        hideUpNext()
    }

    /** Re-prepares the stream where it failed (a plain seek does not leave the error state). */
    fun retryPlayback() {
        val ep = _playerState.value.episode
        hasRetried503 = false
        _playerState.update { it.copy(errorMessage = null, isTranscodingBusy = false, retryAfterSeconds = null) }
        if (ep == null) {
            viewModelScope.launch { loadEpisodeAndInitPlayer() }
            return
        }
        setupPlayerInstance(
            episode = ep,
            resumePositionSeconds = _playerState.value.absolutePositionSeconds,
            audioTrackIndex = _playerState.value.selectedAudioTrackIndex,
            subtitleTrackIndex = _playerState.value.selectedSubtitleTrackIndex,
            forceH264 = hasAppliedCodecFallback,
            initialPlayWhenReady = true
        )
    }

    /** Keeps the controls up while the user is interacting with them (e.g. dragging the seek bar). */
    fun onUserInteraction() {
        if (_playerState.value.controlsVisible && !_playerState.value.controlsLocked) {
            scheduleControlsAutoHide()
        }
    }

    private fun scheduleControlsAutoHide() {
        autoHideControlsJob?.cancel()
        autoHideControlsJob = viewModelScope.launch {
            delay(4000)
            if (_playerState.value.isPlaying) {
                _playerState.update { it.copy(controlsVisible = false) }
            }
        }
    }

    private fun showControlsPermanently() {
        autoHideControlsJob?.cancel()
        _playerState.update { it.copy(controlsVisible = true) }
    }

    fun getPlayer(): Player? = player

    override fun onCleared() {
        isCleared = true
        // viewModelScope is already cancelled here, so the final save must run on a detached scope.
        val p = player
        val finalPosition = if (p != null && p.playbackState == Player.STATE_READY) {
            StreamResolver.calculateAbsolutePositionSeconds(_playerState.value.streamStartOffsetSeconds, p.currentPosition)
        } else {
            _playerState.value.absolutePositionSeconds
        }
        if (finalPosition > 2f) {
            historyRepository.saveProgressDetached(episodeId, finalPosition, _playerState.value.durationSeconds)
        }
        stopProgressTracker()
        pendingSeekJob?.cancel()
        nextCountdownJob?.cancel()
        retry503Job?.cancel()
        retry503Job = null
        p?.removeListener(playerListener)
        // Leaving the player must stop audio, unless the next episode's screen already took over.
        playbackConnectionManager.stopIfOwner(this)
        player = null
        super.onCleared()
    }

    private companion object {
        const val RESUME_NOTICE_MIN_SECONDS = 30f
        const val PARTY_SEEK_COOLDOWN_MS = 4_000L
        const val HOST_HEARTBEAT_MS = 10_000L
        const val REMUX_SEEK_DEBOUNCE_MS = 400L
        const val UP_NEXT_COUNTDOWN_SECONDS = 10
        const val END_GUARD_SECONDS = 30f
        const val MAX_PARTY_MESSAGES = 150
    }
}
