package com.kurastream.app.feature.server

import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.kurastream.app.R
import com.kurastream.app.core.designsystem.component.KuraButton
import com.kurastream.app.core.designsystem.component.KuraOutlinedButton
import com.kurastream.app.core.designsystem.component.KuraTopBar
import com.kurastream.app.core.designsystem.theme.*
import com.kurastream.app.core.model.ServerProfile

@Composable
fun ServerSetupScreen(
    viewModel: ServerSetupViewModel,
    onServerConnected: (ServerProfile) -> Unit
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        viewModel.onLocalNetworkPermissionResult(isGranted, onServerConnected)
    }

    val attemptConnect = {
        val hasLocalPermission = if (Build.VERSION.SDK_INT >= 37) {
            ContextCompat.checkSelfPermission(context, "android.permission.ACCESS_LOCAL_NETWORK") == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
        viewModel.connectServer(
            isLocalNetworkPermissionGranted = hasLocalPermission,
            onSuccess = onServerConnected
        )
    }

    Scaffold(
        topBar = {
            KuraTopBar(title = stringResource(R.string.server_connection))
        },
        containerColor = KuraColors.Background
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = KuraDimens.Space5),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(KuraDimens.Space8))

            // Icon Header
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .clip(KuraShapes.Modal)
                    .background(KuraColors.SurfaceRaised)
                    .border(1.dp, KuraColors.Border, KuraShapes.Modal),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Dns,
                    contentDescription = null,
                    tint = KuraColors.Primary,
                    modifier = Modifier.size(32.dp)
                )
            }

            Spacer(modifier = Modifier.height(KuraDimens.Space4))

            Text(
                text = "Conecta con tu servidor",
                style = MaterialTheme.typography.titleLarge,
                color = KuraColors.TextMain,
                fontWeight = FontWeight.Bold
            )

            Text(
                text = "Introduce la IP o dominio de tu instancia KuraStream",
                style = MaterialTheme.typography.bodyMedium,
                color = KuraColors.TextSecondary,
                modifier = Modifier.padding(top = KuraDimens.Space1)
            )

            Spacer(modifier = Modifier.height(KuraDimens.Space6))

            // URL Input Field
            OutlinedTextField(
                value = state.urlInput,
                onValueChange = viewModel::onUrlChanged,
                modifier = Modifier.fillMaxWidth(),
                placeholder = {
                    Text(
                        text = "192.168.1.50:3000 o https://kura.midominio.com",
                        color = KuraColors.TextMuted,
                        fontSize = 14.sp
                    )
                },
                singleLine = true,
                shape = KuraShapes.Control,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = KuraColors.Primary,
                    unfocusedBorderColor = KuraColors.Border,
                    focusedTextColor = KuraColors.TextMain,
                    unfocusedTextColor = KuraColors.TextMain,
                    focusedContainerColor = KuraColors.Surface,
                    unfocusedContainerColor = KuraColors.Surface
                ),
                trailingIcon = {
                    if (state.urlInput.isNotEmpty()) {
                        IconButton(onClick = { viewModel.onUrlChanged("") }) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "Limpiar",
                                tint = KuraColors.TextMuted
                            )
                        }
                    }
                }
            )

            // Dynamic Normalization / Protocol Indicator
            if (state.validation != null && state.validation!!.isValid) {
                Spacer(modifier = Modifier.height(KuraDimens.Space2))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Destino normalizado: ${state.validation!!.normalizedUrl}",
                        style = MaterialTheme.typography.labelSmall,
                        color = KuraColors.Secondary
                    )
                }
            }

            // HTTP Unencrypted Warning
            if (state.validation != null && state.validation!!.isValid && !state.validation!!.isHttps) {
                Spacer(modifier = Modifier.height(KuraDimens.Space2))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(KuraShapes.Control)
                        .background(KuraColors.Warning.copy(alpha = 0.1f))
                        .padding(horizontal = KuraDimens.Space3, vertical = KuraDimens.Space2),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Warning,
                        contentDescription = "Alerta",
                        tint = KuraColors.Warning,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(KuraDimens.Space2))
                    Text(
                        text = stringResource(R.string.http_warning),
                        style = MaterialTheme.typography.labelSmall,
                        color = KuraColors.TextSecondary
                    )
                }
            }

            // Error Display
            if (state.errorMessage != null) {
                Spacer(modifier = Modifier.height(KuraDimens.Space3))
                Text(
                    text = state.errorMessage!!,
                    style = MaterialTheme.typography.bodyMedium,
                    color = KuraColors.Danger,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            // Success Display (e.g. Server discovered)
            if (state.successMessage != null) {
                Spacer(modifier = Modifier.height(KuraDimens.Space3))
                Text(
                    text = state.successMessage!!,
                    style = MaterialTheme.typography.bodyMedium,
                    color = KuraColors.Success,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            Spacer(modifier = Modifier.height(KuraDimens.Space4))

            // Connect Button
            KuraButton(
                onClick = attemptConnect,
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.isTesting && !state.isScanningLan && state.urlInput.isNotBlank(),
                text = if (state.isTesting) stringResource(R.string.testing_connection) else stringResource(R.string.connect)
            )

            Spacer(modifier = Modifier.height(KuraDimens.Space3))

            // LAN Auto Discovery Button
            KuraOutlinedButton(
                onClick = {
                    if (state.isScanningLan) {
                        viewModel.cancelLanDiscovery()
                    } else {
                        viewModel.startLanDiscovery()
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                text = if (state.isScanningLan) "Buscando en red local… (Cancelar)" else "Buscar servidor local automáticamente",
                leadingIcon = {
                    if (state.isScanningLan) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            color = KuraColors.Secondary,
                            strokeWidth = 2.dp
                        )
                    } else {
                        Icon(
                            imageVector = Icons.Default.Search,
                            contentDescription = null,
                            tint = KuraColors.Secondary
                        )
                    }
                }
            )

            // Local Network Permission Contextual Dialog (Android 17 / API 37)
            if (state.showLocalNetworkPermissionDialog) {
                AlertDialog(
                    onDismissRequest = viewModel::dismissLocalNetworkDialog,
                    title = {
                        Text(
                            text = "Acceso a la Red Local",
                            style = MaterialTheme.typography.titleLarge,
                            color = KuraColors.TextMain
                        )
                    },
                    text = {
                        Text(
                            text = "KuraStream necesita acceder al servidor multimedia de tu red local para descubrir contenido, cargar imágenes y reproducir video.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = KuraColors.TextSecondary
                        )
                    },
                    confirmButton = {
                        KuraButton(
                            onClick = {
                                permissionLauncher.launch("android.permission.ACCESS_LOCAL_NETWORK")
                            },
                            text = "Conceder permiso"
                        )
                    },
                    dismissButton = {
                        TextButton(onClick = viewModel::dismissLocalNetworkDialog) {
                            Text("Cancelar", color = KuraColors.TextMuted)
                        }
                    },
                    containerColor = KuraColors.Surface,
                    shape = KuraShapes.Modal
                )
            }

            // Recent Servers Section
            if (state.recentServers.isNotEmpty()) {
                Spacer(modifier = Modifier.height(KuraDimens.Space8))
                Text(
                    text = stringResource(R.string.recent_servers),
                    style = MaterialTheme.typography.titleMedium,
                    color = KuraColors.TextSecondary,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = KuraDimens.Space2)
                )

                LazyColumn(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(KuraDimens.Space2)
                ) {
                    items(state.recentServers, key = { it.id }) { server ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(KuraShapes.Card)
                                .background(KuraColors.Surface)
                                .border(1.dp, KuraColors.Border, KuraShapes.Card)
                                .clickable {
                                    val hasLocalPermission = if (Build.VERSION.SDK_INT >= 37) {
                                        ContextCompat.checkSelfPermission(context, "android.permission.ACCESS_LOCAL_NETWORK") == PackageManager.PERMISSION_GRANTED
                                    } else {
                                        true
                                    }
                                    viewModel.selectRecentServer(server, isLocalNetworkPermissionGranted = hasLocalPermission, onSuccess = onServerConnected)
                                }
                                .padding(horizontal = KuraDimens.Space4, vertical = KuraDimens.Space3),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = server.displayName,
                                    style = MaterialTheme.typography.titleMedium,
                                    color = KuraColors.TextMain
                                )
                                Text(
                                    text = server.baseUrl,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = KuraColors.TextMuted
                                )
                            }
                            IconButton(onClick = { viewModel.deleteRecentServer(server.id) }) {
                                Icon(
                                    imageVector = Icons.Default.Delete,
                                    contentDescription = "Eliminar",
                                    tint = KuraColors.TextMuted,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
