package com.kurastream.app.core.database

import androidx.room.*

@Entity(
    tableName = "server_profiles",
    primaryKeys = ["id"]
)
data class ServerProfileEntity(
    val id: String,
    val displayName: String,
    val baseUrl: String,
    val isHttps: Boolean,
    val lastConnected: Long,
    val isDefault: Boolean = false,
    val version: String? = null
)

@Entity(
    tableName = "cached_shows",
    primaryKeys = ["serverId", "username", "profileId", "id"]
)
data class CachedShowEntity(
    val serverId: String,
    val username: String = "",
    val profileId: String = "",
    val id: String,
    val title: String,
    val synopsis: String,
    val rating: Float,
    val year: Int?,
    val studio: String,
    val posterPath: String,
    val backdropPath: String,
    val mediaType: String,
    val genres: String,
    val ageRating: String,
    val status: String,
    val isRestrictedKids: Boolean = false,
    val lastUpdated: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "cached_episodes",
    primaryKeys = ["serverId", "id"]
)
data class CachedEpisodeEntity(
    val serverId: String,
    val id: String,
    val showId: String,
    val seasonNumber: Int,
    val episodeNumber: Int,
    val title: String,
    val duration: Float,
    val thumbnailPath: String,
    val streamUrl: String,
    val directPlayable: Boolean,
    val container: String
)

@Entity(
    tableName = "cached_history",
    primaryKeys = ["serverId", "username", "profileId", "episodeId"]
)
data class CachedHistoryEntity(
    val serverId: String,
    val username: String,
    val profileId: String,
    val episodeId: String,
    val showId: String,
    val seasonNumber: Int,
    val episodeNumber: Int,
    val progressSeconds: Float,
    val duration: Float,
    val completed: Boolean,
    val updatedAt: String,
    val showTitle: String,
    val thumbnailPath: String,
    val posterPath: String,
    val backdropPath: String
)
