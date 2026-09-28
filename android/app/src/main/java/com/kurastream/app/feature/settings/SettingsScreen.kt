package com.kurastream.app.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kurastream.app.R
import com.kurastream.app.core.designsystem.component.*
import com.kurastream.app.core.designsystem.theme.*

@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    onNavigateToProfileSelect: () -> Unit,
    onNavigateToServerSetup: () -> Unit,
    onLogoutSuccess: () -> Unit
) {
    val state by viewModel.uiState.collectAsState()
    val prefs = state.sessionPrefs
    val context = androidx.compose.ui.platform.LocalContext.current

    var showAudioDialog by remember { mutableStateOf(false) }
    var showSubtitlesDialog by remember { mutableStateOf(false) }
    var showSeekDialog by remember { mutableStateOf(false) }

    if (showAudioDialog) {
        val options = listOf(
            "jpn" to "Japonés (Original)",
            "es-419" to "Español Latino",
            "spa" to "Español (Castellano)",
            "eng" to "Inglés"
        )
        AlertDialog(
            onDismissRequest = { showAudioDialog = false },
            title = { Text("Audio preferido", color = KuraColors.TextMain) },
            text = {
                Column {
                    options.forEach { (code, label) ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    viewModel.setPreferredAudio(code)
                                    showAudioDialog = false
                                }
                                .padding(vertical = KuraDimens.Space2),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = prefs.preferredAudioLanguage.equals(code, ignoreCase = true),
                                onClick = {
                                    viewModel.setPreferredAudio(code)
                                    showAudioDialog = false
                                }
                            )
                            Spacer(modifier = Modifier.width(KuraDimens.Space2))
                            Text(text = label, color = KuraColors.TextMain)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showAudioDialog = false }) {
                    Text("Cerrar", color = KuraColors.Secondary)
                }
            },
            containerColor = KuraColors.Surface
        )
    }

    if (showSubtitlesDialog) {
        val options = listOf(
            "es-419" to "Español Latino",
            "spa" to "Español (Castellano)",
            "eng" to "Inglés",
            "" to "Desactivados"
        )
        AlertDialog(
            onDismissRequest = { showSubtitlesDialog = false },
            title = { Text("Subtítulos preferidos", color = KuraColors.TextMain) },
            text = {
                Column {
                    options.forEach { (code, label) ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    viewModel.setPreferredSubtitles(code)
                                    showSubtitlesDialog = false
                                }
                                .padding(vertical = KuraDimens.Space2),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = (prefs.preferredSubtitleLanguage.equals(code, ignoreCase = true) || (code.isEmpty() && prefs.preferredSubtitleLanguage.isEmpty())),
                                onClick = {
                                    viewModel.setPreferredSubtitles(code)
                                    showSubtitlesDialog = false
                                }
                            )
                            Spacer(modifier = Modifier.width(KuraDimens.Space2))
                            Text(text = label, color = KuraColors.TextMain)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showSubtitlesDialog = false }) {
                    Text("Cerrar", color = KuraColors.Secondary)
                }
            },
            containerColor = KuraColors.Surface
        )
    }

    if (showSeekDialog) {
        val options = listOf(5, 10, 15, 30)
        AlertDialog(
            onDismissRequest = { showSeekDialog = false },
            title = { Text("Salto de doble toque", color = KuraColors.TextMain) },
            text = {
                Column {
                    options.forEach { seconds ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    viewModel.setDoubleTapSeekSeconds(seconds)
                                    showSeekDialog = false
                                }
                                .padding(vertical = KuraDimens.Space2),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = prefs.doubleTapSeekSeconds == seconds,
                                onClick = {
                                    viewModel.setDoubleTapSeekSeconds(seconds)
                                    showSeekDialog = false
                                }
                            )
                            Spacer(modifier = Modifier.width(KuraDimens.Space2))
                            Text(text = "$seconds segundos", color = KuraColors.TextMain)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showSeekDialog = false }) {
                    Text("Cerrar", color = KuraColors.Secondary)
                }
            },
            containerColor = KuraColors.Surface
        )
    }

    Scaffold(
        topBar = {
            KuraTopBar(title = stringResource(R.string.settings))
        },
        containerColor = KuraColors.Background
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(KuraDimens.Space4),
            verticalArrangement = Arrangement.spacedBy(KuraDimens.Space5)
        ) {
            // Account & Profile Card
            item {
                SectionTitle("Cuenta y Perfil")
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = KuraShapes.Card,
                    colors = CardDefaults.cardColors(containerColor = KuraColors.Surface),
                    border = androidx.compose.foundation.BorderStroke(1.dp, KuraColors.Border)
                ) {
                    Column(modifier = Modifier.padding(KuraDimens.Space4)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column {
                                Text(
                                    text = prefs.activeProfileName ?: "Perfil",
                                    style = MaterialTheme.typography.titleLarge,
                                    fontWeight = FontWeight.Bold,
                                    color = KuraColors.TextMain
                                )
                                Text(
                                    text = "Usuario: ${prefs.activeUsername ?: "Anónimo"}",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = KuraColors.TextSecondary
                                )
                                if (prefs.isKidsMode) {
                                    Spacer(modifier = Modifier.height(KuraDimens.Space1))
                                    KuraBadge(text = "Modo Infantil Activo", isAccent = true)
                                }
                            }

                            KuraOutlinedButton(
                                onClick = onNavigateToProfileSelect,
                                text = "Cambiar"
                            )
                        }
                    }
                }
            }

            // User Stats Card (if available)
            if (state.userStats != null) {
                item {
                    SectionTitle("Estadísticas de Visualización")
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = KuraShapes.Card,
                        colors = CardDefaults.cardColors(containerColor = KuraColors.Surface),
                        border = androidx.compose.foundation.BorderStroke(1.dp, KuraColors.Border)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(KuraDimens.Space4),
                            horizontalArrangement = Arrangement.SpaceAround
                        ) {
                            val hours = (state.userStats!!.totalTimeSeconds / 3600).toInt()
                            StatMetric(label = "Horas vistas", value = "${hours}h")
                            StatMetric(label = "Episodios", value = state.userStats!!.watchedEpisodes.toString())
                            StatMetric(label = "Completadas", value = state.userStats!!.completedShows.toString())
                            StatMetric(label = "Top Género", value = state.userStats!!.topGenre)
                        }
                    }
                }
            }

            // Server Card
            item {
                SectionTitle("Servidor Conectado")
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = KuraShapes.Card,
                    colors = CardDefaults.cardColors(containerColor = KuraColors.Surface),
                    border = androidx.compose.foundation.BorderStroke(1.dp, KuraColors.Border)
                ) {
                    Column(modifier = Modifier.padding(KuraDimens.Space4)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = prefs.activeServerUrl ?: "No configurado",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = KuraColors.TextMain
                                )
                                Text(
                                    text = if (prefs.activeServerUrl?.startsWith("https://") == true) "Conexión Cifrada (HTTPS)" else "Conexión Local / No cifrada (HTTP)",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (prefs.activeServerUrl?.startsWith("https://") == true) KuraColors.Success else KuraColors.Warning
                                )
                            }
                            KuraOutlinedButton(
                                onClick = onNavigateToServerSetup,
                                text = "Cambiar"
                            )
                        }
                    }
                }
            }

            // Player Preferences
            item {
                SectionTitle("Ajustes del Reproductor")
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = KuraShapes.Card,
                    colors = CardDefaults.cardColors(containerColor = KuraColors.Surface),
                    border = androidx.compose.foundation.BorderStroke(1.dp, KuraColors.Border)
                ) {
                    Column(modifier = Modifier.padding(KuraDimens.Space4)) {
                        ToggleSettingItem(
                            title = "Saltar intro automáticamente",
                            subtitle = "Avanza cuando existen marcas oficiales de intro",
                            checked = prefs.autoSkipIntro,
                            onCheckedChange = viewModel::setAutoSkipIntro
                        )
                        HorizontalDivider(color = KuraColors.Border, modifier = Modifier.padding(vertical = KuraDimens.Space2))
                        ToggleSettingItem(
                            title = "Saltar outro automáticamente",
                            subtitle = "Pasa al siguiente episodio al llegar al ending",
                            checked = prefs.autoSkipOutro,
                            onCheckedChange = viewModel::setAutoSkipOutro
                        )
                        HorizontalDivider(color = KuraColors.Border, modifier = Modifier.padding(vertical = KuraDimens.Space2))
                        ToggleSettingItem(
                            title = "Reproducir siguiente episodio",
                            subtitle = "Inicia automáticamente el próximo capítulo",
                            checked = prefs.autoPlayNext,
                            onCheckedChange = viewModel::setAutoPlayNext
                        )
                        HorizontalDivider(color = KuraColors.Border, modifier = Modifier.padding(vertical = KuraDimens.Space2))
                        ClickableSettingItem(
                            title = "Audio preferido",
                            subtitle = "Pista de audio predeterminada al reproducir",
                            value = when (prefs.preferredAudioLanguage.lowercase()) {
                                "jpn", "ja" -> "Japonés"
                                "es-419", "lat" -> "Español Latino"
                                "spa", "es" -> "Español (Castellano)"
                                "eng", "en" -> "Inglés"
                                else -> prefs.preferredAudioLanguage
                            },
                            onClick = { showAudioDialog = true }
                        )
                        HorizontalDivider(color = KuraColors.Border, modifier = Modifier.padding(vertical = KuraDimens.Space2))
                        ClickableSettingItem(
                            title = "Subtítulos preferidos",
                            subtitle = "Pista de subtítulos predeterminada",
                            value = when (prefs.preferredSubtitleLanguage.lowercase()) {
                                "es-419", "lat" -> "Español Latino"
                                "spa", "es" -> "Español (Castellano)"
                                "eng", "en" -> "Inglés"
                                "", "off" -> "Desactivados"
                                else -> prefs.preferredSubtitleLanguage
                            },
                            onClick = { showSubtitlesDialog = true }
                        )
                        HorizontalDivider(color = KuraColors.Border, modifier = Modifier.padding(vertical = KuraDimens.Space2))
                        ClickableSettingItem(
                            title = "Salto de doble toque",
                            subtitle = "Segundos a avanzar o retroceder",
                            value = "${prefs.doubleTapSeekSeconds}s",
                            onClick = { showSeekDialog = true }
                        )
                    }
                }
            }

            // Data & Cache
            item {
                SectionTitle("Almacenamiento y Datos")
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = KuraShapes.Card,
                    colors = CardDefaults.cardColors(containerColor = KuraColors.Surface),
                    border = androidx.compose.foundation.BorderStroke(1.dp, KuraColors.Border)
                ) {
                    Column(modifier = Modifier.padding(KuraDimens.Space4)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable(onClick = viewModel::clearCache)
                                .padding(vertical = KuraDimens.Space2)
                        ) {
                            Column {
                                Text(
                                    text = "Limpiar Caché Local",
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = KuraColors.TextMain
                                )
                                Text(
                                    text = "Libera espacio de imágenes temporales y catálogo",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = KuraColors.TextSecondary
                                )
                            }
                            Icon(
                                imageVector = Icons.Default.CleaningServices,
                                contentDescription = null,
                                tint = KuraColors.TextSecondary
                            )
                        }

                        if (state.cacheClearedMessage != null) {
                            Spacer(modifier = Modifier.height(KuraDimens.Space2))
                            Text(
                                text = state.cacheClearedMessage!!,
                                style = MaterialTheme.typography.labelSmall,
                                color = KuraColors.Success
                            )
                        }
                    }
                }
            }

            // System Diagnostics (Section 72)
            item {
                SectionTitle("Diagnóstico del Sistema")
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = KuraShapes.Card,
                    colors = CardDefaults.cardColors(containerColor = KuraColors.Surface),
                    border = androidx.compose.foundation.BorderStroke(1.dp, KuraColors.Border)
                ) {
                    Column(modifier = Modifier.padding(KuraDimens.Space4)) {
                        val serverUrlSanitized = prefs.activeServerUrl?.replace(Regex("//[^@]+@"), "//") ?: "No configurado"
                        val isHttps = prefs.activeServerUrl?.startsWith("https", ignoreCase = true) == true

                        Text(
                            text = "Servidor: $serverUrlSanitized",
                            style = MaterialTheme.typography.bodyMedium,
                            color = KuraColors.TextMain
                        )
                        Text(
                            text = "Seguridad: ${if (isHttps) "HTTPS Cifrado" else "HTTP Local (Sin cifrar)"}",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (isHttps) KuraColors.Success else KuraColors.Rating
                        )
                        Spacer(modifier = Modifier.height(KuraDimens.Space2))
                        Text(
                            text = "Perfil: ${prefs.activeProfileName ?: "Predeterminado"} (${if (prefs.isKidsMode) "Modo Infantil" else "Estándar"})",
                            style = MaterialTheme.typography.labelSmall,
                            color = KuraColors.TextSecondary
                        )
                        Text(
                            text = "Dispositivo: ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL} • Android ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT})",
                            style = MaterialTheme.typography.labelSmall,
                            color = KuraColors.TextSecondary
                        )
                        Text(
                            text = "Motor: Media3 ExoPlayer v1.5.1 • Room SQLite • OkHttp",
                            style = MaterialTheme.typography.labelSmall,
                            color = KuraColors.TextSecondary
                        )

                        Spacer(modifier = Modifier.height(KuraDimens.Space3))

                        KuraOutlinedButton(
                            onClick = {
                                val report = """
                                    KuraStream Android Diagnostic Report
                                    App Version: 2.0.0 (API 37 Target)
                                    Server: $serverUrlSanitized
                                    Protocol: ${if (isHttps) "HTTPS" else "HTTP"}
                                    Profile: ${prefs.activeProfileName ?: "Default"} (Kids: ${prefs.isKidsMode})
                                    OS: Android ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT})
                                    Device: ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}
                                    Media Engine: Media3 ExoPlayer 1.5.1
                                """.trimIndent()
                                val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
                                clipboard?.setPrimaryClip(android.content.ClipData.newPlainText("KuraStream Diagnostics", report))
                                android.widget.Toast.makeText(context, "Diagnóstico copiado al portapapeles", android.widget.Toast.LENGTH_SHORT).show()
                            },
                            text = "Copiar diagnóstico",
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            }

            // Logout Action
            item {
                Spacer(modifier = Modifier.height(KuraDimens.Space2))
                KuraOutlinedButton(
                    onClick = { viewModel.logout(onLogoutSuccess) },
                    modifier = Modifier.fillMaxWidth(),
                    text = "Cerrar Sesión",
                    leadingIcon = {
                        Icon(imageVector = Icons.AutoMirrored.Filled.Logout, contentDescription = null, tint = KuraColors.Danger)
                    }
                )
            }

            // About
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = KuraDimens.Space4),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "KuraStream para Android v2.0.0",
                        style = MaterialTheme.typography.labelSmall,
                        color = KuraColors.TextMuted
                    )
                    Text(
                        text = "Jetpack Compose • Media3 ExoPlayer • Android 8.0 a 17+",
                        style = MaterialTheme.typography.labelSmall,
                        color = KuraColors.TextMuted
                    )
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.SemiBold,
        color = KuraColors.Secondary,
        modifier = Modifier.padding(bottom = KuraDimens.Space2)
    )
}

@Composable
private fun StatMetric(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = value,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = KuraColors.Primary
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = KuraColors.TextSecondary
        )
    }
}

@Composable
private fun ToggleSettingItem(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = KuraDimens.Space2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                color = KuraColors.TextMain
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.labelSmall,
                color = KuraColors.TextSecondary
            )
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = KuraColors.Primary,
                checkedTrackColor = KuraColors.PrimarySoft,
                uncheckedThumbColor = KuraColors.TextMuted,
                uncheckedTrackColor = KuraColors.SurfaceRaised
            )
        )
    }
}

@Composable
private fun ClickableSettingItem(
    title: String,
    subtitle: String,
    value: String,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = KuraDimens.Space2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                color = KuraColors.TextMain
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.labelSmall,
                color = KuraColors.TextSecondary
            )
        }
        Text(
            text = value,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            color = KuraColors.Secondary
        )
    }
}

