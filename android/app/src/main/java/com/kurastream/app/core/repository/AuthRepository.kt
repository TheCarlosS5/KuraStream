package com.kurastream.app.core.repository

import com.kurastream.app.core.model.Profile
import com.kurastream.app.core.model.User
import com.kurastream.app.core.network.KuraApiService
import com.kurastream.app.core.network.dto.LoginRequestDto
import com.kurastream.app.core.network.dto.ProfileDto
import com.kurastream.app.core.network.dto.RegisterRequestDto
import com.kurastream.app.core.network.dto.SelectProfileRequestDto
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.security.TokenStorage

class AuthRepository(
    private val apiService: KuraApiService,
    private val tokenStorage: TokenStorage,
    private val preferencesDataSource: KuraPreferencesDataSource
) {
    suspend fun login(username: String, password: String): Result<User> {
        return try {
            val response = apiService.login(LoginRequestDto(username, password))
            if (response.success && !response.token.isNullOrBlank()) {
                tokenStorage.saveToken(response.token)
                val user = User(
                    username = response.username.ifBlank { username },
                    role = response.role
                )
                preferencesDataSource.setActiveUser(user.username)
                Result.success(user)
            } else {
                Result.failure(Exception(response.error ?: "Error de autenticación"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun register(username: String, password: String): Result<User> {
        return try {
            val response = apiService.register(RegisterRequestDto(username, password))
            if (response.success && !response.token.isNullOrBlank()) {
                tokenStorage.saveToken(response.token)
                val user = User(
                    username = response.username.ifBlank { username },
                    role = response.role
                )
                preferencesDataSource.setActiveUser(user.username)
                Result.success(user)
            } else {
                Result.failure(Exception(response.error ?: "Error al registrar usuario"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getProfiles(): Result<List<Profile>> {
        return try {
            val response = apiService.getProfiles()
            if (response.success) {
                val list = response.profiles.map { it.toModel() }
                Result.success(list)
            } else {
                Result.failure(Exception(response.error ?: "Error cargando perfiles"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun selectProfile(profileId: String, pin: String? = null): Result<Profile> {
        return try {
            val response = apiService.selectProfile(SelectProfileRequestDto(profileId, pin))
            if (response.success && !response.token.isNullOrBlank() && response.profile != null) {
                // ATOMIC REPLACEMENT: Overwrite existing token with new profile-bound token
                tokenStorage.saveToken(response.token)
                val profile = response.profile.toModel()
                preferencesDataSource.setActiveProfile(
                    profileId = profile.id,
                    profileName = profile.name,
                    isKids = profile.isKids
                )
                Result.success(profile)
            } else {
                Result.failure(Exception(response.error ?: "PIN o perfil incorrecto"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun logout(): Result<Unit> {
        return try {
            try {
                apiService.logout()
            } catch (_: Exception) {}

            tokenStorage.clearToken()
            preferencesDataSource.clearSession()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private fun ProfileDto.toModel(): Profile = Profile(
        id = id,
        username = username,
        name = profileName ?: name,
        color = avatarColor ?: color ?: "#818CF8",
        avatarColor = avatarColor ?: color ?: "#818CF8",
        isKids = isKids,
        hasPin = hasPin
    )
}
