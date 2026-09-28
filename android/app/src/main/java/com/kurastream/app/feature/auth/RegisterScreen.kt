package com.kurastream.app.feature.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import com.kurastream.app.R
import com.kurastream.app.core.designsystem.component.KuraButton
import com.kurastream.app.core.designsystem.component.KuraTopBar
import com.kurastream.app.core.designsystem.theme.*
import com.kurastream.app.core.model.User

@Composable
fun RegisterScreen(
    viewModel: AuthViewModel,
    onRegisterSuccess: (User) -> Unit,
    onNavigateToLogin: () -> Unit
) {
    val state by viewModel.uiState.collectAsState()
    val focusManager = LocalFocusManager.current
    var passwordVisible by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            KuraTopBar(title = stringResource(R.string.register))
        },
        containerColor = KuraColors.Background
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = KuraDimens.Space5),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = "Crear Cuenta",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = KuraColors.TextMain
            )
            Spacer(modifier = Modifier.height(KuraDimens.Space2))
            Text(
                text = "Regístrate en tu servidor KuraStream",
                style = MaterialTheme.typography.bodyMedium,
                color = KuraColors.TextSecondary
            )

            Spacer(modifier = Modifier.height(KuraDimens.Space8))

            OutlinedTextField(
                value = state.usernameInput,
                onValueChange = viewModel::onUsernameChanged,
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.username)) },
                supportingText = { Text("Entre 3 y 64 caracteres", color = KuraColors.TextMuted) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Text,
                    imeAction = ImeAction.Next
                ),
                shape = KuraShapes.Control,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = KuraColors.Primary,
                    unfocusedBorderColor = KuraColors.Border,
                    focusedTextColor = KuraColors.TextMain,
                    unfocusedTextColor = KuraColors.TextMain,
                    focusedContainerColor = KuraColors.Surface,
                    unfocusedContainerColor = KuraColors.Surface
                )
            )

            Spacer(modifier = Modifier.height(KuraDimens.Space4))

            OutlinedTextField(
                value = state.passwordInput,
                onValueChange = viewModel::onPasswordChanged,
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.password)) },
                supportingText = { Text("Mínimo 8 caracteres", color = KuraColors.TextMuted) },
                singleLine = true,
                visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done
                ),
                keyboardActions = KeyboardActions(
                    onDone = {
                        focusManager.clearFocus()
                        viewModel.register(onRegisterSuccess)
                    }
                ),
                trailingIcon = {
                    val icon = if (passwordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility
                    IconButton(onClick = { passwordVisible = !passwordVisible }) {
                        Icon(imageVector = icon, contentDescription = null, tint = KuraColors.TextSecondary)
                    }
                },
                shape = KuraShapes.Control,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = KuraColors.Primary,
                    unfocusedBorderColor = KuraColors.Border,
                    focusedTextColor = KuraColors.TextMain,
                    unfocusedTextColor = KuraColors.TextMain,
                    focusedContainerColor = KuraColors.Surface,
                    unfocusedContainerColor = KuraColors.Surface
                )
            )

            if (state.errorMessage != null) {
                Spacer(modifier = Modifier.height(KuraDimens.Space3))
                Text(
                    text = state.errorMessage!!,
                    style = MaterialTheme.typography.bodyMedium,
                    color = KuraColors.Danger,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            Spacer(modifier = Modifier.height(KuraDimens.Space6))

            KuraButton(
                onClick = { viewModel.register(onRegisterSuccess) },
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.isLoading && state.usernameInput.isNotBlank() && state.passwordInput.isNotBlank(),
                text = if (state.isLoading) "Creando cuenta…" else stringResource(R.string.register)
            )

            Spacer(modifier = Modifier.height(KuraDimens.Space4))

            TextButton(onClick = onNavigateToLogin) {
                Text(
                    text = stringResource(R.string.have_account),
                    style = MaterialTheme.typography.bodyMedium,
                    color = KuraColors.Primary
                )
            }
        }
    }
}
