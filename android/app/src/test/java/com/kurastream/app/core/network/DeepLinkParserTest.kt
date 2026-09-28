package com.kurastream.app.core.network

import org.junit.Assert.*
import org.junit.Test

class DeepLinkParserTest {

    @Test
    fun `parse valid server deep link`() {
        val link = "kurastream://server?url=http%3A%2F%2F192.168.1.50%3A3000"
        val result = DeepLinkParser.parse(link)
        assertTrue(result is KuraDeepLink.ServerConnect)
        assertEquals("http://192.168.1.50:3000", (result as KuraDeepLink.ServerConnect).serverUrl)
    }

    @Test
    fun `parse valid show deep link`() {
        val link = "kurastream://show/frieren_beyond_journeys_end"
        val result = DeepLinkParser.parse(link)
        assertTrue(result is KuraDeepLink.ShowDetail)
        assertEquals("frieren_beyond_journeys_end", (result as KuraDeepLink.ShowDetail).showId)
    }

    @Test
    fun `parse valid episode deep link`() {
        val link = "kurastream://episode/frieren_s01e04"
        val result = DeepLinkParser.parse(link)
        assertTrue(result is KuraDeepLink.PlayEpisode)
        assertEquals("frieren_s01e04", (result as KuraDeepLink.PlayEpisode).episodeId)
    }

    @Test
    fun `parse valid watch party deep link`() {
        val link = "kurastream://party/ROOM8892"
        val result = DeepLinkParser.parse(link)
        assertTrue(result is KuraDeepLink.JoinWatchParty)
        assertEquals("ROOM8892", (result as KuraDeepLink.JoinWatchParty).roomCode)
    }

    @Test
    fun `reject malformed or unknown scheme deep links`() {
        assertEquals(KuraDeepLink.Invalid, DeepLinkParser.parse(null))
        assertEquals(KuraDeepLink.Invalid, DeepLinkParser.parse(""))
        assertEquals(KuraDeepLink.Invalid, DeepLinkParser.parse("   "))
        assertEquals(KuraDeepLink.Invalid, DeepLinkParser.parse("https://google.com"))
        assertEquals(KuraDeepLink.Invalid, DeepLinkParser.parse("kurastream://unknown/path"))
    }
}
