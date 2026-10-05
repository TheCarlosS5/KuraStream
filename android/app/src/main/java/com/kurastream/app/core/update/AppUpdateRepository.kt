package com.kurastream.app.core.update

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.kurastream.app.core.network.KuraApiService
import com.kurastream.app.core.network.ServerUrlResolver
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest

/** A newer build the server offers (see GET /api/app/android). */
data class AppUpdate(
    val versionName: String,
    val versionCode: Int,
    val notes: String?,
    val sha256: String,
    val sizeBytes: Long,
    val downloadUrl: String
)

sealed interface UpdateDownload {
    data class Progress(val percent: Int) : UpdateDownload
    data class Ready(val file: File) : UpdateDownload
    data class Failed(val message: String) : UpdateDownload
}

/**
 * Updates straight from the user's own server: there is no store on a LAN. The APK is only handed to the system
 * installer after its SHA-256 matches what the server announced, so a truncated download is never installed.
 */
class AppUpdateRepository(
    private val context: Context,
    private val apiService: KuraApiService,
    private val downloadClient: OkHttpClient,
    private val currentVersionCode: Int
) {

    /** Null when the server has no app, it is not newer, or the server cannot be reached. */
    suspend fun checkForUpdate(): AppUpdate? {
        val info = try {
            apiService.getAppInfo()
        } catch (_: Exception) {
            return null
        }
        return info.toUpdate(currentVersionCode)
    }

    fun download(update: AppUpdate, baseUrl: String): Flow<UpdateDownload> = flow {
        val dir = File(context.cacheDir, UPDATES_DIR).apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }   // never keep an older download around
        val target = File(dir, "KuraStream-${update.versionCode}.apk")
        val url = ServerUrlResolver.buildMediaUrl(baseUrl, update.downloadUrl)
        try {
            downloadClient.newCall(Request.Builder().url(url).build()).execute().use { response ->
                if (!response.isSuccessful) {
                    emit(UpdateDownload.Failed("El servidor respondió ${response.code}"))
                    return@flow
                }
                val body = response.body ?: run {
                    emit(UpdateDownload.Failed("Descarga vacía"))
                    return@flow
                }
                val total = body.contentLength().takeIf { it > 0 } ?: update.sizeBytes
                val digest = MessageDigest.getInstance("SHA-256")
                var received = 0L
                var lastPercent = -1
                body.byteStream().use { input ->
                    target.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buffer)
                            if (n < 0) break
                            output.write(buffer, 0, n)
                            digest.update(buffer, 0, n)
                            received += n
                            val percent = if (total > 0) ((received * 100) / total).toInt().coerceIn(0, 100) else 0
                            if (percent != lastPercent) {
                                lastPercent = percent
                                emit(UpdateDownload.Progress(percent))
                            }
                        }
                    }
                }
                val actual = digest.digest().joinToString("") { "%02x".format(it) }
                if (!actual.equals(update.sha256, ignoreCase = true)) {
                    target.delete()
                    emit(UpdateDownload.Failed("El archivo descargado no coincide con el del servidor. Inténtalo de nuevo."))
                    return@flow
                }
            }
            emit(UpdateDownload.Ready(target))
        } catch (e: Exception) {
            target.delete()
            emit(UpdateDownload.Failed("No se pudo descargar la actualización: ${e.message ?: "error de red"}"))
        }
    }.flowOn(Dispatchers.IO)

    /** Intent for the system package installer (the user confirms there). */
    fun installIntent(file: File): Intent {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
        return Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    }

    companion object {
        const val UPDATES_DIR = "updates"
    }
}
