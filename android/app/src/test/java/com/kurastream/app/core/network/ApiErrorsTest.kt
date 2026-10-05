package com.kurastream.app.core.network

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

class ApiErrorsTest {

    private fun httpError(code: Int, body: String): HttpException =
        HttpException(Response.error<Any>(code, body.toResponseBody("application/json".toMediaType())))

    @Test
    fun `server error message from json body is surfaced`() {
        val mapped = httpError(403, """{"error":"PIN incorrecto"}""").toUserFacingError()
        assertTrue(mapped is UserFacingException)
        assertEquals("PIN incorrecto", mapped.message)
    }

    @Test
    fun `non json body falls back to status based message`() {
        val mapped = httpError(502, "<html>Bad Gateway</html>").toUserFacingError()
        assertEquals("El servidor tuvo un problema (502). Inténtalo más tarde.", mapped.message)
    }

    @Test
    fun `network failure gets a connectivity message`() {
        val mapped = IOException("reset").toUserFacingError()
        assertEquals("No se pudo conectar con el servidor. Comprueba tu conexión.", mapped.message)
    }

    @Test
    fun `already mapped errors are not wrapped twice`() {
        val original = UserFacingException("x")
        assertTrue(original.toUserFacingError() === original)
    }
}
