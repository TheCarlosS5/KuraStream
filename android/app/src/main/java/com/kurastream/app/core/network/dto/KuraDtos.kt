package com.kurastream.app.core.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class BaseResponseDto(
    val success: Boolean = true,
    val message: String? = null,
    val error: String? = null
)

@Serializable
data class ServerHealthDto(
    val success: Boolean = true,
    val status: String = "unknown",
    val database: String = "unknown",
    val storage: String = "unknown",
    @SerialName("php_version") val phpVersion: String = "",
    val timestamp: String = ""
)

@Serializable
data class AuthResponseDto(
    val success: Boolean = true,
    val token: String? = null,
    val role: String = "user",
    val username: String = "",
    val user: UserDto? = null,
    val error: String? = null
)

@Serializable
data class UserDto(
    val username: String,
    val role: String = "user"
)

@Serializable
data class LoginRequestDto(
    val username: String,
    val password: String
)

@Serializable
data class RegisterRequestDto(
    val username: String,
    val password: String
)

@Serializable
data class ProfileDto(
    val id: String = "",
    val username: String = "",
    val name: String = "",
    @SerialName("profile_name") val profileName: String? = null,
    val color: String? = null,
    @SerialName("avatar_color") val avatarColor: String? = null,
    @SerialName("is_kids") val isKids: Boolean = false,
    @SerialName("has_pin") val hasPin: Boolean = false
)

@Serializable
data class ProfilesResponseDto(
    val success: Boolean = true,
    val profiles: List<ProfileDto> = emptyList(),
    val error: String? = null
)

@Serializable
data class SelectProfileRequestDto(
    @SerialName("profile_id") val profileId: String,
    val pin: String? = null
)

@Serializable
data class SelectProfileResponseDto(
    val success: Boolean = true,
    val token: String? = null,
    val profile: ProfileDto? = null,
    val error: String? = null
)

@Serializable
data class SaveProfileRequestDto(
    val id: String? = null,
    val name: String,
    val color: String = "#818CF8",
    @SerialName("is_kids") val isKids: Boolean = false,
    val pin: String? = null
)

@Serializable
data class ShowDto(
    val id: String,
    val title: String,
    val synopsis: String? = "",
    val rating: Float? = 0f,
    val year: Int? = null,
    val studio: String? = "",
    val director: String? = "",
    val writer: String? = "",
    @SerialName("poster_path") val posterPath: String? = "",
    @SerialName("backdrop_path") val backdropPath: String? = "",
    @SerialName("media_type") val mediaType: String? = "anime",
    val genres: String? = "",
    @SerialName("trailer_key") val trailerKey: String? = null,
    @SerialName("age_rating") val ageRating: String? = "TV-14",
    val status: String? = "finished",
    @SerialName("tmdb_id") val tmdbId: Int? = null
)

@Serializable
data class ShowDetailResponseDto(
    val id: String,
    val title: String,
    val synopsis: String? = "",
    val rating: Float? = 0f,
    val year: Int? = null,
    val studio: String? = "",
    val director: String? = "",
    val writer: String? = "",
    @SerialName("poster_path") val posterPath: String? = "",
    @SerialName("backdrop_path") val backdropPath: String? = "",
    @SerialName("media_type") val mediaType: String? = "anime",
    val genres: String? = "",
    @SerialName("trailer_key") val trailerKey: String? = null,
    @SerialName("age_rating") val ageRating: String? = "TV-14",
    val status: String? = "finished",
    @SerialName("tmdb_id") val tmdbId: Int? = null,
    val episodes: List<EpisodeDto> = emptyList(),
    val seasons: Map<String, List<EpisodeDto>> = emptyMap()
)

@Serializable
data class EpisodeDto(
    val id: String,
    @SerialName("show_id") val showId: String? = "",
    @SerialName("season_number") val seasonNumber: Int? = 1,
    @SerialName("episode_number") val episodeNumber: Int? = 1,
    val title: String? = "",
    val synopsis: String? = "",
    val duration: Float? = 0f,
    val size: Long? = 0L,
    @SerialName("video_codec") val videoCodec: String? = "",
    @SerialName("audio_codec") val audioCodec: String? = "",
    val resolution: String? = "",
    val fps: Float? = 0f,
    @SerialName("audio_tracks") val audioTracks: List<AudioTrackDto>? = emptyList(),
    @SerialName("subtitle_tracks") val subtitleTracks: List<SubtitleTrackDto>? = emptyList(),
    @SerialName("thumbnail_path") val thumbnailPath: String? = "",
    @SerialName("intro_start") val introStart: Float? = null,
    @SerialName("intro_end") val introEnd: Float? = null,
    @SerialName("outro_start") val outroStart: Float? = null,
    val chapters: List<ChapterDto>? = emptyList(),
    @SerialName("stream_url") val streamUrl: String? = "",
    @SerialName("direct_playable") val directPlayable: Boolean? = false,
    val container: String? = "mp4"
)

