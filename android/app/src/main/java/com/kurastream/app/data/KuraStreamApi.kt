package com.kurastream.app.data

import okhttp3.Interceptor
import okhttp3.OkHttpClient
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface KuraStreamApi {

    @GET("api/shows")
    suspend fun getShows(): List<Show>

    @GET("api/shows/{id}")
    suspend fun getShowDetails(@Path("id") id: String): ShowDetailResponse

    @POST("api/login")
    suspend fun login(@Body request: LoginRequest): LoginResponse

    @GET("api/progress/{episodeId}")
    suspend fun getProgress(
        @Path("episodeId") episodeId: String,
        @Query("username") username: String
    ): ProgressResponse

    @POST("api/progress/{episodeId}")
    suspend fun saveProgress(
        @Path("episodeId") episodeId: String,
        @Body request: ProgressRequest
    ): Response<Unit>

    companion object {
        fun create(baseUrl: String, preferencesManager: PreferencesManager): KuraStreamApi {
            require(baseUrl.isNotBlank()) { "Base URL cannot be blank" }
            val authInterceptor = Interceptor { chain ->
                val originalRequest = chain.request()
                val token = preferencesManager.getAuthToken()

                val newRequest = if (!token.isNullOrEmpty()) {
                    originalRequest.newBuilder()
                        .header("Authorization", "Bearer $token")
                        .build()
                } else {
                    originalRequest
                }

                chain.proceed(newRequest)
            }

            val okHttpClient = OkHttpClient.Builder()
                .addInterceptor(authInterceptor)
                .build()

            val formattedBaseUrl = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"

            val retrofit = Retrofit.Builder()
                .baseUrl(formattedBaseUrl)
                .client(okHttpClient)
                .addConverterFactory(GsonConverterFactory.create())
                .build()

            return retrofit.create(KuraStreamApi::class.java)
        }
    }
}
