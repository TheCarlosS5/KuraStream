package com.kurastream.app.feature.profiles

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kurastream.app.core.model.Profile
import com.kurastream.app.core.model.UiState
import com.kurastream.app.core.preferences.KuraPreferencesDataSource
import com.kurastream.app.core.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ProfileUiState(
    val state: UiState<List<Profile>> = UiState.Loading,
    val selectedProfilePendingPin: Profile? = null,
    val pinInput: String = "",
    val pinError: String? = null,
    val isSelecting: Boolean = false,
    val mediaBaseUrl: String = ""
)

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val preferencesDataSource: KuraPreferencesDataSource
) : ViewModel() {

    private val _uiState = MutableStateFlow(ProfileUiState())
    val uiState: StateFlow<ProfileUiState> = _uiState.asStateFlow()

    init {
        loadProfiles()
        // Profile photos are served from the active server's /library
        viewModelScope.launch {
            val baseUrl = preferencesDataSource.preferencesFlow.first().activeServerUrl.orEmpty()
            _uiState.value = _uiState.value.copy(mediaBaseUrl = baseUrl)
        }
    }

    fun loadProfiles() {
        _uiState.value = _uiState.value.copy(state = UiState.Loading)
        viewModelScope.launch {
            val result = authRepository.getProfiles()
            if (result.isSuccess) {
                val profiles = result.getOrThrow()
                if (profiles.isEmpty()) {
                    _uiState.value = _uiState.value.copy(state = UiState.Empty("No se encontraron perfiles"))
                } else {
                    _uiState.value = _uiState.value.copy(state = UiState.Content(profiles))
                }
            } else {
                _uiState.value = _uiState.value.copy(
                    state = UiState.Error(result.exceptionOrNull()?.message ?: "Error cargando perfiles")
                )
            }
        }
    }

    fun onProfileClicked(profile: Profile, onSelected: (Profile) -> Unit) {
        if (profile.hasPin) {
            _uiState.value = _uiState.value.copy(
                selectedProfilePendingPin = profile,
                pinInput = "",
                pinError = null
            )
        } else {
            selectProfileDirectly(profile, null, onSelected)
        }
    }

    fun onPinChanged(newPin: String) {
        if (newPin.length <= 8) {
            _uiState.value = _uiState.value.copy(pinInput = newPin, pinError = null)
        }
    }

    fun confirmPin(onSelected: (Profile) -> Unit) {
        val pending = _uiState.value.selectedProfilePendingPin ?: return
        val pin = _uiState.value.pinInput
        if (pin.isBlank()) {
            _uiState.value = _uiState.value.copy(pinError = "Por favor ingresa el PIN")
            return
        }

        selectProfileDirectly(pending, pin, onSelected)
    }

    fun dismissPinDialog() {
        _uiState.value = _uiState.value.copy(selectedProfilePendingPin = null, pinInput = "", pinError = null)
    }

    private fun selectProfileDirectly(profile: Profile, pin: String?, onSelected: (Profile) -> Unit) {
        _uiState.value = _uiState.value.copy(isSelecting = true)
        viewModelScope.launch {
            val result = authRepository.selectProfile(profile.id, pin)
            if (result.isSuccess) {
                val selected = result.getOrThrow()
                _uiState.value = _uiState.value.copy(isSelecting = false, selectedProfilePendingPin = null)
                onSelected(selected)
            } else {
                _uiState.value = _uiState.value.copy(
                    isSelecting = false,
                    pinError = result.exceptionOrNull()?.message ?: "PIN incorrecto"
                )
            }
        }
    }
}
