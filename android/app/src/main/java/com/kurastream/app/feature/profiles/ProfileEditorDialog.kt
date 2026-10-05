package com.kurastream.app.feature.profiles

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.kurastream.app.core.designsystem.theme.*

private fun parseColor(hex: String): Color = try {
    Color(android.graphics.Color.parseColor(hex))
} catch (_: Exception) {
    KuraColors.Primary
}

/** Create or edit a profile: name, colour, kids mode, PIN, and (for existing ones) delete. */
@Composable
fun ProfileEditorDialog(
    state: ProfileEditorState,
    onChange: ((ProfileEditorState) -> ProfileEditorState) -> Unit,
    onSave: () -> Unit,
    onDelete: () -> Unit,
    onDismiss: () -> Unit
) {
    val existing = state.profile
    val needsCurrentPin = existing != null && existing.hasPin
    val canDelete = existing != null && existing.name != "Principal"

    Dialog(onDismissRequest = { if (!state.isSaving) onDismiss() }) {
        Surface(
            modifier = Modifier.fillMaxWidth().padding(KuraDimens.Space4),
            shape = KuraShapes.Modal,
            color = KuraColors.Surface,
            border = BorderStroke(1.dp, KuraColors.BorderStrong),
            tonalElevation = 8.dp
        ) {
            Column(
                modifier = Modifier
                    .verticalScroll(rememberScrollState())
                    .padding(KuraDimens.Space6),
                verticalArrangement = Arrangement.spacedBy(KuraDimens.Space3)
            ) {
                Text(
                    text = if (state.isNew) "Nuevo perfil" else "Editar perfil",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = KuraColors.TextMain
                )

                OutlinedTextField(
                    value = state.name,
                    onValueChange = { v -> if (v.length <= 64) onChange { it.copy(name = v) } },
                    label = { Text("Nombre") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                Text("Color", style = MaterialTheme.typography.labelLarge, color = KuraColors.TextSecondary)
                FlowRowSwatches(selected = state.color, onSelect = { c -> onChange { it.copy(color = c) } })

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Perfil infantil", color = KuraColors.TextMain)
                        Text("Solo muestra contenido apto para niños", style = MaterialTheme.typography.bodySmall, color = KuraColors.TextSecondary)
                    }
                    Switch(checked = state.isKids, onCheckedChange = { v -> onChange { it.copy(isKids = v) } })
                }

                Text("Clasificación máxima", style = MaterialTheme.typography.labelLarge, color = KuraColors.TextSecondary)
                Row(horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space2)) {
                    listOf("" to "Sin límite", "G" to "G", "PG" to "PG", "PG-13" to "PG-13").forEach { (value, label) ->
                        FilterChip(
                            selected = state.maxRating == value,
                            onClick = { onChange { it.copy(maxRating = value) } },
                            label = { Text(label) }
                        )
                    }
                }
                OutlinedTextField(
                    value = state.dailyLimit,
                    onValueChange = { v -> if (v.length <= 4 && v.all { it.isDigit() }) onChange { it.copy(dailyLimit = v) } },
                    label = { Text("Tiempo de pantalla al día (minutos)") },
                    supportingText = { Text("Vacío = sin límite. Mínimo 15.") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth()
                )

                if (needsCurrentPin) {
                    PinField("PIN actual", state.currentPin) { v -> onChange { it.copy(currentPin = v) } }
                }
                if (!state.removePin) {
                    PinField(
                        label = if (needsCurrentPin) "PIN nuevo (opcional)" else "PIN (opcional, 4 a 6 dígitos)",
                        value = state.newPin
                    ) { v -> onChange { it.copy(newPin = v) } }
                }
                if (needsCurrentPin) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = state.removePin, onCheckedChange = { v -> onChange { it.copy(removePin = v, newPin = "") } })
                        Text("Quitar el PIN", color = KuraColors.TextMain)
                    }
                }

                state.error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                }

                Row(horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space3), modifier = Modifier.fillMaxWidth()) {
                    TextButton(onClick = onDismiss, enabled = !state.isSaving) { Text("Cancelar") }
                    Spacer(modifier = Modifier.weight(1f))
                    Button(onClick = onSave, enabled = !state.isSaving) { Text(if (state.isSaving) "Guardando…" else "Guardar") }
                }

                if (canDelete) {
                    HorizontalDivider(color = KuraColors.BorderStrong)
                    OutlinedButton(
                        onClick = onDelete,
                        enabled = !state.isSaving,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
                    ) {
                        Text(if (state.confirmDelete) "Pulsa de nuevo: se borra su historial y su lista" else "Eliminar perfil")
                    }
                }
            }
        }
    }
}

@Composable
private fun PinField(label: String, value: String, onValue: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = { v -> if (v.length <= 6 && v.all { it.isDigit() }) onValue(v) },
        label = { Text(label) },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        modifier = Modifier.fillMaxWidth()
    )
}

@Composable
private fun FlowRowSwatches(selected: String, onSelect: (String) -> Unit) {
    // Eight swatches fit one row on any phone, so a plain Row (two of four) avoids an experimental FlowRow
    PROFILE_COLORS.chunked(4).forEach { rowColors ->
        Row(horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space3)) {
            rowColors.forEach { hex ->
                val isSelected = hex.equals(selected, ignoreCase = true)
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(parseColor(hex))
                        .border(if (isSelected) 3.dp else 1.dp, if (isSelected) KuraColors.TextMain else KuraColors.BorderStrong, CircleShape)
                        .clickable { onSelect(hex) }
                        .semantics {
                            contentDescription = "Color $hex"
                            this.selected = isSelected
                        }
                )
            }
        }
    }
}
