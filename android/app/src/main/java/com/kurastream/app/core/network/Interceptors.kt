package com.kurastream.app.core.network

import com.kurastream.app.core.security.TokenStorage
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

/**
 * Ensures requests dynamically target the currently active ServerProfile base URL.
 * Preserves subpath installations (e.g. https://example.com/kura).
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
                val newUrlBuilder = request.url.newBuilder()
                    .scheme(newHttpUrl.scheme)
                    .host(newHttpUrl.host)
                    .port(newHttpUrl.port)

                val basePathSegments = newHttpUrl.pathSegments.filter { it.isNotEmpty() }
                if (basePathSegments.isNotEmpty()) {
                    val basePrefix = basePathSegments.joinToString("/")
                    val originalPath = request.url.encodedPath.trimStart('/')
                    val combinedPath = if (originalPath.isEmpty()) "/$basePrefix" else "/$basePrefix/$originalPath"
                    newUrlBuilder.encodedPath(combinedPath)
                }

                request = request.newBuilder()
                    .removeHeader("X-Target-Base-Url")
                    .url(newUrlBuilder.build())
                    .build()
            }
        }

        return chain.proceed(request)
    }
}

fun okhttp3.HttpUrl.hasSameOrigin(other: okhttp3.HttpUrl): Boolean {
    return this.scheme.equals(other.scheme, ignoreCase = true) &&
            this.host.equals(other.host, ignoreCase = true) &&
            this.port == other.port
}

/**
 * Injects Authorization header with Bearer token for authenticated endpoints.
 * Never leaks tokens across servers or sends tokens to anonymous endpoints (health, login, register).
 */
class AuthInterceptor(
    private val tokenStorage: TokenStorage,
    private val onUnauthorized: () -> Unit = {},
    private val getActiveServerInfo: () -> Pair<String?, String?>? // serverId to serverBaseUrl
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val builder = original.newBuilder()

        val isExplicitNoAuth = original.header("X-No-Auth") == "true"
        if (isExplicitNoAuth) {
            builder.removeHeader("X-No-Auth")
        }

        val path = original.url.encodedPath
        val isAnonymousEndpoint = path.endsWith("/api/health") ||
                path.endsWith("/api/login") ||
                path.endsWith("/api/register")

        // Only inject Authorization if endpoint is not anonymous and no explicit X-No-Auth
        if (!isExplicitNoAuth && !isAnonymousEndpoint && original.header("Authorization") == null) {
            val serverInfo = getActiveServerInfo()
            val activeServerId = serverInfo?.first
            val activeServerBaseUrl = serverInfo?.second

            // Ensure the request target matches the active server's scheme, host, and port to prevent cross-origin leaks
            val isMatchingServer = if (!activeServerBaseUrl.isNullOrBlank()) {
                val parsedActive = activeServerBaseUrl.toHttpUrlOrNull()
                parsedActive != null && parsedActive.hasSameOrigin(original.url)
            } else {
                true
            }

            if (isMatchingServer) {
                val token = tokenStorage.getToken(activeServerId)
                if (!token.isNullOrBlank()) {
                    builder.header("Authorization", "Bearer $token")
                }
            }
        }

        val response = chain.proceed(builder.build())

        // A 401 means the JWT was rejected -> drop it and let the UI route to login.
        // Watch Party endpoints answer 401 for bad *member* credentials, which says nothing about the
        // user session, so they must not log the user out.
        val isPartyEndpoint = path.contains("/api/party/")
        if (response.code == 401 && !isAnonymousEndpoint && !isPartyEndpoint && !isExplicitNoAuth) {
            val activeServerId = getActiveServerInfo()?.first
            tokenStorage.clearToken(activeServerId)
            onUnauthorized()
        }

        return response
    }
}

/**
 * Restricts all HTTP responses and redirects to the configured server origin (scheme, host, port)
 * to prevent rogue cross-origin redirects.
 */
class SafeOriginInterceptor(
    private val getBaseUrl: () -> String?
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        var request = chain.request()
        var response = chain.proceed(request)
        var redirectCount = 0
        val maxRedirects = 5

        while (response.isRedirect && redirectCount < maxRedirects) {
            val configuredBase = getBaseUrl()?.toHttpUrlOrNull()
            val location = response.header("Location")
            if (location.isNullOrBlank()) {
                return response
            }

            val redirectUrl = request.url.resolve(location)
                ?: throw IOException("Redirección bloqueada por seguridad: URL inválida ($location)")

            if (configuredBase != null && !redirectUrl.hasSameOrigin(configuredBase)) {
                response.close()
                throw IOException("Redirección bloqueada por seguridad: origin no autorizado ($redirectUrl)")
            }

            response.close()
            redirectCount++

            request = request.newBuilder()
                .url(redirectUrl)
                .build()
            response = chain.proceed(request)
        }

        return response
    }
}

