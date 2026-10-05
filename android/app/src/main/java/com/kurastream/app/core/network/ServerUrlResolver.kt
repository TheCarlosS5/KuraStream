package com.kurastream.app.core.network

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.net.InetAddress
import java.util.regex.Pattern

data class ServerUrlValidationResult(
    val isValid: Boolean,
    val normalizedUrl: String = "",
    val isHttps: Boolean = false,
    val isLocalNetwork: Boolean = false,
    val errorMessage: String? = null
)

object ServerUrlResolver {

    private val IPV4_PATTERN = Pattern.compile(
        "^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$"
    )

    /**
     * Sanitizes and normalizes any user-entered server URL.
     * Accepts:
     * - https://mykurastream.com
     * - http://192.168.1.50:3000
     * - 10.0.0.5:3000 (auto-prepends http://)
     * - mykuraserver.local:3000
     */
    fun validateAndNormalize(rawInput: String): ServerUrlValidationResult {
        val trimmed = rawInput.trim()
        if (trimmed.isBlank()) {
            return ServerUrlValidationResult(
                isValid = false,
                errorMessage = "La URL del servidor no puede estar vacía"
            )
        }

        if (trimmed.contains("://")) {
            if (!trimmed.startsWith("http://", ignoreCase = true) && !trimmed.startsWith("https://", ignoreCase = true)) {
                return ServerUrlValidationResult(
                    isValid = false,
                    errorMessage = "Solo se admiten protocolos http o https"
                )
            }
        }

        val urlWithScheme = if (!trimmed.startsWith("http://", ignoreCase = true) &&
            !trimmed.startsWith("https://", ignoreCase = true)
        ) {
            // Default to http for IP / local hostnames, https for full domains
            if (isLikelyLocalHost(trimmed)) "http://$trimmed" else "https://$trimmed"
        } else {
            trimmed
        }

        val parsed = urlWithScheme.toHttpUrlOrNull()
            ?: return ServerUrlValidationResult(
                isValid = false,
                errorMessage = "Formato de URL no válido"
            )

        if (parsed.scheme != "http" && parsed.scheme != "https") {
            return ServerUrlValidationResult(
                isValid = false,
                errorMessage = "Solo se admiten protocolos http o https"
            )
        }

        val normalized = buildString {
            append(parsed.scheme)
            append("://")
            append(parsed.host)
            if (parsed.port != 80 && parsed.port != 443) {
                append(":")
                append(parsed.port)
            }
            // Strip trailing slash from base url
            val path = parsed.encodedPath.trimEnd('/')
            if (path.isNotEmpty() && path != "/") {
                append(path)
            }
        }

        val isLocal = isLocalAddress(parsed.host)
        val isHttps = parsed.scheme == "https"

        return ServerUrlValidationResult(
            isValid = true,
            normalizedUrl = normalized,
            isHttps = isHttps,
            isLocalNetwork = isLocal
        )
    }

    /**
     * Checks whether a host belongs to private LAN IP ranges (192.168.x, 10.x, 172.16-31.x, 127.x, .local).
     */
    fun isLocalAddress(host: String): Boolean {
        val h = host.lowercase().trim()
        if (h == "localhost" || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".home.arpa")) {
            return true
        }

        // IPv6 literals (with or without brackets): loopback, unique local (fc00::/7) and link-local (fe80::/10)
        val v6 = h.removePrefix("[").removeSuffix("]").substringBefore('%')
        if (v6.contains(':')) {
            return v6 == "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") ||
                v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb")
        }

        if (IPV4_PATTERN.matcher(h).matches()) {
            val parts = h.split(".").mapNotNull { it.toIntOrNull() }
            if (parts.size == 4) {
                // 127.0.0.0/8
                if (parts[0] == 127) return true
                // 10.0.0.0/8
                if (parts[0] == 10) return true
                // 192.168.0.0/16
                if (parts[0] == 192 && parts[1] == 168) return true
                // 172.16.0.0/12
                if (parts[0] == 172 && parts[1] in 16..31) return true
                // 100.64.0.0/10 carrier-grade NAT (Tailscale and some hotspots)
                if (parts[0] == 100 && parts[1] in 64..127) return true
                // 169.254.0.0/16 Link-local
                if (parts[0] == 169 && parts[1] == 254) return true
            }
        }

        return false
    }

    private fun isLikelyLocalHost(host: String): Boolean {
        val hostPart = host.split(":")[0].lowercase()
        return isLocalAddress(hostPart)
    }

    /**
     * Construct absolute media / image URL against normalized base URL.
     */
    fun buildMediaUrl(baseUrl: String, relativePath: String): String {
        // No artwork: return "" so image loaders show their fallback instead of requesting
        // the server root (which answers with the web app's HTML).
        if (relativePath.isBlank()) return ""
        if (relativePath.startsWith("http://", ignoreCase = true) ||
            relativePath.startsWith("https://", ignoreCase = true)
        ) {
            return relativePath
        }

        val baseClean = baseUrl.trimEnd('/')
        val pathClean = relativePath.trimStart('/')
        return "$baseClean/$pathClean"
    }

    /**
     * Subtitle URL. The server always answers with ASS. When the video is a remux/transcode that
     * FFmpeg started at [startSeconds], the server must shift cue times by the same amount or every
     * line appears [startSeconds] late.
     */
    fun buildSubtitleUrl(baseUrl: String, episodeId: String, trackIndex: Int, startSeconds: Float? = null): String {
        val baseClean = baseUrl.trimEnd('/')
        val encodedEp = HttpUrl.Builder()
            .scheme("http")
            .host("dummy")
            .addPathSegment(episodeId)
            .build()
            .encodedPathSegments[0]
        val query = if (startSeconds != null && startSeconds > 0f) "?start=$startSeconds" else ""
        return "$baseClean/api/subtitles/$encodedEp/$trackIndex$query"
    }

    /**
     * Build streaming URL for episode, accounting for start offset and audio track.
     */
    fun buildStreamUrl(
        baseUrl: String,
        episodeId: String,
        startSeconds: Float? = null,
        audioTrack: Int? = null,
        forceH264: Boolean = false,
        downmixStereo: Boolean = false
    ): String {
        val baseClean = baseUrl.trimEnd('/')
        val encodedEp = HttpUrl.Builder()
            .scheme("http")
            .host("dummy")
            .addPathSegment(episodeId)
            .build()
            .encodedPathSegments[0]

        val params = mutableListOf<String>()
        if (startSeconds != null && startSeconds > 0f) {
            params.add("start=$startSeconds")
        }
        if (audioTrack != null && audioTrack >= 0) {
            params.add("audio=$audioTrack")
        }
        if (forceH264) {
            params.add("codec=h264")
        }
        if (downmixStereo) {
            params.add("downmix=stereo")
        }

        val query = if (params.isNotEmpty()) "?" + params.joinToString("&") else ""
        return "$baseClean/api/stream/$encodedEp$query"
    }
}
