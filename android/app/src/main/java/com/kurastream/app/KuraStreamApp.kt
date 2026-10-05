package com.kurastream.app

import android.app.Application
import com.kurastream.app.core.notifications.NotificationScheduler
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class KuraStreamApp : Application() {
    override fun onCreate() {
        super.onCreate()
        NotificationScheduler.schedule(this)
    }
}
