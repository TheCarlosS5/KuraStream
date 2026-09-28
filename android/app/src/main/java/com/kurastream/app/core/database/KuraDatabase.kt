package com.kurastream.app.core.database

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [
        ServerProfileEntity::class,
        CachedShowEntity::class,
        CachedEpisodeEntity::class,
        CachedHistoryEntity::class
    ],
    version = 2,
    exportSchema = false
)
abstract class KuraDatabase : RoomDatabase() {
    abstract fun serverProfileDao(): ServerProfileDao
    abstract fun showDao(): ShowDao
    abstract fun historyDao(): HistoryDao
}
