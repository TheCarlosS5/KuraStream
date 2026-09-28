package com.kurastream.app.core.repository

import com.kurastream.app.core.database.ServerProfileDao
import com.kurastream.app.core.database.ServerProfileEntity
import com.kurastream.app.core.model.ServerProfile
import com.kurastream.app.core.network.KuraApiService
import com.kurastream.app.core.network.ServerUrlResolver
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.util.UUID

class ServerRepository(
    private val serverDao: ServerProfileDao,
    private val preferencesDataSource: KuraPreferencesDataSource,
    private val apiService: KuraApiService
) {
    val serversFlow: Flow<List<ServerProfile>> = serverDao.getAllServers().map { entities ->
        entities.map { it.toModel() }
    }

    suspend fun testConnection(baseUrl: String): Result<String> {
        return try {
            val health = apiService.getHealth()
            if (health.success && health.status == "healthy") {
                Result.success("Conexión exitosa (PHP ${health.phpVersion})")
            } else {
                Result.failure(Exception("Servidor degradado: ${health.database}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun saveAndSelectServer(urlInput: String, displayName: String? = null): Result<ServerProfile> {
        val validation = ServerUrlResolver.validateAndNormalize(urlInput)
        if (!validation.isValid) {
            return Result.failure(IllegalArgumentException(validation.errorMessage ?: "URL no válida"))
        }

        val normalized = validation.normalizedUrl
        val name = displayName?.ifBlank { null } ?: validation.normalizedUrl
            .removePrefix("https://")
            .removePrefix("http://")

        val existing = serverDao.getServerByUrl(normalized)
        val profile = if (existing != null) {
            existing.copy(lastConnected = System.currentTimeMillis())
        } else {
            ServerProfileEntity(
                id = UUID.randomUUID().toString(),
                displayName = name,
                baseUrl = normalized,
                isHttps = validation.isHttps,
                lastConnected = System.currentTimeMillis()
            )
        }

        serverDao.insertServer(profile)
        preferencesDataSource.setActiveServer(profile.id, profile.baseUrl)

        return Result.success(profile.toModel())
    }

    suspend fun deleteServer(id: String) {
        serverDao.deleteServer(id)
    }

    private fun ServerProfileEntity.toModel(): ServerProfile = ServerProfile(
        id = id,
        displayName = displayName,
        baseUrl = baseUrl,
        isHttps = isHttps,
        lastConnected = lastConnected,
        isDefault = isDefault,
        version = version
    )
}
