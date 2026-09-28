package com.kurastream.app.feature.profiles

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.kurastream.app.R
import com.kurastream.app.core.designsystem.component.KuraButton
import com.kurastream.app.core.designsystem.component.KuraOutlinedButton
import com.kurastream.app.core.designsystem.theme.*
import com.kurastream.app.core.model.Profile

@Composable
fun ProfilePinDialog(
    profile: Profile,
    pinInput: String,
    errorMessage: String?,
    onPinChanged: (String) -> Unit,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(KuraDimens.Space4),
            shape = KuraShapes.Modal,
            color = KuraColors.Surface,
            border = androidx.compose.foundation.BorderStroke(1.dp, KuraColors.BorderStrong),
            tonalElevation = 8.dp
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(KuraDimens.Space6),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = "Perfil Protegido",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = KuraColors.TextMain
                )
                Spacer(modifier = Modifier.height(KuraDimens.Space2))
                Text(
                    text = "Ingresa el PIN de 4 dígitos para acceder al perfil de ${profile.name}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = KuraColors.TextSecondary,
                    textAlign = TextAlign.Center
                )

                Spacer(modifier = Modifier.height(KuraDimens.Space6))

                OutlinedTextField(
                    value = pinInput,
                    onValueChange = onPinChanged,
                    modifier = Modifier.width(180.dp),
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.NumberPassword,
                        imeAction = ImeAction.Done
                    ),
                    keyboardActions = KeyboardActions(onDone = { onConfirm() }),
                    singleLine = true,
                    textStyle = MaterialTheme.typography.titleLarge.copy(textAlign = TextAlign.Center),
                    shape = KuraShapes.Control,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = KuraColors.Primary,
                        unfocusedBorderColor = KuraColors.Border,
                        focusedTextColor = KuraColors.TextMain,
                        unfocusedTextColor = KuraColors.TextMain,
                        focusedContainerColor = KuraColors.SurfaceRaised,
                        unfocusedContainerColor = KuraColors.SurfaceRaised
                    )
                )

                if (errorMessage != null) {
                    Spacer(modifier = Modifier.height(KuraDimens.Space2))
                    Text(
                        text = errorMessage,
                        style = MaterialTheme.typography.bodyMedium,
                        color = KuraColors.Danger,
                        textAlign = TextAlign.Center
                    )
                }

                Spacer(modifier = Modifier.height(KuraDimens.Space6))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space3)
                ) {
                    KuraOutlinedButton(
                        onClick = onDismiss,
                        modifier = Modifier.weight(1f),
                        text = "Cancelar"
                    )
                    KuraButton(
                        onClick = onConfirm,
                        modifier = Modifier.weight(1f),
                        enabled = pinInput.isNotBlank(),
                        text = "Entrar"
                    )
                }
            }
        }
    }
}
