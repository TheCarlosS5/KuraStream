package com.kurastream.app.core.network

import org.junit.Assert.*
import org.junit.Test

class ServerUrlResolverTest {

    @Test
    fun `validate standard https domain normalizes and strips trailing slash`() {
        val result = ServerUrlResolver.validateAndNormalize("https://kurastream.example.com/")
        assertTrue(result.isValid)
        assertEquals("https://kurastream.example.com", result.normalizedUrl)
        assertTrue(result.isHttps)
        assertFalse(result.isLocalNetwork)
    }

    @Test
    fun `validate https domain with custom port preserves port`() {
        val result = ServerUrlResolver.validateAndNormalize("https://stream.myserver.org:8443")
        assertTrue(result.isValid)
        assertEquals("https://stream.myserver.org:8443", result.normalizedUrl)
        assertTrue(result.isHttps)
        assertFalse(result.isLocalNetwork)
    }

    @Test
    fun `validate local lan ipv4 with port detects local network`() {
        val result = ServerUrlResolver.validateAndNormalize("http://192.168.1.100:3000/")
        assertTrue(result.isValid)
        assertEquals("http://192.168.1.100:3000", result.normalizedUrl)
        assertFalse(result.isHttps)
        assertTrue(result.isLocalNetwork)
    }

    @Test
    fun `validate naked ip address automatically prepends http and detects local network`() {
        val result = ServerUrlResolver.validateAndNormalize("10.0.0.15:3000")
        assertTrue(result.isValid)
        assertEquals("http://10.0.0.15:3000", result.normalizedUrl)
        assertFalse(result.isHttps)
        assertTrue(result.isLocalNetwork)
    }

    @Test
    fun `validate localhost detects local network`() {
        val result = ServerUrlResolver.validateAndNormalize("http://localhost:3000")
        assertTrue(result.isValid)
        assertEquals("http://localhost:3000", result.normalizedUrl)
        assertTrue(result.isLocalNetwork)
    }

    @Test
    fun `reject empty or blank input`() {
        val result = ServerUrlResolver.validateAndNormalize("   ")
        assertFalse(result.isValid)
        assertNotNull(result.errorMessage)
    }

    @Test
    fun `reject invalid scheme like ftp or file`() {
        val result = ServerUrlResolver.validateAndNormalize("ftp://192.168.1.100:3000")
        assertFalse(result.isValid)
    }

    @Test
    fun `isLocalAddress correctly classifies private ranges`() {
        assertTrue(ServerUrlResolver.isLocalAddress("192.168.0.1"))
        assertTrue(ServerUrlResolver.isLocalAddress("10.200.1.5"))
        assertTrue(ServerUrlResolver.isLocalAddress("172.16.0.10"))
        assertTrue(ServerUrlResolver.isLocalAddress("172.31.255.254"))
        assertTrue(ServerUrlResolver.isLocalAddress("127.0.0.1"))
        assertTrue(ServerUrlResolver.isLocalAddress("myserver.local"))

        assertFalse(ServerUrlResolver.isLocalAddress("8.8.8.8"))
        assertFalse(ServerUrlResolver.isLocalAddress("1.1.1.1"))
        assertFalse(ServerUrlResolver.isLocalAddress("kurastream.tv"))
    }

    @Test
    fun `buildMediaUrl resolves relative paths against base url`() {
        val url = ServerUrlResolver.buildMediaUrl("http://192.168.1.100:3000/", "/library/anime/poster.webp")
        assertEquals("http://192.168.1.100:3000/library/anime/poster.webp", url)
    }

    @Test
    fun `buildMediaUrl preserves already absolute urls`() {
        val absolute = "https://cdn.example.com/images/banner.jpg"
        val url = ServerUrlResolver.buildMediaUrl("http://192.168.1.100:3000", absolute)
        assertEquals(absolute, url)
    }

    @Test
    fun `buildStreamUrl constructs proper streaming query parameters`() {
        val url = ServerUrlResolver.buildStreamUrl(
            baseUrl = "http://192.168.1.50:3000",
            episodeId = "frieren_s01e01",
            startSeconds = 120.5f,
            audioTrack = 1,
            forceH264 = true,
            downmixStereo = true
        )
        assertTrue(url.contains("/api/stream/frieren_s01e01"))
        assertTrue(url.contains("start=120.5"))
        assertTrue(url.contains("audio=1"))
        assertTrue(url.contains("codec=h264"))
        assertTrue(url.contains("downmix=stereo"))
    }
}
