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
        preferencesDataSource: KuraPreferencesDataSource
    ): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.NONE // Never log bearer tokens or video streams in release/logcat
        }

        val dynamicBaseInterceptor = DynamicBaseUrlInterceptor {
            runBlocking {
                preferencesDataSource.preferencesFlow.firstOrNull()?.activeServerUrl
            }
        }

        val authInterceptor = AuthInterceptor(tokenStorage) {
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
        preferencesDataSource: KuraPreferencesDataSource
    ): OkHttpClient {
        val authInterceptor = Interceptor { chain ->
            val original = chain.request()
            val builder = original.newBuilder()

            val prefs = runBlocking { preferencesDataSource.preferencesFlow.firstOrNull() }
            val activeServerUrl = prefs?.activeServerUrl
            val activeServerId = prefs?.activeServerId

            val isMatchingServer = if (!activeServerUrl.isNullOrBlank()) {
                val parsedActive = activeServerUrl.toHttpUrlOrNull()
                parsedActive != null && parsedActive.host.equals(original.url.host, ignoreCase = true)
            } else {
                true
            }

            if (isMatchingServer) {
                // If caller didn't pass explicit authorization or stream capability
                if (original.header("Authorization") == null && original.header("X-Stream-Capability") == null) {
                    val token = tokenStorage.getToken(activeServerId)
                    if (!token.isNullOrBlank()) {
                        builder.header("Authorization", "Bearer $token")
                    }
                }
            }

            chain.proceed(builder.build())
        }

        return OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
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
    fun provideWatchPartyClient(okHttpClient: OkHttpClient, json: Json): WatchPartyClient {
        return WatchPartyClient(okHttpClient, json)
    }

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
        preferencesDataSource: KuraPreferencesDataSource
    ): AuthRepository = AuthRepository(apiService, tokenStorage, preferencesDataSource)

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
