package com.kurastream.app.core.network

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

sealed interface KuraDeepLink {
    data class ServerConnect(val serverUrl: String) : KuraDeepLink
    data class ShowDetail(val showId: String) : KuraDeepLink
    data class PlayEpisode(val episodeId: String) : KuraDeepLink
    data class JoinWatchParty(val roomCode: String) : KuraDeepLink
    data object Invalid : KuraDeepLink
}

object DeepLinkParser {

    /**
     * Parses custom kurastream:// URIs.
     * Supported formats:
     * - kurastream://server?url=http%3A%2F%2F192.168.1.50%3A3000
     * - kurastream://show/{showId}
     * - kurastream://episode/{episodeId}
     * - kurastream://party/{roomCode}
     */
    fun parse(uriString: String?): KuraDeepLink {
        if (uriString.isNullOrBlank()) return KuraDeepLink.Invalid

        val uri = try {
            URI.create(uriString.trim())
        } catch (_: Exception) {
            return KuraDeepLink.Invalid
        }

        if (uri.scheme?.equals("kurastream", ignoreCase = true) == true) {
            val host = uri.host?.lowercase() ?: return KuraDeepLink.Invalid
            return when (host) {
                "server" -> {
                    val query = uri.rawQuery ?: ""
                    val urlParam = query.split("&")
                        .map { it.split("=") }
                        .firstOrNull { it.size == 2 && it[0] == "url" }
                        ?.let { URLDecoder.decode(it[1], StandardCharsets.UTF_8.name()) }
                    if (!urlParam.isNullOrBlank()) KuraDeepLink.ServerConnect(urlParam) else KuraDeepLink.Invalid
                }
                "show" -> {
                    val showId = uri.path?.trim('/')
                    if (!showId.isNullOrBlank()) KuraDeepLink.ShowDetail(showId) else KuraDeepLink.Invalid
                }
                "episode" -> {
                    val epId = uri.path?.trim('/')
                    if (!epId.isNullOrBlank()) KuraDeepLink.PlayEpisode(epId) else KuraDeepLink.Invalid
                }
                "party" -> {
                    val code = uri.path?.trim('/')
                    if (!code.isNullOrBlank()) KuraDeepLink.JoinWatchParty(code) else KuraDeepLink.Invalid
                }
                else -> KuraDeepLink.Invalid
            }
        }

        return KuraDeepLink.Invalid
    }
}
