package com.kurastream.app.core.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import androidx.room.Room
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.kurastream.app.core.database.*
import com.kurastream.app.core.network.*
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.repository.*
import com.kurastream.app.core.security.SecureTokenStorage
import com.kurastream.app.core.security.TokenStorage
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit
import javax.inject.Named
import javax.inject.Singleton
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "kurastream_preferences")

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideTokenStorage(
        @ApplicationContext context: Context,
        preferencesDataSource: KuraPreferencesDataSource
    ): TokenStorage {
        return SecureTokenStorage(context) {
            runBlocking { preferencesDataSource.preferencesFlow.firstOrNull()?.activeServerId }
        }
    }

    @Provides
    @Singleton
    fun providePreferencesDataSource(@ApplicationContext context: Context): KuraPreferencesDataSource {
        return KuraPreferencesDataSource(context.dataStore)
    }

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): KuraDatabase {
        return Room.databaseBuilder(
            context,
            KuraDatabase::class.java,
            "kurastream.db"
        )
            .fallbackToDestructiveMigration()
            .build()
    }

    @Provides
    fun provideServerDao(database: KuraDatabase): ServerProfileDao = database.serverProfileDao()

    @Provides
    fun provideShowDao(database: KuraDatabase): ShowDao = database.showDao()

    @Provides
    fun provideHistoryDao(database: KuraDatabase): HistoryDao = database.historyDao()

    @Provides
    @Singleton
    fun provideJson(): Json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    @Provides
    @Singleton
    fun provideOkHttpClient(
        tokenStorage: TokenStorage,
        preferencesDataSource: KuraPreferencesDataSource,
        sessionEvents: SessionEvents
    ): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.NONE // Never log bearer tokens or video streams in release/logcat
        }

        val dynamicBaseInterceptor = DynamicBaseUrlInterceptor {
            runBlocking {
                preferencesDataSource.preferencesFlow.firstOrNull()?.activeServerUrl
            }
        }

        val authInterceptor = AuthInterceptor(tokenStorage, sessionEvents::notifyUnauthorized) {
            runBlocking {
                val prefs = preferencesDataSource.preferencesFlow.firstOrNull()
                Pair(prefs?.activeServerId, prefs?.activeServerUrl)
            }
        }
        val safeOriginInterceptor = SafeOriginInterceptor {
            runBlocking {
                preferencesDataSource.preferencesFlow.firstOrNull()?.activeServerUrl
            }
        }

        return OkHttpClient.Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .addInterceptor(dynamicBaseInterceptor)
            .addInterceptor(authInterceptor)
            .addInterceptor(safeOriginInterceptor)
            .addInterceptor(logging)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    @Provides
    @Singleton
    @Named("media")
    fun provideMediaOkHttpClient(
        tokenStorage: TokenStorage,
        preferencesDataSource: KuraPreferencesDataSource,
        watchPartyRepositoryProvider: javax.inject.Provider<WatchPartyRepository>,
        partyPlaybackContextProvider: javax.inject.Provider<com.kurastream.app.core.player.PartyPlaybackContext>
    ): OkHttpClient {
        val authInterceptor = Interceptor { chain ->
            val original = chain.request()
            val builder = original.newBuilder()

            val prefs = runBlocking { preferencesDataSource.preferencesFlow.firstOrNull() }
            val activeServerUrl = prefs?.activeServerUrl
            val activeServerId = prefs?.activeServerId

            val isMatchingServer = if (!activeServerUrl.isNullOrBlank()) {
                val parsedActive = activeServerUrl.toHttpUrlOrNull()
                parsedActive != null && parsedActive.hasSameOrigin(original.url)
            } else {
                true
            }

            if (isMatchingServer) {
                // The room's stream ticket only ever goes to the stream of the room's current episode, never to
                // other episodes or other endpoints.
                val partySession = watchPartyRepositoryProvider.get().activeSession.value
                val streamedEpisode = original.url.pathSegments.let { segments ->
                    val i = segments.indexOf("stream")
                    if (i >= 0 && i + 1 < segments.size) segments[i + 1] else null
                }
                val roomEpisode = partySession?.room?.episodeId
                val ticketApplies = streamedEpisode != null && (roomEpisode == null || streamedEpisode == roomEpisode)

                val streamTicket = original.header("X-Stream-Capability")
                    ?: (if (ticketApplies) (partyPlaybackContextProvider.get().streamCapabilityToken.value ?: partySession?.streamTicket) else null)

                if (!streamTicket.isNullOrBlank() && original.header("X-Stream-Capability") == null) {
                    builder.header("X-Stream-Capability", streamTicket)
                }

                // The signed-in session goes along with the ticket: when the ticket has just expired the server
                // falls back to the session instead of answering 403 (the stream died 15 minutes into a party).
                if (original.header("Authorization") == null) {
                    val token = tokenStorage.getToken(activeServerId)
                    if (!token.isNullOrBlank()) {
                        builder.header("Authorization", "Bearer $token")
                    }
                }
            }

            chain.proceed(builder.build())
        }

        val safeOriginInterceptor = SafeOriginInterceptor {
            runBlocking {
                preferencesDataSource.preferencesFlow.firstOrNull()?.activeServerUrl
            }
        }

        return OkHttpClient.Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .addInterceptor(authInterceptor)
            .addInterceptor(safeOriginInterceptor)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    @Provides
    @Singleton
    fun provideKuraApiService(
        okHttpClient: OkHttpClient,
        json: Json
    ): KuraApiService {
        val contentType = "application/json".toMediaType()
        // Default placeholder origin; DynamicBaseUrlInterceptor replaces it dynamically on each call
        return Retrofit.Builder()
            .baseUrl("http://127.0.0.1:3000/")
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory(contentType))
            .build()
            .create(KuraApiService::class.java)
    }

    @Provides
    @Singleton
    fun provideWatchPartyClient(@ApplicationContext context: Context, okHttpClient: OkHttpClient, json: Json): WatchPartyClient {
        return WatchPartyClient(okHttpClient, json, context)
    }

    @Provides
    @Singleton
    fun provideAppUpdateRepository(
        @ApplicationContext context: Context,
        apiService: KuraApiService,
        @Named("media") downloadClient: OkHttpClient
    ): com.kurastream.app.core.update.AppUpdateRepository =
        com.kurastream.app.core.update.AppUpdateRepository(context, apiService, downloadClient, com.kurastream.app.BuildConfig.VERSION_CODE)

    @Provides
    @Singleton
    fun provideServerRepository(
        serverDao: ServerProfileDao,
        preferencesDataSource: KuraPreferencesDataSource,
        apiService: KuraApiService
    ): ServerRepository = ServerRepository(serverDao, preferencesDataSource, apiService)

    @Provides
    @Singleton
    fun provideAuthRepository(
        apiService: KuraApiService,
        tokenStorage: TokenStorage,
        preferencesDataSource: KuraPreferencesDataSource,
        showDao: ShowDao,
        historyDao: HistoryDao
    ): AuthRepository = AuthRepository(apiService, tokenStorage, preferencesDataSource, showDao, historyDao)

    @Provides
    @Singleton
    fun provideCatalogRepository(
        apiService: KuraApiService,
        showDao: ShowDao
    ): CatalogRepository = CatalogRepository(apiService, showDao)

    @Provides
    @Singleton
    fun provideHistoryRepository(
        apiService: KuraApiService,
        historyDao: HistoryDao
    ): HistoryRepository = HistoryRepository(apiService, historyDao)

    @Provides
    @Singleton
    fun provideWatchPartyRepository(
        apiService: KuraApiService,
        watchPartyClient: WatchPartyClient
    ): WatchPartyRepository = WatchPartyRepository(apiService, watchPartyClient)
}
