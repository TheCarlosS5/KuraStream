package com.kurastream.app.feature.server

import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kurastream.app.core.model.ServerProfile
import com.kurastream.app.core.network.ServerUrlResolver
import com.kurastream.app.core.network.ServerUrlValidationResult
import com.kurastream.app.core.repository.ServerRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.TimeUnit
import javax.inject.Inject

data class ServerSetupUiState(
    val urlInput: String = "",
    val validation: ServerUrlValidationResult? = null,
    val isTesting: Boolean = false,
    val isScanningLan: Boolean = false,
    val errorMessage: String? = null,
    val successMessage: String? = null,
    val recentServers: List<ServerProfile> = emptyList(),
    val showLocalNetworkPermissionDialog: Boolean = false
)

@HiltViewModel
class ServerSetupViewModel @Inject constructor(
    private val serverRepository: ServerRepository,
    savedStateHandle: androidx.lifecycle.SavedStateHandle
) : ViewModel() {

    private val _uiState = MutableStateFlow(ServerSetupUiState())
    val uiState: StateFlow<ServerSetupUiState> = _uiState.asStateFlow()

    init {
        val initialUrl = savedStateHandle.get<String>("serverUrl") ?: savedStateHandle.get<String>("url")
        if (!initialUrl.isNullOrBlank()) {
            onUrlChanged(initialUrl)
        }

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

    private var lanScanJob: Job? = null
    private var pendingDiscoveryAfterPermission: Boolean = false

    fun onLocalNetworkPermissionResult(granted: Boolean, onSuccess: (ServerProfile) -> Unit) {
        _uiState.update { it.copy(showLocalNetworkPermissionDialog = false) }
        if (pendingDiscoveryAfterPermission) {
            pendingDiscoveryAfterPermission = false
            if (granted) {
                startLanDiscovery(isLocalNetworkPermissionGranted = true)
            } else {
                _uiState.update {
                    it.copy(
                        isScanningLan = false,
                        errorMessage = "Se requiere permiso de red local para descubrir servidores KuraStream en tu Wi-Fi/LAN."
                    )
                }
            }
            return
        }

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

    private fun getLocalSubnetPrefix(): String? {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces() ?: return null
            for (iface in interfaces) {
                if (iface.isLoopback || !iface.isUp) continue
                for (addr in iface.inetAddresses) {
                    if (addr is Inet4Address && !addr.isLoopbackAddress && addr.isSiteLocalAddress) {
                        val host = addr.hostAddress ?: continue
                        val parts = host.split(".")
                        if (parts.size == 4) {
                            return "${parts[0]}.${parts[1]}.${parts[2]}."
                        }
                    }
                }
            }
        } catch (_: Exception) {}
        return null
    }

    fun startLanDiscovery(isLocalNetworkPermissionGranted: Boolean = false) {
        if (!isLocalNetworkPermissionGranted && Build.VERSION.SDK_INT >= 37) {
            pendingDiscoveryAfterPermission = true
            _uiState.update { it.copy(showLocalNetworkPermissionDialog = true) }
            return
        }

        lanScanJob?.cancel()
        _uiState.update {
            it.copy(
                isScanningLan = true,
                errorMessage = null,
                successMessage = null
            )
        }

        lanScanJob = viewModelScope.launch(Dispatchers.IO) {
            val prefix = getLocalSubnetPrefix() ?: "192.168.1."
            val ports = listOf(3000, 8080, 80)
            val client = okhttp3.OkHttpClient.Builder()
                .connectTimeout(600, TimeUnit.MILLISECONDS)
                .readTimeout(800, TimeUnit.MILLISECONDS)
                .build()

            var foundUrl: String? = null
            val semaphore = Semaphore(25)
            val targets = (1..254).flatMap { host ->
                ports.map { port -> "$prefix$host:$port" }
            }

            coroutineScope {
                for (target in targets) {
                    if (foundUrl != null || !isActive) break
                    launch {
                        semaphore.withPermit {
                            if (foundUrl != null || !isActive) return@withPermit
                            val url = "http://$target/api/health"
                            try {
                                val req = okhttp3.Request.Builder().url(url).get().build()
                                client.newCall(req).execute().use { resp ->
                                    if (resp.isSuccessful) {
                                        val body = resp.body?.string() ?: ""
                                        if (body.contains("healthy") || body.contains("kurastream", ignoreCase = true) || body.contains("success")) {
                                            foundUrl = "http://$target"
                                        }
                                    }
                                }
                            } catch (_: Exception) {}
                        }
                    }
                }
            }

            val result = foundUrl
            withContext(Dispatchers.Main) {
                if (result != null) {
                    onUrlChanged(result)
                    _uiState.update {
                        it.copy(
                            isScanningLan = false,
                            successMessage = "¡Servidor KuraStream encontrado en $result!"
                        )
                    }
                } else {
                    _uiState.update {
                        it.copy(
                            isScanningLan = false,
                            errorMessage = "No se detectó ningún servidor KuraStream activo en la red local (subred $prefix*). Puedes ingresarlo manualmente."
                        )
                    }
                }
            }
        }
    }

    fun cancelLanDiscovery() {
        lanScanJob?.cancel()
        lanScanJob = null
        _uiState.update { it.copy(isScanningLan = false) }
    }

    fun dismissLocalNetworkDialog() {
        _uiState.update { it.copy(showLocalNetworkPermissionDialog = false) }
    }

    fun selectRecentServer(
        server: ServerProfile,
        isLocalNetworkPermissionGranted: Boolean = false,
        onSuccess: (ServerProfile) -> Unit
    ) {
        onUrlChanged(server.baseUrl)
        connectServer(isLocalNetworkPermissionGranted = isLocalNetworkPermissionGranted, onSuccess = onSuccess)
    }

    fun deleteRecentServer(id: String) {
        viewModelScope.launch {
            serverRepository.deleteServer(id)
        }
    }
}
