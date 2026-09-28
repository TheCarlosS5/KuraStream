package com.kurastream.app.core.network

import com.kurastream.app.core.security.TokenStorage
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

/**
 * Ensures requests dynamically target the currently active ServerProfile base URL.
 */
class DynamicBaseUrlInterceptor(
    private val getBaseUrl: () -> String?
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        var request = chain.request()
        val overrideUrl = request.header("X-Target-Base-Url")
        val currentBase = if (!overrideUrl.isNullOrBlank()) overrideUrl else getBaseUrl()

        if (!currentBase.isNullOrBlank()) {
            val newHttpUrl = currentBase.toHttpUrlOrNull()
            if (newHttpUrl != null) {
                val updatedUrl = request.url.newBuilder()
                    .scheme(newHttpUrl.scheme)
                    .host(newHttpUrl.host)
                    .port(newHttpUrl.port)
                    .build()
                request = request.newBuilder()
                    .removeHeader("X-Target-Base-Url")
                    .url(updatedUrl)
                    .build()
            }
        }

        return chain.proceed(request)
    }
}

/**
 * Injects Authorization header with Bearer token, and emits unauthorized signals on 401.
 */
class AuthInterceptor(
    private val tokenStorage: TokenStorage
) : Interceptor {

    private val _unauthorizedEvents = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val unauthorizedEvents = _unauthorizedEvents.asSharedFlow()

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val builder = original.newBuilder()

        // Don't overwrite existing Authorization if explicitly provided
        if (original.header("Authorization") == null) {
            val token = tokenStorage.getToken()
            if (!token.isNullOrBlank()) {
                builder.header("Authorization", "Bearer $token")
            }
        }

        val response = chain.proceed(builder.build())

        // Handle 401 Unauthorized cleanly without infinite recursion
        if (response.code == 401) {
            val path = original.url.encodedPath
            if (!path.contains("/api/login") && !path.contains("/api/register")) {
                _unauthorizedEvents.tryEmit(Unit)
            }
        }

        return response
    }
}

/**
 * Restricts all HTTP responses to the configured server host to prevent rogue redirects.
 */
class SafeOriginInterceptor(
    private val getBaseUrl: () -> String?
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val response = chain.proceed(chain.request())
        val configuredBase = getBaseUrl()?.toHttpUrlOrNull() ?: return response

        if (response.isRedirect) {
            val location = response.header("Location")
            if (!location.isNullOrBlank()) {
                val redirectUrl = location.toHttpUrlOrNull()
                if (redirectUrl != null && (redirectUrl.host != configuredBase.host || redirectUrl.port != configuredBase.port)) {
                    throw IOException("Redirección bloqueada por seguridad: origin no autorizado ($location)")
                }
            }
        }
        return response
    }
}
