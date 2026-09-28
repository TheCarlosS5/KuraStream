package com.kurastream.app.core.repository

import com.kurastream.app.core.database.CachedHistoryEntity
import com.kurastream.app.core.database.HistoryDao
import com.kurastream.app.core.model.*
import com.kurastream.app.core.network.KuraApiService
import com.kurastream.app.core.network.dto.HistoryItemDto
import com.kurastream.app.core.network.dto.SaveProgressRequestDto
import com.kurastream.app.core.network.dto.UserPreferencesDto
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class HistoryRepository(
    private val apiService: KuraApiService,
    private val historyDao: HistoryDao
) {
    fun getCachedHistory(serverId: String, username: String, profileId: String): Flow<List<WatchHistoryItem>> {
        return historyDao.getHistory(serverId, username, profileId).map { entities ->
            entities.map { it.toModel() }
        }
    }

    suspend fun refreshHistory(serverId: String, username: String, profileId: String): Result<List<WatchHistoryItem>> {
        return try {
            val dtoList = apiService.getHistory()
            val entities = dtoList.map { it.toEntity(serverId, username, profileId) }
            historyDao.insertHistory(entities)
            Result.success(entities.map { it.toModel() })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun saveProgress(episodeId: String, progressSeconds: Float, durationSeconds: Float): Result<Unit> {
        return try {
            val body = SaveProgressRequestDto(
                episodeId = episodeId,
                progress = progressSeconds,
                duration = durationSeconds
            )
            apiService.saveProgress(episodeId, body)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteHistoryItem(serverId: String, username: String, profileId: String, episodeId: String): Result<Unit> {
        return try {
            apiService.deleteHistoryItem(episodeId)
            historyDao.deleteHistoryItem(serverId, username, profileId, episodeId)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun clearAllHistory(serverId: String, username: String, profileId: String): Result<Unit> {
        return try {
            apiService.clearAllHistory(clear = "all")
            historyDao.clearHistory(serverId, username, profileId)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getNotifications(): Result<Pair<List<NotificationItem>, Int>> {
        return try {
            val res = apiService.getNotifications()
            val items = res.notifications.map {
                NotificationItem(
                    id = it.id,
                    title = it.title,
                    message = it.message,
                    showId = it.showId,
                    episodeId = it.episodeId,
                    createdAt = it.createdAt,
                    isRead = it.isRead
                )
            }
            Result.success(Pair(items, res.unreadCount))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun markNotificationsSeen(): Result<Unit> {
        return try {
            apiService.markNotificationsSeen()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getUserStats(): Result<UserStats> {
        return try {
            val res = apiService.getUserStats()
            val stats = res.stats?.let {
                UserStats(
                    totalTimeSeconds = it.totalTimeSeconds,
                    watchedEpisodes = it.watchedEpisodes,
                    completedShows = it.completedShows,
                    topGenre = it.topGenre,
                    genresBreakdown = it.genresBreakdown
                )
            } ?: UserStats()
            Result.success(stats)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getUserPreferences(): Result<UserPreferences> {
        return try {
            val res = apiService.getUserPreferences()
            val prefs = res.preferences?.let {
                UserPreferences(
                    autoSkipIntro = it.autoSkipIntro,
                    autoPlayNext = it.autoPlayNext,
                    preferredAudioLanguage = it.preferredAudioLanguage,
                    preferredSubtitleLanguage = it.preferredSubtitleLanguage,
                    audioBoost = it.audioBoost,
                    audioPreset = it.audioPreset
                )
            } ?: UserPreferences()
            Result.success(prefs)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun saveUserPreferences(prefs: UserPreferences): Result<Unit> {
        return try {
            val dto = UserPreferencesDto(
                autoSkipIntro = prefs.autoSkipIntro,
                autoPlayNext = prefs.autoPlayNext,
                preferredAudioLanguage = prefs.preferredAudioLanguage,
                preferredSubtitleLanguage = prefs.preferredSubtitleLanguage,
                audioBoost = prefs.audioBoost,
                audioPreset = prefs.audioPreset
            )
            apiService.saveUserPreferences(dto)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private fun HistoryItemDto.toEntity(serverId: String, username: String, profileId: String): CachedHistoryEntity {
        return CachedHistoryEntity(
            serverId = serverId,
            username = username,
            profileId = profileId,
            episodeId = episodeId,
            showId = showId ?: "",
            seasonNumber = seasonNumber ?: 1,
            episodeNumber = episodeNumber ?: 1,
            progressSeconds = progressSeconds ?: 0f,
            duration = duration ?: 0f,
            completed = completed ?: false,
            updatedAt = updatedAt ?: "",
            showTitle = showTitle ?: "",
            thumbnailPath = thumbnailPath ?: "",
            posterPath = posterPath ?: "",
            backdropPath = backdropPath ?: ""
        )
    }

    private fun CachedHistoryEntity.toModel(): WatchHistoryItem = WatchHistoryItem(
        episodeId = episodeId,
        showId = showId,
        seasonNumber = seasonNumber,
        episodeNumber = episodeNumber,
        progressSeconds = progressSeconds,
        duration = duration,
        completed = completed,
        updatedAt = updatedAt,
        showTitle = showTitle,
        thumbnailPath = thumbnailPath,
        posterPath = posterPath,
        backdropPath = backdropPath
    )
}
