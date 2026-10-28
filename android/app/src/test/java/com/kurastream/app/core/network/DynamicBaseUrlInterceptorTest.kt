package com.kurastream.app.core.network

import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import okhttp3.Interceptor
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DynamicBaseUrlInterceptorTest {

    private fun requestSentFor(
        base: String,
        requestUrl: String,
        headers: Map<String, String> = emptyMap()
    ): Request {
        val sent = slot<Request>()
        val chain = mockk<Interceptor.Chain>()
        val reqBuilder = Request.Builder().url(requestUrl)
        headers.forEach { (k, v) -> reqBuilder.header(k, v) }
        every { chain.request() } returns reqBuilder.build()
        every { chain.proceed(capture(sent)) } answers {
            Response.Builder().request(sent.captured).protocol(Protocol.HTTP_1_1).code(200).message("OK").build()
        }
        DynamicBaseUrlInterceptor { base }.intercept(chain)
        return sent.captured
    }

    private fun urlSentFor(
        base: String,
        requestUrl: String,
        headers: Map<String, String> = emptyMap()
    ): String = requestSentFor(base, requestUrl, headers).url.toString()

    @Test
    fun `root install keeps the path`() {
        assertEquals(
            "http://10.42.0.1:3000/api/shows",
            urlSentFor("http://10.42.0.1:3000/", "http://placeholder/api/shows")
        )
    }

    @Test
    fun `relative retrofit path with kura base gets prefixed`() {
        assertEquals(
            "http://home.lan:8080/kura/api/shows",
            urlSentFor("http://home.lan:8080/kura", "http://placeholder/api/shows")
        )
    }

    @Test
    fun `relative retrofit path with api base gets prefixed`() {
        assertEquals(
            "http://home.lan:8080/api/api/shows",
            urlSentFor("http://home.lan:8080/api", "http://placeholder/api/shows")
        )
    }

    @Test
    fun `absolute url with X-Absolute-Url header keeps path and strips header`() {
        val reqKura = requestSentFor(
            "http://home.lan:8080/kura",
            "http://home.lan:8080/kura/api/party/stream?room_id=ABC&last_msg_id=0",
            mapOf("X-Absolute-Url" to "1")
        )
        assertEquals(
            "http://home.lan:8080/kura/api/party/stream?room_id=ABC&last_msg_id=0",
            reqKura.url.toString()
        )
        assertNull(reqKura.header("X-Absolute-Url"))

        val reqApi = requestSentFor(
            "http://home.lan:8080/api",
            "http://home.lan:8080/api/party/poll?room_id=ABC",
            mapOf("X-Absolute-Url" to "1")
        )
        assertEquals(
            "http://home.lan:8080/api/party/poll?room_id=ABC",
            reqApi.url.toString()
        )
        assertNull(reqApi.header("X-Absolute-Url"))
    }
}
