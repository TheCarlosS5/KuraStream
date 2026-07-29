package com.kurastream.app.data

import com.google.gson.annotations.SerializedName

data class Show(
    @SerializedName("id") val id: String,
    @SerializedName("title") val title: String,
    @SerializedName("synopsis") val synopsis: String?,
    @SerializedName("rating") val rating: Double?,
    @SerializedName("year") val year: Int?,
    @SerializedName("studio") val studio: String?,
    @SerializedName("director") val director: String?,
    @SerializedName("writer") val writer: String?,
    @SerializedName("cast_members") val castMembers: String?,
    @SerializedName("poster_path") val posterPath: String?,
    @SerializedName("backdrop_path") val backdropPath: String?,
    @SerializedName("media_type") val mediaType: String,
    @SerializedName("backdrop_loops") val backdropLoops: String?,
    @SerializedName("genres") val genres: String?,
    @SerializedName("trailer_key") val trailerKey: String?,
    @SerializedName("created_at") val createdAt: String?
)

data class Episode(
    @SerializedName("id") val id: String,
    @SerializedName("show_id") val showId: String,
    @SerializedName("season_number") val seasonNumber: Int,
    @SerializedName("episode_number") val episodeNumber: Int,
    @SerializedName("title") val title: String?,
    @SerializedName("synopsis") val synopsis: String?,
    @SerializedName("filepath") val filepath: String,
    @SerializedName("duration") val duration: Double?,
    @SerializedName("size") val size: Long?,
    @SerializedName("video_codec") val videoCodec: String?,
    @SerializedName("resolution") val resolution: String?,
    @SerializedName("fps") val fps: Double?,
    @SerializedName("audio_tracks") val audioTracks: String?,
    @SerializedName("subtitle_tracks") val subtitleTracks: String?,
    @SerializedName("thumbnail_path") val thumbnailPath: String?,
    @SerializedName("intro_start") val introStart: Int?,
    @SerializedName("intro_end") val introEnd: Int?,
    @SerializedName("outro_start") val outroStart: Int?
)

data class ShowDetailResponse(
    @SerializedName("show") val show: Show,
    @SerializedName("episodes") val episodes: List<Episode>
)

data class LoginRequest(
    @SerializedName("username") val username: String,
    @SerializedName("password") val password: String
)

data class LoginResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("message") val message: String?,
    @SerializedName("username") val username: String?,
    @SerializedName("role") val role: String?,
    @SerializedName("token") val token: String?
)

data class ProgressResponse(
    @SerializedName("progress") val progress: Double
)

data class ProgressRequest(
    @SerializedName("progress") val progress: Double,
    @SerializedName("username") val username: String
)
