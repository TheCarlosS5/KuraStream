package com.kurastream.app.feature.server

import android.os.Build
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
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kurastream.app.R
import com.kurastream.app.core.designsystem.component.KuraButton
import com.kurastream.app.core.designsystem.component.KuraTopBar
import com.kurastream.app.core.designsystem.theme.*
import com.kurastream.app.core.model.ServerProfile

@Composable
fun ServerSetupScreen(
    viewModel: ServerSetupViewModel,
    onServerConnected: (ServerProfile) -> Unit
) {
    val state by viewModel.uiState.collectAsState()

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
            Spacer(modifier = Modifier.height(KuraDimens.Space6))

            // Branding Section
            Row(
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .background(KuraColors.SurfaceRaised, KuraShapes.Card)
                        .border(1.dp, KuraColors.Border, KuraShapes.Card),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Dns,
                        contentDescription = null,
                        tint = KuraColors.Primary,
                        modifier = Modifier.size(26.dp)
                    )
                }
                Spacer(modifier = Modifier.width(KuraDimens.Space3))
                Column {
                    Text(
                        text = "KURASTREAM",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = KuraColors.TextMain,
                        letterSpacing = 1.sp
                    )
                    Text(
                        text = "Cliente Nativo para Android",
                        style = MaterialTheme.typography.labelSmall,
                        color = KuraColors.TextSecondary
                    )
                }
            }

            Spacer(modifier = Modifier.height(KuraDimens.Space8))

            // Server URL Input Field
            OutlinedTextField(
                value = state.urlInput,
                onValueChange = viewModel::onUrlChanged,
                modifier = Modifier.fillMaxWidth(),
                placeholder = {
                    Text(
                        text = stringResource(R.string.server_url_hint),
                        style = MaterialTheme.typography.bodyMedium,
                        color = KuraColors.TextMuted
                    )
                },
                label = { Text(stringResource(R.string.server_url)) },
                trailingIcon = {
                    if (state.urlInput.isNotBlank()) {
                        IconButton(onClick = { viewModel.onUrlChanged("") }) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "Limpiar",
                                tint = KuraColors.TextSecondary
                            )
                        }
                    }
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
                )
            )

            // Discrete HTTP Cleartext Warning
            if (state.validation != null && state.validation?.isValid == true && !state.validation!!.isHttps) {
                Spacer(modifier = Modifier.height(KuraDimens.Space2))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(KuraColors.SurfaceRaised, KuraShapes.Small)
                        .border(1.dp, KuraColors.Border, KuraShapes.Small)
                        .padding(horizontal = KuraDimens.Space3, vertical = KuraDimens.Space2),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Warning,
                        contentDescription = null,
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

            Spacer(modifier = Modifier.height(KuraDimens.Space4))

            // Connect Button
            KuraButton(
                onClick = { viewModel.connectServer(onServerConnected) },
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.isTesting && state.urlInput.isNotBlank(),
                text = if (state.isTesting) stringResource(R.string.testing_connection) else stringResource(R.string.connect)
            )

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
                                .clickable { viewModel.selectRecentServer(server, onServerConnected) }
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
