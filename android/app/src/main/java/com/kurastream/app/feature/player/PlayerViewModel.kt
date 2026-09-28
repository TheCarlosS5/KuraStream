package com.kurastream.app.feature.player

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.kurastream.app.core.model.*
import com.kurastream.app.core.network.ServerUrlResolver
import com.kurastream.app.core.player.*
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.preferences.UserSessionPreferences
import com.kurastream.app.core.repository.CatalogRepository
import com.kurastream.app.core.repository.HistoryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import javax.inject.Inject

@HiltViewModel
class PlayerViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    @ApplicationContext private val context: Context,
    private val catalogRepository: CatalogRepository,
    private val historyRepository: HistoryRepository,
    private val preferencesDataSource: KuraPreferencesDataSource
) : ViewModel() {

    val episodeId: String = checkNotNull(savedStateHandle["episodeId"])

    private val _playerState = MutableStateFlow(PlayerState())
    val playerState: StateFlow<PlayerState> = _playerState.asStateFlow()

    private var exoPlayer: ExoPlayer? = null
    private var progressTrackingJob: Job? = null
    private var autoHideControlsJob: Job? = null
    private var nextCountdownJob: Job? = null

    private var baseUrl: String = ""
    private var userPreferences = UserSessionPreferences()
    private var hasAppliedCodecFallback = false
    private var lastSavedProgress = 0f

    init {
        viewModelScope.launch {
            userPreferences = preferencesDataSource.preferencesFlow.first()
            baseUrl = userPreferences.activeServerUrl ?: ""
            loadEpisodeAndInitPlayer()
        }
    }

    private suspend fun loadEpisodeAndInitPlayer() {
        _playerState.update { it.copy(isBuffering = true, errorMessage = null) }

        // Fetch episode details
        val detailRes = catalogRepository.getShowDetails(episodeId.substringBefore("_s"))
        var ep = detailRes.getOrNull()?.episodes?.firstOrNull { it.id == episodeId }
        val show = detailRes.getOrNull()?.show

        if (ep == null) {
            // Direct query or fallback
            ep = Episode(id = episodeId, title = "Episodio")
        }

        // Determine next episode
        val nextEp = detailRes.getOrNull()?.episodes?.let { allEps ->
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

        setupPlayerInstance(ep, resumeSeconds, preferredAudioIdx, preferredSubIdx)
    }

    private fun setupPlayerInstance(
        episode: Episode,
        resumePositionSeconds: Float,
        audioTrackIndex: Int,
        subtitleTrackIndex: Int,
        forceH264: Boolean = false
    ) {
        exoPlayer?.release()

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
                absolutePositionSeconds = resolved.streamStartOffsetSeconds
            )
        }

        val player = ExoPlayer.Builder(context).build()
        exoPlayer = player

        val mediaItemBuilder = MediaItem.Builder().setUri(resolved.streamUrl)

        // Sideload SSA/ASS subtitle track if selected
        if (subtitleTrackIndex >= 0 && subtitleTrackIndex < episode.subtitleTracks.size) {
            val subTrack = episode.subtitleTracks[subtitleTrackIndex]
            val subUrl = "$baseUrl/api/subtitles/${episode.id}/${subTrack.index}"
            val subConfig = MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(subUrl))
                .setMimeType(MimeTypes.TEXT_SSA)
                .setLanguage(subTrack.language)
                .setSelectionFlags(androidx.media3.common.C.SELECTION_FLAG_DEFAULT)
                .build()
            mediaItemBuilder.setSubtitleConfigurations(listOf(subConfig))
        }

        player.setMediaItem(mediaItemBuilder.build())
        player.prepare()

        if (resolved.requiresInternalSeek) {
            player.seekTo((resolved.targetSeekPositionSeconds * 1000).toLong())
        }

        player.playWhenReady = true

        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                when (playbackState) {
                    Player.STATE_BUFFERING -> {
                        _playerState.update { it.copy(isBuffering = true) }
                    }
                    Player.STATE_READY -> {
                        val duration = if (episode.duration > 0) episode.duration else (player.duration / 1000f).coerceAtLeast(0f)
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
                handlePlaybackError(error, episode)
            }
        })

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

        val msg = when (error.errorCode) {
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ->
                "Error de red al conectar con el servidor multimedia"
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS ->
                "El servidor devolvió un error de streaming (HTTP ${error.message})"
            else -> "Error en la reproducción: ${error.localizedMessage ?: "formato no compatible"}"
        }
        _playerState.update { it.copy(isBuffering = false, errorMessage = msg) }
    }

    private fun startProgressTracker() {
        progressTrackingJob?.cancel()
        progressTrackingJob = viewModelScope.launch {
            while (isActive) {
                val p = exoPlayer ?: break
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

                // Auto skip outro if user enabled
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

    fun play() {
        exoPlayer?.play()
        _playerState.update { it.copy(playWhenReady = true) }
        scheduleControlsAutoHide()
    }

    fun pause() {
        exoPlayer?.pause()
        _playerState.update { it.copy(playWhenReady = false) }
        showControlsPermanently()
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

    fun seekToAbsolute(targetSeconds: Float) {
        val ep = _playerState.value.episode ?: return
        val offset = _playerState.value.streamStartOffsetSeconds
        val isDirect = StreamResolver.canDirectPlay(ep, _playerState.value.selectedAudioTrackIndex)

        if (isDirect) {
            exoPlayer?.seekTo((targetSeconds * 1000).toLong())
        } else {
            // In remux/transcode, if seeking outside buffered window or significant jump, rebuild stream
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
        exoPlayer?.setPlaybackSpeed(speed)
        _playerState.update { it.copy(playbackSpeed = speed) }
    }

    fun toggleFitMode() {
        val next = when (_playerState.value.videoFitMode) {
            VideoFitMode.FIT -> VideoFitMode.ZOOM
            VideoFitMode.ZOOM -> VideoFitMode.STRETCH
            VideoFitMode.STRETCH -> VideoFitMode.FIT
        }
        _playerState.update { it.copy(videoFitMode = next) }
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
        val locked = !_playerState.value.controlsLocked
        _playerState.update {
            it.copy(
                controlsLocked = locked,
                controlsVisible = !locked
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
        // Signal caller via callback or route
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
            if (_playerState.value.isPlaying && !_playerState.value.controlsLocked) {
                _playerState.update { it.copy(controlsVisible = false) }
            }
        }
    }

    private fun showControlsPermanently() {
        autoHideControlsJob?.cancel()
        _playerState.update { it.copy(controlsVisible = true) }
    }

    fun getExoPlayer(): ExoPlayer? = exoPlayer

    override fun onCleared() {
        saveCurrentProgress()
        stopProgressTracker()
        exoPlayer?.release()
        exoPlayer = null
        super.onCleared()
    }
}