@Serializable
data class AudioTrackDto(
    val index: Int? = 0,
    @SerialName("track_number") val trackNumber: Int? = 0,
    val title: String? = "",
    val language: String? = "jpn",
    val codec: String? = "aac",
    val channels: Int? = 2
)

@Serializable
data class SubtitleTrackDto(
    val index: Int? = 0,
    @SerialName("track_number") val trackNumber: Int? = 0,
    val title: String? = "",
    val language: String? = "spa",
    val format: String? = "ass",
    @SerialName("is_default") val isDefault: Boolean? = false,
    @SerialName("is_forced") val isForced: Boolean? = false,
    @SerialName("is_bitmap") val isBitmap: Boolean? = false
)

@Serializable
data class ChapterDto(
    val title: String = "",
    val start: Float = 0f,
    val end: Float = 0f
)

@Serializable
data class HistoryItemDto(
    val username: String? = "",
    @SerialName("profile_name") val profileName: String? = "",
    @SerialName("episode_id") val episodeId: String,
    @SerialName("progress_seconds") val progressSeconds: Float? = 0f,
    val duration: Float? = 0f,
    val completed: Boolean? = false,
    @SerialName("updated_at") val updatedAt: String? = "",
    @SerialName("show_id") val showId: String? = "",
    @SerialName("season_number") val seasonNumber: Int? = 1,
    @SerialName("episode_number") val episodeNumber: Int? = 1,
    @SerialName("thumbnail_path") val thumbnailPath: String? = "",
    @SerialName("show_title") val showTitle: String? = "",
    @SerialName("poster_path") val posterPath: String? = "",
    @SerialName("backdrop_path") val backdropPath: String? = ""
)

@Serializable
data class ProgressResponseDto(
    val progress: Float = 0f,
    val completed: Boolean = false,
    val duration: Float = 0f
)

@Serializable
data class SaveProgressRequestDto(
    @SerialName("episode_id") val episodeId: String,
    val progress: Float,
    val duration: Float
)

@Serializable
data class FavoriteCheckResponseDto(
    val favorited: Boolean = false
)

@Serializable
data class ToggleFavoriteRequestDto(
    @SerialName("show_id") val showId: String
)

@Serializable
data class ToggleFavoriteResponseDto(
    val favorited: Boolean = false
)

@Serializable
data class UserPreferencesResponseDto(
    val success: Boolean = true,
    val preferences: UserPreferencesDto? = null
)

@Serializable
data class UserPreferencesDto(
    @SerialName("auto_skip_intro") val autoSkipIntro: Boolean = false,
    @SerialName("auto_play_next") val autoPlayNext: Boolean = true,
    @SerialName("preferred_audio_language") val preferredAudioLanguage: String = "jpn",
    @SerialName("preferred_subtitle_language") val preferredSubtitleLanguage: String = "spa",
    @SerialName("audio_boost") val audioBoost: Int = 100,
    @SerialName("audio_preset") val audioPreset: String = "flat"
)

@Serializable
data class UserStatsResponseDto(
    val success: Boolean = true,
    val stats: UserStatsDto? = null
)

@Serializable
data class UserStatsDto(
    @SerialName("total_time_seconds") val totalTimeSeconds: Long = 0L,
    @SerialName("watched_episodes") val watchedEpisodes: Int = 0,
    @SerialName("completed_shows") val completedShows: Int = 0,
    @SerialName("top_genre") val topGenre: String = "Ninguno",
    @SerialName("genres_breakdown") val genresBreakdown: Map<String, Int> = emptyMap()
)

@Serializable
data class NotificationsResponseDto(
    val success: Boolean = true,
    val notifications: List<NotificationItemDto> = emptyList(),
    @SerialName("unread_count") val unreadCount: Int = 0,
    @SerialName("last_seen_at") val lastSeenAt: String? = null
)

@Serializable
data class NotificationItemDto(
    val id: Int,
    val title: String,
    val message: String,
    @SerialName("show_id") val showId: String? = null,
    @SerialName("episode_id") val episodeId: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("is_read") val isRead: Boolean = false
)

