package com.kurastream.app.core.player

import com.kurastream.app.core.model.AudioTrack
import com.kurastream.app.core.model.Chapter
import com.kurastream.app.core.model.Episode
import com.kurastream.app.core.model.PartyMessage
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
    /** Every episode of the show in (season, episode) order, for the in-player episode panel. */
    val showEpisodes: List<Episode> = emptyList(),
    /** episode_id -> saved progress / completed flag for this show (filled when the panel opens). */
    val episodeProgress: Map<String, Float> = emptyMap(),
    val episodeCompleted: Map<String, Boolean> = emptyMap(),
    val mediaBaseUrl: String = "",
    /** Position playback resumed from, while the "Reanudado en…" notice is showing. */
    val resumedFromSeconds: Float? = null,
    val isPip: Boolean = false,
    val isFullscreen: Boolean = true,
    val controlsVisible: Boolean = true,
    val controlsLocked: Boolean = false,
    val isInIntro: Boolean = false,
    val isInOutro: Boolean = false,
    /** In ending credits that a scene follows: "Saltar créditos" instead of "Siguiente episodio". */
    val isInCredits: Boolean = false,
    val nextEpisodeCountdown: Int? = null,
    /** "Up next" card on screen (credits / last seconds, or the end without autoplay). */
    val upNextVisible: Boolean = false,
    val errorMessage: String? = null,
    val retryAfterSeconds: Int? = null,
    val isTranscodingBusy: Boolean = false,
    val isWatchPartyActive: Boolean = false,
    val watchPartyRoomId: String? = null,
    val isPartyHost: Boolean = false,
    /** False for a guest in a room where only the host drives playback. */
    val canControlPlayback: Boolean = true,
    /** Chat and reactions received since the player opened (newest last). */
    val partyMessages: List<PartyMessage> = emptyList(),
    val partyUnreadCount: Int = 0,
    /** End of the episode with nothing auto-advancing: replay / next / back, like the web. */
    val endScreenVisible: Boolean = false,
    val doubleTapSeekSeconds: Int = 10,
    val subtitleScale: Float = 0f,
    val videoFitMode: VideoFitMode = VideoFitMode.FIT
)

enum class VideoFitMode {
    FIT, ZOOM, STRETCH
}
