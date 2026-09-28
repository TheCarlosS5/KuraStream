package com.kurastream.app.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kurastream.app.core.model.User
import com.kurastream.app.core.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AuthUiState(
    val usernameInput: String = "",
    val passwordInput: String = "",
    val isLoading: Boolean = false,
    val errorMessage: String? = null
)

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    fun onUsernameChanged(newUsername: String) {
        _uiState.update { it.copy(usernameInput = newUsername, errorMessage = null) }
    }

    fun onPasswordChanged(newPassword: String) {
        _uiState.update { it.copy(passwordInput = newPassword, errorMessage = null) }
    }

    fun login(onSuccess: (User) -> Unit) {
        val state = _uiState.value
        if (state.usernameInput.isBlank() || state.passwordInput.isBlank()) {
            _uiState.update { it.copy(errorMessage = "Usuario y contraseña requeridos") }
            return
        }

        _uiState.update { it.copy(isLoading = true, errorMessage = null) }
        viewModelScope.launch {
            val result = authRepository.login(state.usernameInput.trim(), state.passwordInput)
            if (result.isSuccess) {
                _uiState.update { it.copy(isLoading = false) }
                onSuccess(result.getOrThrow())
            } else {
                val msg = result.exceptionOrNull()?.message ?: "Error al iniciar sesión"
                _uiState.update { it.copy(isLoading = false, errorMessage = msg) }
            }
        }
    }

    fun register(onSuccess: (User) -> Unit) {
        val state = _uiState.value
        if (state.usernameInput.isBlank() || state.passwordInput.isBlank()) {
            _uiState.update { it.copy(errorMessage = "Usuario y contraseña requeridos") }
            return
        }

        if (state.usernameInput.length < 3 || state.usernameInput.length > 64) {
            _uiState.update { it.copy(errorMessage = "El usuario debe tener entre 3 y 64 caracteres") }
            return
        }

        if (state.passwordInput.length < 8) {
            _uiState.update { it.copy(errorMessage = "La contraseña debe tener al menos 8 caracteres") }
            return
        }

        _uiState.update { it.copy(isLoading = true, errorMessage = null) }
        viewModelScope.launch {
            val result = authRepository.register(state.usernameInput.trim(), state.passwordInput)
            if (result.isSuccess) {
                _uiState.update { it.copy(isLoading = false) }
                onSuccess(result.getOrThrow())
            } else {
                val msg = result.exceptionOrNull()?.message ?: "Error al registrar la cuenta"
                _uiState.update { it.copy(isLoading = false, errorMessage = msg) }
            }
        }
    }
}
