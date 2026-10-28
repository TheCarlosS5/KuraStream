package com.kurastream.app.core.preferences

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import javax.inject.Inject
import javax.inject.Singleton

/**
 * In-memory snapshot of [UserSessionPreferences] for fast synchronous access by OkHttp interceptors.
 *
 * Reading preferences via `runBlocking` on DataStore blocks OkHttp dispatch threads on every
 * request (including rapid video chunk/segment fetches). This singleton caches the latest preferences
 * in memory by collecting [KuraPreferencesDataSource.preferencesFlow] in the background, falling back
 * to a single blocking read only if requested before the initial emission arrives.
 */
@Singleton
class ActiveServerSnapshot internal constructor(
    private val preferencesDataSource: KuraPreferencesDataSource,
    scope: CoroutineScope
) {

    @Inject
    constructor(preferencesDataSource: KuraPreferencesDataSource) : this(
        preferencesDataSource = preferencesDataSource,
        scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    )

    @Volatile
    private var latest: UserSessionPreferences? = null

    init {
        scope.launch {
            preferencesDataSource.preferencesFlow.collect { prefs ->
                latest = prefs
            }
        }
    }

    fun current(): UserSessionPreferences? {
        val cached = latest
        if (cached != null) {
            return cached
        }
        return synchronized(this) {
            latest ?: runBlocking {
                preferencesDataSource.preferencesFlow.firstOrNull()
            }?.also { latest = it }
        }
    }

    /**
     * Re-reads the stored preferences now. Call it right after changing the active server: the background
     * collector catches up asynchronously, and a request sent in between would still use the old server.
     */
    suspend fun refresh() {
        latest = preferencesDataSource.preferencesFlow.first()
    }

    val activeServerUrl: String?
        get() = current()?.activeServerUrl

    val activeServerId: String?
        get() = current()?.activeServerId
}
