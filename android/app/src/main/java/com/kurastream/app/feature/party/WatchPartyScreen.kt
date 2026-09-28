package com.kurastream.app.feature.party

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Group
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
import com.kurastream.app.core.model.PartyMessage

@Composable
fun WatchPartyScreen(
    viewModel: WatchPartyViewModel,
    onNavigateBack: () -> Unit,
    onNavigateToPlayerWithTicket: (String, String) -> Unit
) {
    val state by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            KuraTopBar(
                title = stringResource(R.string.watch_party),
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(imageVector = Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Volver", tint = KuraColors.TextMain)
                    }
                }
            )
        },
        containerColor = KuraColors.Background
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            val session = state.activeSession
            if (session == null) {
                // Join or Create Room Form
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(KuraDimens.Space5),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Text(
                        text = "Salas Compartidas",
                        style = MaterialTheme.typography.displayMedium,
                        fontWeight = FontWeight.Bold,
                        color = KuraColors.TextMain
                    )
                    Spacer(modifier = Modifier.height(KuraDimens.Space2))
                    Text(
                        text = "Mira anime sincronizado en tiempo real con tus amigos",
                        style = MaterialTheme.typography.bodyMedium,
                        color = KuraColors.TextSecondary
                    )

                    Spacer(modifier = Modifier.height(KuraDimens.Space8))

                    OutlinedTextField(
                        value = state.roomIdInput,
                        onValueChange = viewModel::onRoomIdChanged,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("ID de la sala") },
                        placeholder = { Text("Ej: room_xyz123") },
                        singleLine = true,
                        shape = KuraShapes.Control,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = KuraColors.Secondary,
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
                            color = KuraColors.Danger
                        )
                    }

                    Spacer(modifier = Modifier.height(KuraDimens.Space5))

                    KuraButton(
                        onClick = {
                            viewModel.joinRoom { s ->
                                if (s.room != null) {
                                    onNavigateToPlayerWithTicket(s.room.episodeId, s.streamTicket ?: "")
                                }
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !state.isJoiningRoom && state.roomIdInput.isNotBlank(),
                        text = if (state.isJoiningRoom) "Entrando a la sala…" else "Unirse a la Sala"
                    )

                    Spacer(modifier = Modifier.height(KuraDimens.Space6))
                    HorizontalDivider(color = KuraColors.Border)
                    Spacer(modifier = Modifier.height(KuraDimens.Space4))

                    Text(
                        text = "¿Quieres crear tu propia sala?",
                        style = MaterialTheme.typography.titleSmall,
                        color = KuraColors.TextMain,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(modifier = Modifier.height(KuraDimens.Space1))
                    Text(
                        text = "Abre cualquier episodio en el reproductor y presiona el botón de Watch Party en la barra superior para iniciar una sesión compartida en tiempo real.",
                        style = MaterialTheme.typography.bodySmall,
                        color = KuraColors.TextSecondary
                    )
                }
            } else {
                // Active Room: Participants & Chat
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(KuraDimens.Space4)
                ) {
                    // Room Header Info
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(KuraShapes.Card)
                            .background(KuraColors.Surface)
                            .border(1.dp, KuraColors.Border, KuraShapes.Card)
                            .padding(KuraDimens.Space4),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text(
                                text = "Sala: ${session.roomId}",
                                style = MaterialTheme.typography.titleMedium,
                                color = KuraColors.TextMain,
                                fontWeight = FontWeight.Bold
                            )
                            Row(
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Group,
                                    contentDescription = null,
                                    tint = KuraColors.Secondary,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(KuraDimens.Space1))
                                Text(
                                    text = "${state.members.size} miembros",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = KuraColors.Secondary
                                )
                            }
                            val syncStatus = state.lastSync?.let { sync ->
                                val mins = (sync.currentTime / 60).toInt()
                                val secs = (sync.currentTime % 60).toInt()
                                val timeFormatted = String.format("%02d:%02d", mins, secs)
                                if (sync.isPlaying) "Reproduciendo ($timeFormatted)" else "En pausa ($timeFormatted)"
                            } ?: session.room?.let { room ->
                                val mins = (room.currentTime / 60).toInt()
                                val secs = (room.currentTime % 60).toInt()
                                val timeFormatted = String.format("%02d:%02d", mins, secs)
                                if (room.isPlaying) "Reproduciendo ($timeFormatted)" else "En pausa ($timeFormatted)"
                            }
                            if (syncStatus != null) {
                                Spacer(modifier = Modifier.height(KuraDimens.Space1))
                                Text(
                                    text = syncStatus,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = KuraColors.TextMuted
                                )
                            }
                        }

                        Row(horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space2)) {
                            if (!session.room?.episodeId.isNullOrBlank()) {
                                KuraButton(
                                    onClick = {
                                        onNavigateToPlayerWithTicket(session.room?.episodeId ?: "", session.streamTicket ?: "")
                                    },
                                    text = "Reproducir"
                                )
                            }
                            KuraOutlinedButton(
                                onClick = viewModel::leaveRoom,
                                text = "Salir"
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(KuraDimens.Space3))

                    // Messages LazyColumn
                    LazyColumn(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(KuraDimens.Space2)
                    ) {
                        items(state.messages, key = { it.id }) { msg ->
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(KuraColors.SurfaceRaised, KuraShapes.Control)
                                    .padding(horizontal = KuraDimens.Space3, vertical = KuraDimens.Space2)
                            ) {
                                Text(
                                    text = msg.username,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = KuraColors.Secondary,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = msg.message,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = KuraColors.TextMain
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(KuraDimens.Space2))

                    // Chat Input Row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedTextField(
                            value = state.chatInput,
                            onValueChange = viewModel::onChatInputChanged,
                            modifier = Modifier.weight(1f),
                            placeholder = { Text("Escribe un mensaje…", color = KuraColors.TextMuted) },
                            singleLine = true,
                            shape = KuraShapes.Control,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = KuraColors.Secondary,
                                unfocusedBorderColor = KuraColors.Border,
                                focusedTextColor = KuraColors.TextMain,
                                unfocusedTextColor = KuraColors.TextMain,
                                focusedContainerColor = KuraColors.Surface,
                                unfocusedContainerColor = KuraColors.Surface
                            )
                        )

                        Spacer(modifier = Modifier.width(KuraDimens.Space2))

                        IconButton(
                            onClick = viewModel::sendMessage,
                            modifier = Modifier
                                .size(48.dp)
                                .background(KuraColors.Secondary, KuraShapes.Control)
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.Send,
                                contentDescription = "Enviar",
                                tint = KuraColors.Background
                            )
                        }
                    }
                }
            }
        }
    }
}
