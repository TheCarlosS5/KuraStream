package com.kurastream.app.feature.server

import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kurastream.app.core.model.ServerProfile
import com.kurastream.app.core.network.ServerUrlResolver
import com.kurastream.app.core.network.ServerUrlValidationResult
import com.kurastream.app.core.repository.ServerRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ServerSetupUiState(
    val urlInput: String = "",
    val validation: ServerUrlValidationResult? = null,
    val isTesting: Boolean = false,
    val errorMessage: String? = null,
    val successMessage: String? = null,
    val recentServers: List<ServerProfile> = emptyList(),
    val showLocalNetworkPermissionDialog: Boolean = false
)

@HiltViewModel
class ServerSetupViewModel @Inject constructor(
    private val serverRepository: ServerRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ServerSetupUiState())
    val uiState: StateFlow<ServerSetupUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            serverRepository.serversFlow.collect { servers ->
                _uiState.update { it.copy(recentServers = servers) }
            }
        }
    }

    fun onUrlChanged(newUrl: String) {
        val validation = if (newUrl.isNotBlank()) ServerUrlResolver.validateAndNormalize(newUrl) else null
        _uiState.update {
            it.copy(
                urlInput = newUrl,
                validation = validation,
                errorMessage = null,
                successMessage = null
            )
        }
    }

    fun connectServer(
        isLocalNetworkPermissionGranted: Boolean = false,
        onSuccess: (ServerProfile) -> Unit
    ) {
        val currentInput = _uiState.value.urlInput
        val validation = ServerUrlResolver.validateAndNormalize(currentInput)
        if (!validation.isValid) {
            _uiState.update { it.copy(errorMessage = validation.errorMessage ?: "URL no válida") }
            return
        }

        // On Android 17+ (API 37), prompt contextually for local network access before testing connection
        if (validation.isLocalNetwork && !isLocalNetworkPermissionGranted && Build.VERSION.SDK_INT >= 37) {
            _uiState.update { it.copy(showLocalNetworkPermissionDialog = true) }
            return
        }

        _uiState.update { it.copy(isTesting = true, errorMessage = null, successMessage = null) }

        viewModelScope.launch {
            val testResult = serverRepository.testConnection(validation.normalizedUrl)
            if (testResult.isSuccess) {
                val saveResult = serverRepository.saveAndSelectServer(validation.normalizedUrl)
                if (saveResult.isSuccess) {
                    val server = saveResult.getOrThrow()
                    _uiState.update { it.copy(isTesting = false, successMessage = testResult.getOrThrow()) }
                    onSuccess(server)
                } else {
                    _uiState.update {
                        it.copy(isTesting = false, errorMessage = saveResult.exceptionOrNull()?.message)
                    }
                }
            } else {
                val ex = testResult.exceptionOrNull()
                val message = when {
                    ex?.message?.contains("Failed to connect", ignoreCase = true) == true ->
                        "Conexión rechazada. Comprueba que KuraStream esté ejecutándose y el puerto sea correcto."
                    ex?.message?.contains("timeout", ignoreCase = true) == true ->
                        "Tiempo de espera agotado. Verifica la red o la dirección IP del servidor."
                    ex?.message?.contains("SSL", ignoreCase = true) == true ->
                        "Error de certificado SSL/TLS. Comprueba la configuración segura del servidor."
                    else -> ex?.message ?: "No fue posible comunicarse con KuraStream en esta dirección."
                }
                _uiState.update { it.copy(isTesting = false, errorMessage = message) }
            }
        }
    }

    fun onLocalNetworkPermissionResult(granted: Boolean, onSuccess: (ServerProfile) -> Unit) {
        _uiState.update { it.copy(showLocalNetworkPermissionDialog = false) }
        if (granted) {
            connectServer(isLocalNetworkPermissionGranted = true, onSuccess = onSuccess)
        } else {
            _uiState.update {
                it.copy(
                    isTesting = false,
                    errorMessage = "Se denegó el permiso de red local. KuraStream no puede acceder al servidor multimedia en la red local sin este permiso."
                )
            }
        }
    }

    fun dismissLocalNetworkDialog() {
        _uiState.update { it.copy(showLocalNetworkPermissionDialog = false) }
    }

    fun selectRecentServer(server: ServerProfile, onSuccess: (ServerProfile) -> Unit) {
        onUrlChanged(server.baseUrl)
        connectServer(isLocalNetworkPermissionGranted = true, onSuccess = onSuccess)
    }

    fun deleteRecentServer(id: String) {
        viewModelScope.launch {
            serverRepository.deleteServer(id)
        }
    }
}