@Serializable
data class CalendarScheduleItemDto(
    @SerialName("schedule_id") val scheduleId: kotlinx.serialization.json.JsonElement? = null,
    @SerialName("airing_at") val airingAt: Long? = 0L,
    @SerialName("time_until") val timeUntil: Long? = 0L,
    val episode: Int? = 1,
    val title: String = "",
    @SerialName("romaji_title") val romajiTitle: String? = "",
    @SerialName("english_title") val englishTitle: String? = "",
    @SerialName("cover_image") val coverImage: String? = "",
    val genres: String? = "",
    val studio: String? = "",
    @SerialName("in_library") val inLibrary: Boolean? = false,
    @SerialName("library_show_id") val libraryShowId: String? = null
)

@Serializable
data class PartyCreateRequestDto(
    @SerialName("episode_id") val episodeId: String,
    @SerialName("name") val name: String,
    @SerialName("is_public") val isPublic: Boolean = true,
    @SerialName("allow_guest_controls") val allowGuestControls: Boolean = true
)

@Serializable
data class PartyCreateResponseDto(
    val success: Boolean = true,
    @SerialName("room_id") val roomId: String = "",
    val room: PartyRoomDto? = null,
    @SerialName("member_id") val memberId: String = "",
    @SerialName("member_token") val memberToken: String = "",
    @SerialName("stream_capability_token") val streamCapabilityToken: String? = null,
    @SerialName("stream_ticket") val streamTicket: String? = null,
    @SerialName("sse_ticket") val sseTicket: String? = null,
    @SerialName("is_host") val isHost: Boolean = true
) {
    val effectiveStreamToken: String? get() = streamCapabilityToken ?: streamTicket
}

@Serializable
data class PartyJoinRequestDto(
    @SerialName("room_id") val roomId: String,
    val username: String? = null
)

@Serializable
data class PartyJoinResponseDto(
    val success: Boolean = true,
    val room: PartyRoomDto? = null,
    val user: String? = null,
    val messages: List<PartyMessageDto> = emptyList(),
    val members: List<PartyMemberDto> = emptyList(),
    @SerialName("member_id") val memberId: String = "",
    @SerialName("member_token") val memberToken: String = "",
    @SerialName("stream_capability_token") val streamCapabilityToken: String? = null,
    @SerialName("stream_ticket") val streamTicket: String? = null,
    @SerialName("sse_ticket") val sseTicket: String? = null,
    @SerialName("is_host") val isHost: Boolean = false
) {
    val effectiveStreamToken: String? get() = streamCapabilityToken ?: streamTicket
}

@Serializable
data class PartyRoomDto(
    val id: String,
    val name: String,
    @SerialName("episode_id") val episodeId: String,
    @SerialName("host_user") val hostUser: String = "",
    @SerialName("current_time") val currentTime: Float = 0f,
    @SerialName("is_playing") val isPlaying: Boolean = false,
    @SerialName("is_public") val isPublic: Boolean = false,
    @SerialName("allow_guest_controls") val allowGuestControls: Boolean = false,
    @SerialName("member_count") val memberCount: Int = 1,
    @SerialName("last_sync_timestamp") val lastSyncTimestamp: Long? = 0L
)

@Serializable
data class PartyMessageDto(
    val id: Int = 0,
    @SerialName("room_id") val roomId: String = "",
    val username: String = "",
    val message: String = "",
    val type: String = "chat",
    @SerialName("created_at") val createdAt: String = "",
    val role: String? = "guest",
    @SerialName("member_id") val memberId: String? = null
)

@Serializable
data class PartyMemberDto(
    @SerialName("member_id") val memberId: String = "",
    val username: String = "",
    val role: String = "guest",
    @SerialName("is_kids") val isKids: Boolean = false,
    @SerialName("joined_at") val joinedAt: String = ""
)

@Serializable
data class PartyPollResponseDto(
    val success: Boolean = true,
    val room: PartyRoomDto? = null,
    val messages: List<PartyMessageDto> = emptyList()
)

@Serializable
data class PartySyncRequestDto(
    @SerialName("room_id") val roomId: String,
    @SerialName("current_time") val currentTime: Float,
    @SerialName("is_playing") val isPlaying: Boolean,
    @SerialName("playback_rate") val playbackRate: Float = 1.0f,
    val action: String? = null,
    @SerialName("episode_id") val episodeId: String? = null
)

@Serializable
data class PartyMessageRequestDto(
    @SerialName("room_id") val roomId: String,
    val message: String,
    val type: String = "chat"
)

@Serializable
data class CommentsResponseDto(
    val success: Boolean = true,
    val comments: List<CommentDto> = emptyList()
)

@Serializable
data class CommentDto(
    val id: Int,
    val username: String = "",
    @SerialName("profile_name") val profileName: String = "",
    val content: String = "",
    @SerialName("created_at") val createdAt: String = ""
)
