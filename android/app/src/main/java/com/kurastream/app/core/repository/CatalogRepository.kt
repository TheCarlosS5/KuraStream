package com.kurastream.app.core.repository

import com.kurastream.app.core.network.toUserFacingError
import com.kurastream.app.core.database.CachedShowEntity
import com.kurastream.app.core.database.ShowDao
import com.kurastream.app.core.model.*
import com.kurastream.app.core.network.KuraApiService
import com.kurastream.app.core.network.dto.CommentDto
import com.kurastream.app.core.network.dto.AddCommentRequestDto
import com.kurastream.app.core.network.dto.EpisodeDto
import com.kurastream.app.core.network.dto.ShowDto
import com.kurastream.app.core.network.dto.ToggleFavoriteRequestDto
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.contentOrNull

class CatalogRepository(
    private val apiService: KuraApiService,
    private val showDao: ShowDao
) {
    fun getCachedShows(serverId: String, username: String = "", profileId: String = "", isKidsMode: Boolean): Flow<List<Show>> {
        return showDao.getCachedShows(serverId, username, profileId, isKidsMode).map { entities ->
            entities.map { it.toModel() }
        }
    }

    suspend fun refreshCatalog(serverId: String, username: String = "", profileId: String = "", isKidsMode: Boolean): Result<List<Show>> {
        return try {
            val dtoList = apiService.getShows(type = "all")
            val entities = dtoList.map { it.toEntity(serverId, username, profileId) }
            showDao.replaceShowsForProfile(serverId, username, profileId, entities)
            val filtered = if (isKidsMode) entities.filter { !it.isRestrictedKids } else entities
            Result.success(filtered.map { it.toModel() })
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
        }
    }

    suspend fun searchShowsLocally(serverId: String, username: String = "", profileId: String = "", isKidsMode: Boolean, query: String): List<Show> {
        val matches = showDao.searchCachedShows(serverId, username, profileId, isKidsMode, query)
        return matches.map { it.toModel() }
    }

    suspend fun getShowDetails(showId: String): Result<ShowDetail> {
        return try {
            val response = apiService.getShowDetails(showId)
            val show = Show(
                id = response.id,
                title = response.title,
                synopsis = response.synopsis ?: "",
                rating = response.rating ?: 0f,
                year = response.year,
                studio = response.studio ?: "",
                director = response.director ?: "",
                writer = response.writer ?: "",
                posterPath = response.posterPath ?: "",
                backdropPath = response.backdropPath ?: "",
                mediaType = response.mediaType ?: "anime",
                genres = response.genres ?: "",
                trailerKey = response.trailerKey,
                ageRating = response.ageRating ?: "TV-14",
                status = response.status ?: "finished",
                tmdbId = response.tmdbId
            )
            val episodes = response.episodes.map { it.toModel() }
            val seasonsMap = response.seasons.mapKeys { it.key.toIntOrNull() ?: 1 }
                .mapValues { entry -> entry.value.map { it.toModel() } }

            val seasonInfo = response.seasonInfo.associate { dto ->
                dto.seasonNumber to SeasonInfo(
                    seasonNumber = dto.seasonNumber,
                    name = dto.name.orEmpty(),
                    title = dto.title.orEmpty(),
                    synopsis = dto.synopsis.orEmpty(),
                    year = dto.year,
                    status = dto.status,
                    posterPath = dto.posterPath.orEmpty(),
                    backdropPath = dto.backdropPath.orEmpty()
                )
            }

            Result.success(
                ShowDetail(
                    show = show,
                    episodes = episodes,
                    seasons = seasonsMap,
                    seasonInfo = seasonInfo
                )
            )
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
        }
    }

    suspend fun getRandomShow(): Result<Show> {
        return try {
            val dto = apiService.getRandomShow().show
                ?: return Result.failure(IllegalStateException("El catálogo está vacío"))
            Result.success(dto.toModel())
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
        }
    }

    suspend fun getFavorites(): Result<List<Show>> {
        return try {
            val list = apiService.getFavorites().map { it.toModel() }
            Result.success(list)
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
        }
    }

    suspend fun toggleFavorite(showId: String): Result<Boolean> {
        return try {
            val res = apiService.toggleFavorite(ToggleFavoriteRequestDto(showId))
            Result.success(res.favorited)
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
        }
    }

    suspend fun getComments(showId: String): Result<List<CommentDto>> = try {
        Result.success(apiService.getComments(showId).comments)
    } catch (e: Exception) {
        Result.failure(e.toUserFacingError())
    }

    suspend fun addComment(showId: String, content: String): Result<Unit> = try {
        val res = apiService.addComment(AddCommentRequestDto(showId, content))
        if (res.success) Result.success(Unit) else Result.failure(Exception(res.error ?: "No se pudo publicar el comentario"))
    } catch (e: Exception) {
        Result.failure(e.toUserFacingError())
    }

    suspend fun deleteComment(id: String): Result<Unit> = try {
        val res = apiService.deleteComment(id)
        if (res.success) Result.success(Unit) else Result.failure(Exception(res.error ?: "No se pudo eliminar el comentario"))
    } catch (e: Exception) {
        Result.failure(e.toUserFacingError())
    }

    suspend fun getEpisodeDetails(episodeId: String): Result<Episode> {
        return try {
            val dto = apiService.getEpisodeDetails(episodeId)
            Result.success(dto.toModel())
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
        }
    }

    suspend fun checkFavorite(showId: String): Result<Boolean> {
        return try {
            val res = apiService.checkFavorite(showId)
            Result.success(res.favorited)
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
        }
    }

    suspend fun getCalendarSchedule(): Result<Map<String, List<CalendarItem>>> {
        return try {
            val res = apiService.getCalendarSchedule()
            val mapped = res.mapValues { entry ->
                entry.value.map { item ->
                    CalendarItem(
                        scheduleId = (item.scheduleId as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull ?: "",
                        airingAt = item.airingAt ?: 0L,
                        timeUntil = item.timeUntil ?: 0L,
                        // 0 = unknown (offline schedule): the UI hides it instead of inventing one.
                        episode = item.episode ?: 0,
                        title = item.title,
                        romajiTitle = item.romajiTitle ?: "",
                        englishTitle = item.englishTitle ?: "",
                        coverImage = item.coverImage ?: "",
                        genres = item.genres ?: "",
                        studio = item.studio ?: "",
                        inLibrary = item.inLibrary ?: false,
                        libraryShowId = item.libraryShowId
                    )
                }
            }
            Result.success(mapped)
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
        }
    }

    suspend fun getNotifications(): Result<com.kurastream.app.core.network.dto.NotificationsResponseDto> {
        return try {
            val res = apiService.getNotifications()
            Result.success(res)
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
        }
    }

    suspend fun markNotificationsSeen(): Result<Unit> {
        return try {
            apiService.markNotificationsSeen()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e.toUserFacingError())
        }
    }

    private fun ShowDto.toEntity(serverId: String, username: String = "", profileId: String = ""): CachedShowEntity {
        val age = (ageRating ?: "TV-14").uppercase()
        val g = (genres ?: "").lowercase()
        val isRestricted = age in listOf("R", "TV-MA", "18+", "NC-17", "RX", "R18") ||
                g.contains("ecchi") || g.contains("hentai") || g.contains("erotica")

        return CachedShowEntity(
            serverId = serverId,
            username = username,
            profileId = profileId,
            id = id,
            title = title,
            synopsis = synopsis ?: "",
            rating = rating ?: 0f,
            year = year,
            studio = studio ?: "",
            posterPath = posterPath ?: "",
            backdropPath = backdropPath ?: "",
            mediaType = mediaType ?: "anime",
            genres = genres ?: "",
            ageRating = ageRating ?: "TV-14",
            status = status ?: "finished",
            isRestrictedKids = isRestricted
        )
    }

    private fun CachedShowEntity.toModel(): Show = Show(
        id = id,
        title = title,
        synopsis = synopsis,
        rating = rating,
        year = year,
        studio = studio,
        posterPath = posterPath,
        backdropPath = backdropPath,
        mediaType = mediaType,
        genres = genres,
        ageRating = ageRating,
        status = status
    )

    private fun ShowDto.toModel(): Show = Show(
        id = id,
        title = title,
        synopsis = synopsis ?: "",
        rating = rating ?: 0f,
        year = year,
        studio = studio ?: "",
        director = director ?: "",
        writer = writer ?: "",
        posterPath = posterPath ?: "",
        backdropPath = backdropPath ?: "",
        mediaType = mediaType ?: "anime",
        genres = genres ?: "",
        trailerKey = trailerKey,
        ageRating = ageRating ?: "TV-14",
        status = status ?: "finished",
        tmdbId = tmdbId
    )

    private fun EpisodeDto.toModel(): Episode = Episode(
        id = id,
        showId = showId ?: "",
        seasonNumber = seasonNumber ?: 1,
        episodeNumber = episodeNumber ?: 1,
        title = title ?: "",
        synopsis = synopsis ?: "",
        duration = duration ?: 0f,
        size = size ?: 0L,
        videoCodec = videoCodec ?: "",
        audioCodec = audioCodec ?: "",
        bitDepth = bitDepth ?: 0,
        resolution = resolution ?: "",
        fps = fps ?: 0f,
        audioTracks = audioTracks?.map { track ->
            AudioTrack(
                index = track.index ?: 0,
                trackNumber = track.trackNumber ?: 0,
                title = track.title ?: "",
                language = track.language ?: "jpn",
                codec = track.codec ?: "aac",
                channels = track.channels ?: 2
            )
        } ?: emptyList(),
        subtitleTracks = subtitleTracks?.map { track ->
            SubtitleTrack(
                index = track.index ?: 0,
                trackNumber = track.trackNumber ?: 0,
                title = track.title ?: "",
                language = track.language ?: "spa",
                format = track.format ?: "ass",
                isDefault = track.isDefault ?: false,
                isForced = track.isForced ?: false,
                isBitmap = track.isBitmap ?: false
            )
        } ?: emptyList(),
        thumbnailPath = thumbnailPath ?: "",
        introStart = introStart,
        introEnd = introEnd,
        outroStart = outroStart,
        outroEnd = outroEnd,
        chapters = chapters?.map { Chapter(it.title, it.start, it.end) } ?: emptyList(),
        streamUrl = streamUrl ?: "",
        directPlayable = directPlayable ?: false,
        container = container ?: "mp4"
    )
}
