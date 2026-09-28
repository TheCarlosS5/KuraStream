package com.kurastream.app.core.player

import com.kurastream.app.core.model.AudioTrack
import com.kurastream.app.core.model.Chapter
import com.kurastream.app.core.model.Episode
import com.kurastream.app.core.model.Show
import com.kurastream.app.core.model.SubtitleTrack

data class PlayerState(
    val episode: Episode? = null,
    val show: Show? = null,
    val playWhenReady: Boolean = true,
    val isPlaying: Boolean = false,
    val isBuffering: Boolean = false,
    val positionSeconds: Float = 0f,
    val absolutePositionSeconds: Float = 0f,
    val streamStartOffsetSeconds: Float = 0f,
    val durationSeconds: Float = 0f,
    val bufferedPercentage: Int = 0,
    val playbackSpeed: Float = 1.0f,
    val selectedAudioTrackIndex: Int = 0,
    val selectedSubtitleTrackIndex: Int = -1, // -1 means disabled / off
    val availableAudioTracks: List<AudioTrack> = emptyList(),
    val availableSubtitleTracks: List<SubtitleTrack> = emptyList(),
    val chapters: List<Chapter> = emptyList(),
    val nextEpisode: Episode? = null,
    val isPip: Boolean = false,
    val isFullscreen: Boolean = true,
    val controlsVisible: Boolean = true,
    val controlsLocked: Boolean = false,
    val isInIntro: Boolean = false,
    val isInOutro: Boolean = false,
    val nextEpisodeCountdown: Int? = null,
    val errorMessage: String? = null,
    val retryAfterSeconds: Int? = null,
    val isTranscodingBusy: Boolean = false,
    val videoFitMode: VideoFitMode = VideoFitMode.FIT
)

enum class VideoFitMode {
    FIT, ZOOM, STRETCH
}
