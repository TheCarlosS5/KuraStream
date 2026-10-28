package com.kurastream.app.core.repository

import com.kurastream.app.core.network.toUserFacingError
import com.kurastream.app.core.database.CachedHistoryEntity
import com.kurastream.app.core.database.HistoryDao
import com.kurastream.app.core.model.*
import com.kurastream.app.core.network.KuraApiService
import com.kurastream.app.core.network.dto.HistoryItemDto
import com.kurastream.app.core.network.dto.SaveProgressRequestDto
import com.kurastream.app.core.network.dto.UserPreferencesDto
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import retrofit2.HttpException

class HistoryRepository(
    private val apiService: KuraApiService,
    private val historyDao: HistoryDao,
    private val pendingStore: PendingProgressStore = InMemoryPendingProgressStore(),
    /** The identity requests are currently sent as (server + token + profile); null when unknown. */
    private val activeIdentity: suspend () -> ProgressIdentity? = { null }
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
            historyDao.replaceHistory(serverId, username, profileId, entities)
            Result.success(entities.map { it.toModel() })
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
        }
    }

    /** Outlives screens/ViewModels so the last position is still written when the player is closed. */
    internal var detachedScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _progressSaved = MutableSharedFlow<String>(extraBufferCapacity = 8)

    /**
     * Episode ids whose progress just reached the server. "Continuar viendo" refreshes on this
     * instead of a fixed delay: the player's final save used to land after Home had already
     * re-fetched, so the row looked like nothing had been saved.
     */
    val progressSaved: SharedFlow<String> = _progressSaved.asSharedFlow()

    /** Single writer: points reach the server in the order they were recorded (120 -> 150 -> 30 ends at 30). */
    private val sendMutex = Mutex()

    init {
        // Whatever an earlier run could not deliver (hotspot down, app closed) goes out on start.
        detachedScope.launch {
            delay(PENDING_FLUSH_DELAY_MS)
            flushPendingProgress()
        }
    }

    /** Persists a progress point into the offline queue without attempting network delivery. */
    suspend fun recordProgress(
        identity: ProgressIdentity,
        episodeId: String,
        progressSeconds: Float,
        durationSeconds: Float
    ): Long = withContext(Dispatchers.IO) {
        pendingStore.put(identity, episodeId, progressSeconds, durationSeconds)
    }

    /** Fire-and-forget save that survives the caller, retried a few times on network errors. */
    fun saveProgressDetached(
        identity: ProgressIdentity?,
        episodeId: String,
        progressSeconds: Float,
        durationSeconds: Float
    ) {
        detachedScope.launch {
            if (identity != null && identity.isComplete) {
                recordProgress(identity, episodeId, progressSeconds, durationSeconds)
                for (attempt in 0 until SAVE_ATTEMPTS) {
                    if (flushPendingProgress(identity).isSuccess) return@launch
                    delay(SAVE_RETRY_BASE_MS * (attempt + 1))
                }
            } else {
                for (attempt in 0 until SAVE_ATTEMPTS) {
                    if (postProgress(episodeId, progressSeconds, durationSeconds).isSuccess) return@launch
                    delay(SAVE_RETRY_BASE_MS * (attempt + 1))
                }
            }
        }
    }

    /**
     * Records the point for [identity] first (it survives process death), then delivers everything
     * pending for that identity. Points of another profile/server stay stored until that one is active
     * again: requests always go out with the active session, so sending them now would file A's progress
     * under B.
     */
    suspend fun saveProgress(
        identity: ProgressIdentity?,
        episodeId: String,
        progressSeconds: Float,
        durationSeconds: Float
    ): Result<Unit> {
        if (identity == null || !identity.isComplete) {
            return postProgress(episodeId, progressSeconds, durationSeconds)
        }
        recordProgress(identity, episodeId, progressSeconds, durationSeconds)
        return flushPendingProgress(identity)
    }

    /** Sends the stored points of [identity] (default: the active one) in order; stops at the first failure. */
    suspend fun flushPendingProgress(identity: ProgressIdentity? = null): Result<Unit> = sendMutex.withLock {
        val active = activeIdentity()
        val target = identity ?: active ?: return@withLock Result.success(Unit)
        if (active != null && active != target) {
            return@withLock Result.failure(IllegalStateException("El progreso pertenece a otro perfil; se enviará al volver a él"))
        }
        val pending = withContext(Dispatchers.IO) { pendingStore.pendingFor(target) }
        for (item in pending) {
            val currentActive = activeIdentity()
            if (currentActive != target) {
                return@withLock Result.failure(IllegalStateException("El perfil activo cambió durante el vaciado"))
            }
            val sent = postProgress(item.episodeId, item.positionSeconds, item.durationSeconds)
            if (sent.isFailure) {
                val error = sent.exceptionOrNull()
                val http = (error as? HttpException) ?: (error?.cause as? HttpException)
                if (http != null && http.code() in PERMANENT_EPISODE_ERROR_CODES) {
                    withContext(Dispatchers.IO) { pendingStore.removeIfSeq(target, item.episodeId, item.seq) }
                    continue
                }
                return@withLock sent
            }
            withContext(Dispatchers.IO) { pendingStore.removeIfSeq(target, item.episodeId, item.seq) }
        }
        Result.success(Unit)
    }

    /** One entry per show, computed by the server (in progress, or the next episode). */
    suspend fun getContinueWatching(): Result<List<WatchHistoryItem>> {
        return try {
            Result.success(apiService.getContinueWatching().map { dto ->
                WatchHistoryItem(
                    episodeId = dto.episodeId,
                    showId = dto.showId ?: "",
                    seasonNumber = dto.seasonNumber ?: 1,
                    episodeNumber = dto.episodeNumber ?: 1,
                    progressSeconds = dto.progressSeconds ?: 0f,
                    duration = dto.duration ?: 0f,
                    completed = false,
                    updatedAt = dto.updatedAt ?: "",
                    showTitle = dto.showTitle ?: "",
                    thumbnailPath = dto.thumbnailPath ?: "",
                    posterPath = dto.posterPath ?: "",
                    backdropPath = dto.backdropPath ?: "",
                    upNext = dto.upNext ?: false,
                    episodeTitle = dto.episodeTitle ?: ""
                )
            })
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
        }
    }

    /** Server-side resume point for the active profile; null when it can't be fetched. */
    suspend fun getProgress(episodeId: String): ProgressInfo? {
        return try {
            val res = apiService.getProgress(episodeId)
            ProgressInfo(res.progress, res.completed, res.duration)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
    }

    /** Local pending progress position for the given identity and episode; null when none is pending. */
    suspend fun pendingPosition(identity: ProgressIdentity?, episodeId: String): Float? {
        if (identity == null || !identity.isComplete) return null
        return withContext(Dispatchers.IO) {
            pendingStore.pendingFor(identity)
                .find { it.episodeId == episodeId }
                ?.positionSeconds
        }
    }

    private suspend fun postProgress(episodeId: String, progressSeconds: Float, durationSeconds: Float): Result<Unit> {
        return try {
            val body = SaveProgressRequestDto(
                episodeId = episodeId,
                progress = progressSeconds,
                duration = durationSeconds
            )
            apiService.saveProgress(episodeId, body)
            _progressSaved.tryEmit(episodeId)
            Result.success(Unit)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
        }
    }

    suspend fun deleteHistoryItem(
        serverId: String,
        username: String,
        profileId: String,
        episodeId: String
    ): Result<Unit> = sendMutex.withLock {
        val identity = ProgressIdentity(serverId, username, profileId)
        withContext(Dispatchers.IO) { pendingStore.remove(identity, episodeId) }
        return@withLock try {
            apiService.deleteHistoryItem(episodeId)
            historyDao.deleteHistoryItem(serverId, username, profileId, episodeId)
            Result.success(Unit)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
        }
    }

    suspend fun clearAllHistory(
        serverId: String,
        username: String,
        profileId: String
    ): Result<Unit> = sendMutex.withLock {
        val identity = ProgressIdentity(serverId, username, profileId)
        withContext(Dispatchers.IO) { pendingStore.clear(identity) }
        return@withLock try {
            apiService.clearAllHistory(clear = "all")
            historyDao.clearHistory(serverId, username, profileId)
            Result.success(Unit)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
        }
    }

    suspend fun clearHistory(
        serverId: String,
        username: String,
        profileId: String
    ): Result<Unit> = clearAllHistory(serverId, username, profileId)

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
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
        }
    }

    suspend fun markNotificationsSeen(): Result<Unit> {
        return try {
            apiService.markNotificationsSeen()
            Result.success(Unit)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
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
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
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
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
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
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
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

private const val SAVE_ATTEMPTS = 3
internal const val SAVE_RETRY_BASE_MS = 1_500L
private const val PENDING_FLUSH_DELAY_MS = 3_000L
private val PERMANENT_EPISODE_ERROR_CODES = setOf(400, 404, 410, 422)

data class ProgressInfo(
    val progressSeconds: Float,
    val completed: Boolean,
    val durationSeconds: Float
)
