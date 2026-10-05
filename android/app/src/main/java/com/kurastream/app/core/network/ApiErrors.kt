package com.kurastream.app.core.network

import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import retrofit2.HttpException
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** Failure whose [message] is safe and meaningful to show to the user (Spanish, no stack noise). */
class UserFacingException(message: String, cause: Throwable? = null) : Exception(message, cause)

private val errorJson = Json { ignoreUnknownKeys = true; isLenient = true }

/**
 * Maps transport/HTTP failures to what the user should read. The PHP backend answers errors as
 * `{"error": "..."}` with a Spanish message, which is far more useful than Retrofit's "HTTP 403".
 */
fun Throwable.toUserFacingError(): Throwable {
    if (this is CancellationException || this is UserFacingException) return this
    val message = when (this) {
        is HttpException -> serverErrorMessage(this) ?: when (code()) {
            401 -> "Tu sesión expiró. Vuelve a iniciar sesión."
            403 -> "No tienes permiso para realizar esta acción."
            404 -> "El recurso solicitado no existe en el servidor."
            429 -> "Demasiadas solicitudes. Espera un momento e inténtalo de nuevo."
            in 500..599 -> "El servidor tuvo un problema (${code()}). Inténtalo más tarde."
            else -> "Error del servidor (${code()})."
        }
        is UnknownHostException -> "No se encontró el servidor. Revisa la dirección configurada."
        is SocketTimeoutException -> "El servidor tardó demasiado en responder."
        is IOException -> "No se pudo conectar con el servidor. Comprueba tu conexión."
        is SerializationException, is IllegalArgumentException -> "El servidor devolvió una respuesta inesperada."
        else -> message ?: "Error inesperado."
    }
    return UserFacingException(message, this)
}

private fun serverErrorMessage(e: HttpException): String? {
    return try {
        val body = e.response()?.errorBody()?.string()?.takeIf { it.isNotBlank() } ?: return null
        val obj = errorJson.parseToJsonElement(body).jsonObject
        (obj["error"] ?: obj["message"])?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }
    } catch (_: Exception) {
        null
    }
}
