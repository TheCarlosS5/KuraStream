package com.kurastream.app.core.database

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface ServerProfileDao {
    @Query("SELECT * FROM server_profiles ORDER BY lastConnected DESC")
    fun getAllServers(): Flow<List<ServerProfileEntity>>

    @Query("SELECT * FROM server_profiles WHERE id = :id LIMIT 1")
    suspend fun getServerById(id: String): ServerProfileEntity?

    @Query("SELECT * FROM server_profiles WHERE baseUrl = :baseUrl LIMIT 1")
    suspend fun getServerByUrl(baseUrl: String): ServerProfileEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertServer(server: ServerProfileEntity)

    @Update
    suspend fun updateServer(server: ServerProfileEntity)

    @Query("DELETE FROM server_profiles WHERE id = :id")
    suspend fun deleteServer(id: String)
}

@Dao
interface ShowDao {
    @Query("""
        SELECT * FROM cached_shows 
        WHERE serverId = :serverId 
          AND (:isKidsMode = 0 OR isRestrictedKids = 0)
        ORDER BY rating DESC
    """)
    fun getCachedShows(serverId: String, isKidsMode: Boolean): Flow<List<CachedShowEntity>>

    @Query("""
        SELECT * FROM cached_shows 
        WHERE serverId = :serverId 
          AND (:isKidsMode = 0 OR isRestrictedKids = 0)
          AND (title LIKE '%' || :query || '%' OR genres LIKE '%' || :query || '%')
    """)
    suspend fun searchCachedShows(serverId: String, isKidsMode: Boolean, query: String): List<CachedShowEntity>

    @Query("SELECT * FROM cached_shows WHERE serverId = :serverId AND id = :showId LIMIT 1")
    suspend fun getShowById(serverId: String, showId: String): CachedShowEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertShows(shows: List<CachedShowEntity>)

    @Query("DELETE FROM cached_shows WHERE serverId = :serverId")
    suspend fun clearShowsForServer(serverId: String)
}

@Dao
interface HistoryDao {
    @Query("""
        SELECT * FROM cached_history 
        WHERE serverId = :serverId 
          AND username = :username 
          AND profileId = :profileId 
        ORDER BY updatedAt DESC
    """)
    fun getHistory(serverId: String, username: String, profileId: String): Flow<List<CachedHistoryEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertHistory(items: List<CachedHistoryEntity>)

    @Query("""
        DELETE FROM cached_history 
        WHERE serverId = :serverId 
          AND username = :username 
          AND profileId = :profileId 
          AND episodeId = :episodeId
    """)
    suspend fun deleteHistoryItem(serverId: String, username: String, profileId: String, episodeId: String)

    @Query("""
        DELETE FROM cached_history 
        WHERE serverId = :serverId 
          AND username = :username 
          AND profileId = :profileId
    """)
    suspend fun clearHistory(serverId: String, username: String, profileId: String)
}
