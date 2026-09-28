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
            _playerState.update { it.copy(doubleTapSeekSeconds = userPreferences.doubleTapSeekSeconds) }

            playbackConnectionManager.getPlayer { p ->
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
                _playerState.update {
                    it.copy(
                        isWatchPartyActive = session != null,
                        watchPartyRoomId = session?.roomId
                    )
                }
            }
        }

        // Handle Watch Party realtime events (Sync, RoomClosed)
        viewModelScope.launch {
            watchPartyRepository.realtimeEvents.collect { event ->
                when (event) {
                    is PartyRealtimeEvent.Sync -> {
                        handlePartySync(event.sync)
                    }
                    is PartyRealtimeEvent.RoomClosed -> {
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

        // Determine next episode strictly by seasonNumber then episodeNumber
        val nextEp = showResult?.getOrNull()?.episodes?.let { allEps ->
            val sorted = allEps.sortedWith(compareBy({ it.seasonNumber }, { it.episodeNumber }))
            val idx = sorted.indexOfFirst { it.id == episodeId }
            if (idx >= 0 && idx + 1 < sorted.size) sorted[idx + 1] else null
        }

        // Check user preferences for initial audio/subtitle tracks
        val preferredAudioIdx = StreamResolver.findBestAudioTrack(ep.audioTracks, userPreferences.preferredAudioLanguage)
        val preferredSubIdx = ep.subtitleTracks.indexOfFirst {
            StreamResolver.normalizeLanguageCode(it.language) == StreamResolver.normalizeLanguageCode(userPreferences.preferredSubtitleLanguage)
        }

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
                nextEpisode = nextEp
            )
        }

        // Fetch user resume progress
        val progressRes = historyRepository.getCachedHistory(
            serverId = userPreferences.activeServerId ?: "",
            username = userPreferences.activeUsername ?: "",
            profileId = userPreferences.activeProfileId ?: ""
        ).firstOrNull()?.firstOrNull { it.episodeId == episodeId }

        val resumeSeconds = progressRes?.progressSeconds ?: 0f

        setupPlayerInstance(ep, resumeSeconds, preferredAudioIdx, preferredSubIdx, initialPlayWhenReady = true)
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

        val wasPlaying = initialPlayWhenReady ?: (p.playWhenReady && p.playbackState != Player.STATE_ENDED)
        val currentSpeed = _playerState.value.playbackSpeed

        val resolved = StreamResolver.resolvePlaybackStream(
            baseUrl = baseUrl,
            episode = episode,
            requestedResumePositionSeconds = resumePositionSeconds,
            selectedAudioTrackIndex = audioTrackIndex,
            forceH264 = forceH264
        )

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
                val subUrl = "$baseUrl/api/subtitles/${episode.id}/${subTrack.index}"
                val mimeType = when (subTrack.format.lowercase()) {
                    "srt" -> MimeTypes.APPLICATION_SUBRIP
                    "vtt" -> MimeTypes.TEXT_VTT
                    else -> MimeTypes.TEXT_SSA
                }
                val subConfig = MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(subUrl))
                    .setMimeType(mimeType)
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
                val posMs = p.currentPosition
                val offset = _playerState.value.streamStartOffsetSeconds
                val absPos = StreamResolver.calculateAbsolutePositionSeconds(offset, posMs)
                val duration = _playerState.value.durationSeconds

                val ep = _playerState.value.episode
                val inIntro = ep?.introStart != null && ep.introEnd != null &&
                        absPos >= ep.introStart && absPos <= ep.introEnd
                val inOutro = ep?.outroStart != null && absPos >= ep.outroStart

                // Auto skip intro if user enabled
                if (inIntro && userPreferences.autoSkipIntro && ep?.introEnd != null) {
                    seekToAbsolute(ep.introEnd + 1f)
                }

                // Auto skip outro if user enabled and next episode exists
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
                        isInOutro = inOutro
                    )
                }

                // Periodically save progress every 10 seconds
                if (kotlin.math.abs(absPos - lastSavedProgress) >= 10f) {
                    saveCurrentProgress()
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

    private fun handlePartySync(sync: PartySyncEvent) {
        val session = watchPartyRepository.activeSession.value ?: return
        val currentAbs = _playerState.value.absolutePositionSeconds
        val isPlaying = _playerState.value.isPlaying

        val decision = WatchPartySyncController.evaluateSync(
            hostEvent = sync,
            clientAbsolutePositionSeconds = currentAbs,
            clientIsPlaying = isPlaying,
            isClientHost = session.isHost
        )

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
        player?.play()
        _playerState.update { it.copy(playWhenReady = true) }
        scheduleControlsAutoHide()

        if (!fromPartySync) {
            val session = watchPartyRepository.activeSession.value
            if (session != null && session.isHost) {
                viewModelScope.launch {
                    watchPartyRepository.syncPlayback(
                        session = session,
                        currentTime = _playerState.value.absolutePositionSeconds,
                        isPlaying = true,
                        rate = _playerState.value.playbackSpeed,
                        action = "play",
                        episodeId = episodeId
                    )
                }
            }
        }
    }

    fun pause(fromPartySync: Boolean = false) {
        player?.pause()
        _playerState.update { it.copy(playWhenReady = false) }
        showControlsPermanently()

        if (!fromPartySync) {
            val session = watchPartyRepository.activeSession.value
            if (session != null && session.isHost) {
                viewModelScope.launch {
                    watchPartyRepository.syncPlayback(
                        session = session,
                        currentTime = _playerState.value.absolutePositionSeconds,
                        isPlaying = false,
                        rate = _playerState.value.playbackSpeed,
                        action = "pause",
                        episodeId = episodeId
                    )
                }
            }
        }
    }

    fun togglePlayPause() {
        if (_playerState.value.isPlaying) pause() else play()
    }

    fun seekRelative(seconds: Float) {
        val currentAbs = _playerState.value.absolutePositionSeconds
        val duration = _playerState.value.durationSeconds
        val target = (currentAbs + seconds).coerceIn(0f, if (duration > 0) duration else Float.MAX_VALUE)
        seekToAbsolute(target)
    }

    fun seekDoubleTap(forward: Boolean) {
        val seconds = _playerState.value.doubleTapSeekSeconds.toFloat()
        val delta = if (forward) seconds else -seconds
        seekRelative(delta)
    }

    fun seekToAbsolute(targetSeconds: Float, fromPartySync: Boolean = false) {
        val ep = _playerState.value.episode ?: return
        val isDirect = StreamResolver.canDirectPlay(ep, _playerState.value.selectedAudioTrackIndex)

        if (isDirect) {
            player?.seekTo((targetSeconds * 1000).toLong())
        } else {
            setupPlayerInstance(
                episode = ep,
                resumePositionSeconds = targetSeconds,
                audioTrackIndex = _playerState.value.selectedAudioTrackIndex,
                subtitleTrackIndex = _playerState.value.selectedSubtitleTrackIndex,
                forceH264 = hasAppliedCodecFallback
            )
        }
        _playerState.update { it.copy(absolutePositionSeconds = targetSeconds) }
        scheduleControlsAutoHide()

        if (!fromPartySync) {
            val session = watchPartyRepository.activeSession.value
            if (session != null && session.isHost) {
                viewModelScope.launch {
                    watchPartyRepository.syncPlayback(
                        session = session,
                        currentTime = targetSeconds,
                        isPlaying = _playerState.value.isPlaying,
                        rate = _playerState.value.playbackSpeed,
                        action = "seek",
                        episodeId = episodeId
                    )
                }
            }
        }
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
        player?.setPlaybackSpeed(speed)
        _playerState.update { it.copy(playbackSpeed = speed) }
    }

    fun startTemporary2x() {
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
            seekToAbsolute(target + 1f)
        }
    }

    fun skipOutro() {
        playNextEpisode()
    }

    fun playNextEpisode() {
        val next = _playerState.value.nextEpisode ?: return
        saveCurrentProgress()
        cancelNextEpisodeCountdown()

        val session = watchPartyRepository.activeSession.value
        if (session != null && session.isHost) {
            viewModelScope.launch {
                watchPartyRepository.syncPlayback(
                    session = session,
                    currentTime = 0f,
                    isPlaying = true,
                    rate = _playerState.value.playbackSpeed,
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
        saveCurrentProgress()
        if (_playerState.value.nextEpisode != null && userPreferences.autoPlayNext) {
            startNextEpisodeCountdown()
        } else {
            showControlsPermanently()
        }
    }

    private fun startNextEpisodeCountdown() {
        nextCountdownJob?.cancel()
        nextCountdownJob = viewModelScope.launch {
            for (i in 5 downTo 1) {
                _playerState.update { it.copy(nextEpisodeCountdown = i) }
                delay(1000)
            }
            _playerState.update { it.copy(nextEpisodeCountdown = null) }
            playNextEpisode()
        }
    }

    fun cancelNextEpisodeCountdown() {
        nextCountdownJob?.cancel()
        _playerState.update { it.copy(nextEpisodeCountdown = null) }
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
        saveCurrentProgress()
        stopProgressTracker()
        partyPlaybackContext.clear()
        retry503Job?.cancel()
        retry503Job = null
        player?.removeListener(playerListener)
        player = null
        super.onCleared()
    }
}
