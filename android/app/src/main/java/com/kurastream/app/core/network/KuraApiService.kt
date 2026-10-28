package com.kurastream.app.core.network

import com.kurastream.app.core.network.dto.*
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

interface KuraApiService {

    // Server
    @GET("api/health")
    suspend fun getHealth(
        @Header("X-Target-Base-Url") targetBaseUrl: String? = null,
        @Header("X-No-Auth") noAuth: String? = "true"
    ): ServerHealthDto

    /** Public: the build the server offers, used to offer in-app updates. */
    @GET("api/app/android")
    suspend fun getAppInfo(): AppInfoDto

    // Auth
    @POST("api/login")
    suspend fun login(@Body body: LoginRequestDto): AuthResponseDto

    @POST("api/register")
    suspend fun register(@Body body: RegisterRequestDto): AuthResponseDto

    @POST("api/logout")
    suspend fun logout(): BaseResponseDto

    // Profiles
    @GET("api/profiles")
    suspend fun getProfiles(): ProfilesResponseDto

    @POST("api/profiles/select")
    suspend fun selectProfile(@Body body: SelectProfileRequestDto): SelectProfileResponseDto

    @POST("api/profiles")
    suspend fun saveProfile(@Body body: SaveProfileRequestDto): BaseResponseDto

    @DELETE("api/profiles/{id}")
    suspend fun deleteProfile(@Path("id") id: String): BaseResponseDto

    /** Same as DELETE, but able to carry the profile's PIN when it has one. */
    @POST("api/profiles/delete")
    suspend fun deleteProfileWithPin(@Body body: DeleteProfileRequestDto): BaseResponseDto

    // Catalog & Shows
    @GET("api/shows")
    suspend fun getShows(
        @Query("type") type: String = "all",
        @Query("status") status: String = "all",
        @Query("sort") sort: String = "default"
    ): List<ShowDto>

    @GET("api/shows/random")
    suspend fun getRandomShow(): RandomShowResponseDto

    @GET("api/shows/{id}")
    suspend fun getShowDetails(@Path("id") showId: String): ShowDetailResponseDto

    @GET("api/episodes/{id}")
    suspend fun getEpisodeDetails(@Path("id") episodeId: String): EpisodeDto

    // Subtitles
    @GET("api/subtitles/{episodeId}/{track}")
    @Streaming
    suspend fun getSubtitle(
        @Path("episodeId") episodeId: String,
        @Path("track") trackIndex: Int
    ): ResponseBody

    // Progress & History
    @GET("api/history")
    suspend fun getHistory(): List<HistoryItemDto>

    @GET("api/history/continue")
    suspend fun getContinueWatching(): List<ContinueWatchingItemDto>

    @DELETE("api/history")
    suspend fun deleteHistoryItem(@Query("episode_id") episodeId: String): BaseResponseDto

    @DELETE("api/history")
    suspend fun clearAllHistory(@Query("clear") clear: String = "all"): BaseResponseDto

    @GET("api/progress/{episodeId}")
    suspend fun getProgress(@Path("episodeId") episodeId: String): ProgressResponseDto

    @POST("api/progress/{episodeId}")
    suspend fun saveProgress(
        @Path("episodeId") episodeId: String,
        @Body body: SaveProgressRequestDto
    ): SaveProgressResponseDto

    // Favorites
    @GET("api/favorites")
    suspend fun getFavorites(): List<ShowDto>

    @POST("api/favorites")
    suspend fun toggleFavorite(@Body body: ToggleFavoriteRequestDto): ToggleFavoriteResponseDto

    @GET("api/favorites/check")
    suspend fun checkFavorite(@Query("showId") showId: String): FavoriteCheckResponseDto

    // Calendar
    @GET("api/calendar")
    suspend fun getCalendarSchedule(): Map<String, List<CalendarScheduleItemDto>>

    // Notifications
    @GET("api/notifications")
    suspend fun getNotifications(): NotificationsResponseDto

    @POST("api/notifications/seen")
    suspend fun markNotificationsSeen(): BaseResponseDto

    // Preferences & Stats
    @GET("api/user/preferences")
    suspend fun getUserPreferences(): UserPreferencesResponseDto

    @POST("api/user/preferences")
    suspend fun saveUserPreferences(@Body body: UserPreferencesDto): BaseResponseDto

    @GET("api/user/stats")
    suspend fun getUserStats(): UserStatsResponseDto

    // Comments
    @GET("api/comments")
    suspend fun getComments(@Query("show_id") showId: String): CommentsResponseDto

    @POST("api/comments")
    suspend fun addComment(@Body body: AddCommentRequestDto): BaseResponseDto

    @DELETE("api/comments/{id}")
    suspend fun deleteComment(@Path("id") id: String): BaseResponseDto

    // Watch Party
    @POST("api/party/create")
    suspend fun createPartyRoom(@Body body: PartyCreateRequestDto): PartyCreateResponseDto

    @POST("api/party/join")
    suspend fun joinPartyRoom(@Body body: PartyJoinRequestDto): PartyJoinResponseDto

    @POST("api/party/leave")
    suspend fun leavePartyRoom(
        @Header("X-Party-Member-Id") memberId: String,
        @Header("X-Party-Member-Token") memberToken: String,
        @Query("room_id") roomId: String,
        @Query("member_id") memberIdQuery: String = memberId
    ): BaseResponseDto

    /** The stream ticket lasts 15 minutes; the repository renews it every 8. */
    @POST("api/party/refresh-ticket")
    suspend fun refreshPartyTicket(
        @Header("X-Party-Member-Id") memberId: String,
        @Header("X-Party-Member-Token") memberToken: String,
        @Body body: PartyTicketRequestDto
    ): PartyTicketResponseDto

    @POST("api/party/sync")
    suspend fun syncPartyPlayback(
        @Header("X-Party-Member-Id") memberId: String,
        @Header("X-Party-Member-Token") memberToken: String,
        @Body body: PartySyncRequestDto
    ): BaseResponseDto

    @POST("api/party/message")
    suspend fun sendPartyMessage(
        @Header("X-Party-Member-Id") memberId: String,
        @Header("X-Party-Member-Token") memberToken: String,
        @Body body: PartyMessageRequestDto
    ): BaseResponseDto

    @GET("api/party/poll")
    suspend fun pollPartyEvents(
        @Query("room_id") roomId: String,
        @Query("since") since: Long
    ): ResponseBody
}
