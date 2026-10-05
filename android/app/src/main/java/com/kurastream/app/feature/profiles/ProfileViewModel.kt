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

/** The profile being created (profile == null) or edited. */
data class ProfileEditorState(
    val profile: Profile? = null,
    val name: String = "",
    val color: String = PROFILE_COLORS.first(),
    val isKids: Boolean = false,
    /** "" (no cap), "G", "PG" or "PG-13". */
    val maxRating: String = "",
    /** Digits only; empty means no daily limit. */
    val dailyLimit: String = "",
    val newPin: String = "",
    val currentPin: String = "",
    val removePin: Boolean = false,
    val confirmDelete: Boolean = false,
    val isSaving: Boolean = false,
    val error: String? = null
) {
    val isNew: Boolean get() = profile == null
}

val PROFILE_COLORS = listOf("#818CF8", "#A855F7", "#EC4899", "#EF4444", "#F97316", "#EAB308", "#22C55E", "#06B6D4")

data class ProfileUiState(
    val state: UiState<List<Profile>> = UiState.Loading,
    val selectedProfilePendingPin: Profile? = null,
    val pinInput: String = "",
    val pinError: String? = null,
    val isSelecting: Boolean = false,
    val mediaBaseUrl: String = "",
    val manageMode: Boolean = false,
    val editor: ProfileEditorState? = null
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
        if (_uiState.value.manageMode) {
            startEditProfile(profile)
            return
        }
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

    fun toggleManageMode() {
        _uiState.value = _uiState.value.copy(manageMode = !_uiState.value.manageMode, editor = null)
    }

    fun startCreateProfile() {
        _uiState.value = _uiState.value.copy(editor = ProfileEditorState())
    }

    fun startEditProfile(profile: Profile) {
        _uiState.value = _uiState.value.copy(
            editor = ProfileEditorState(
                profile = profile,
                name = profile.name,
                color = profile.color.takeIf { c -> PROFILE_COLORS.any { it.equals(c, ignoreCase = true) } } ?: profile.color,
                isKids = profile.isKids,
                maxRating = profile.maxRating.orEmpty(),
                dailyLimit = profile.dailyLimitMinutes?.toString().orEmpty()
            )
        )
    }

    fun updateEditor(change: (ProfileEditorState) -> ProfileEditorState) {
        val current = _uiState.value.editor ?: return
        _uiState.value = _uiState.value.copy(editor = change(current).copy(error = null))
    }

    fun dismissEditor() {
        _uiState.value = _uiState.value.copy(editor = null)
    }

    /** PINs are 4 to 6 digits on the server; say so here instead of after a round trip. */
    private fun isValidPin(pin: String) = pin.length in 4..6 && pin.all { it.isDigit() }

    fun saveEditor() {
        val editor = _uiState.value.editor ?: return
        val name = editor.name.trim()
        if (name.isEmpty()) {
            updateEditor { it.copy(error = "Escribe un nombre para el perfil") }
            return
        }
        if (editor.newPin.isNotEmpty() && !isValidPin(editor.newPin)) {
            updateEditor { it.copy(error = "El PIN debe tener entre 4 y 6 dígitos") }
            return
        }
        val dailyLimit = editor.dailyLimit.toIntOrNull()
        if (editor.dailyLimit.isNotEmpty() && (dailyLimit == null || dailyLimit !in 15..1440)) {
            updateEditor { it.copy(error = "El tiempo de pantalla debe estar entre 15 y 1440 minutos") }
            return
        }
        val existing = editor.profile
        if (existing != null && existing.hasPin && editor.currentPin.isBlank()) {
            updateEditor { it.copy(error = "Escribe el PIN actual para modificar este perfil") }
            return
        }
        _uiState.value = _uiState.value.copy(editor = editor.copy(isSaving = true, error = null))
        viewModelScope.launch {
            val result = authRepository.saveProfile(
                name = name,
                color = editor.color,
                isKids = editor.isKids,
                pin = editor.newPin,
                id = existing?.id,
                avatar = existing?.avatar,
                currentPin = editor.currentPin,
                removePin = editor.removePin && editor.newPin.isEmpty(),
                maxRating = editor.maxRating,
                dailyLimitMinutes = dailyLimit
            )
            if (result.isSuccess) {
                _uiState.value = _uiState.value.copy(editor = null)
                loadProfiles()
            } else {
                _uiState.value = _uiState.value.copy(
                    editor = editor.copy(isSaving = false, error = result.exceptionOrNull()?.message ?: "No se pudo guardar")
                )
            }
        }
    }

    fun deleteEditorProfile() {
        val editor = _uiState.value.editor ?: return
        val profile = editor.profile ?: return
        if (!editor.confirmDelete) {
            updateEditor { it.copy(confirmDelete = true) }
            return
        }
        if (profile.hasPin && editor.currentPin.isBlank()) {
            updateEditor { it.copy(error = "Escribe el PIN actual para eliminar este perfil") }
            return
        }
        _uiState.value = _uiState.value.copy(editor = editor.copy(isSaving = true, error = null))
        viewModelScope.launch {
            val result = authRepository.deleteProfile(profile.id, editor.currentPin)
            if (result.isSuccess) {
                _uiState.value = _uiState.value.copy(editor = null)
                loadProfiles()
            } else {
                _uiState.value = _uiState.value.copy(
                    editor = editor.copy(isSaving = false, error = result.exceptionOrNull()?.message ?: "No se pudo eliminar")
                )
            }
        }
    }
}
