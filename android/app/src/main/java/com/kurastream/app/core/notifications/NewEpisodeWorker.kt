package com.kurastream.app.core.notifications

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.repository.CatalogRepository
import com.kurastream.app.core.security.TokenStorage
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.first

@EntryPoint
@InstallIn(SingletonComponent::class)
interface NewEpisodeWorkerEntryPoint {
    fun catalogRepository(): CatalogRepository
    fun preferences(): KuraPreferencesDataSource
    fun tokenStorage(): TokenStorage
}

/** Periodic check of /api/notifications. Never fails the schedule: a server that is off is simply tried again later. */
class NewEpisodeWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val entry = EntryPointAccessors.fromApplication(applicationContext, NewEpisodeWorkerEntryPoint::class.java)
        val prefs = entry.preferences().preferencesFlow.first()
        // Signed out, or no profile picked yet: nothing to ask for
        if (prefs.activeServerUrl.isNullOrBlank() || prefs.activeProfileId.isNullOrBlank() || !entry.tokenStorage().hasToken()) {
            return Result.success()
        }
        val result = entry.catalogRepository().getNotifications()
        result.getOrNull()?.let { NewEpisodeNotifier(applicationContext).notifyNew(it.notifications) }
        return Result.success()
    }

    companion object {
        const val UNIQUE_NAME = "new-episode-check"
    }
}
