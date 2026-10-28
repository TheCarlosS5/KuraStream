package com.kurastream.app.core.notifications

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object NotificationScheduler {
    /** Every 30 minutes while a network is available (Android may stretch this to save battery). Idempotent. */
    fun schedule(context: Context) {
        val request = PeriodicWorkRequestBuilder<NewEpisodeWorker>(30, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            NewEpisodeWorker.UNIQUE_NAME, ExistingPeriodicWorkPolicy.KEEP, request
        )
    }
}
