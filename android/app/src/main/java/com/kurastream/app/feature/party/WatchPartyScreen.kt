package com.kurastream.app.feature.party

import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Close
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
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.SentimentVerySatisfied
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material.icons.filled.Whatshot
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector

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
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center
                        ) {
                            Text(
                                text = state.errorMessage!!,
                                style = MaterialTheme.typography.bodyMedium,
                                color = KuraColors.Danger,
                                modifier = Modifier.weight(1f, fill = false)
                            )
                            IconButton(onClick = viewModel::clearError) {
                                Icon(
                                    imageVector = Icons.Default.Close,
                                    contentDescription = "Descartar",
                                    tint = KuraColors.TextSecondary
                                )
                            }
                        }
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
                val chatListState = rememberLazyListState()
                LaunchedEffect(state.messages.size) {
                    if (state.messages.isNotEmpty()) chatListState.animateScrollToItem(state.messages.lastIndex)
                }
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .imePadding()
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
                        val context = androidx.compose.ui.platform.LocalContext.current
                        IconButton(onClick = {
                            val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(
                                    android.content.Intent.EXTRA_TEXT,
                                    "Únete a mi Watch Party en KuraStream: kurastream://party/${session.roomId}\nCódigo de sala: ${session.roomId}"
                                )
                            }
                            context.startActivity(android.content.Intent.createChooser(send, "Compartir sala"))
                        }) {
                            Icon(Icons.Default.Share, contentDescription = "Compartir sala", tint = KuraColors.TextMain)
                        }
                        Column {
                            Text(
                                text = "Sala: ${session.roomId}",
                                style = MaterialTheme.typography.titleMedium,
                                color = KuraColors.TextMain,
                                fontWeight = FontWeight.Bold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f, fill = false)
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
                        state = chatListState,
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(KuraDimens.Space2)
                    ) {
                        items(state.messages, key = { it.id }) { msg ->
                            if (msg.type == "reaction" || msg.type == "system") {
                                PartyNoticeRow(msg)
                                return@items
                            }
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

                    // Quick reactions (same set as the web player)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly
                    ) {
                        PartyReactions.ALL.forEach { reaction ->
                            IconButton(onClick = { viewModel.sendReaction(reaction.key) }) {
                                Icon(
                                    imageVector = reaction.icon,
                                    contentDescription = reaction.label,
                                    tint = reaction.color
                                )
                            }
                        }
                    }

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

/** Reaction keys travel as plain text; older web builds sent emoji, mapped here to the same icons. */
private object PartyReactions {
    data class Reaction(val key: String, val label: String, val icon: ImageVector, val color: Color)

    val ALL = listOf(
        Reaction("flame", "Fuego", Icons.Default.Whatshot, Color(0xFFFF8A4C)),
        Reaction("heart", "Me encanta", Icons.Default.Favorite, Color(0xFFFF6B81)),
        Reaction("smile", "Risa", Icons.Default.SentimentVerySatisfied, Color(0xFFF1C75B)),
        Reaction("sparkles", "Increíble", Icons.Default.AutoAwesome, Color(0xFF9AA3FF)),
        Reaction("thumbs-up", "Me gusta", Icons.Default.ThumbUp, Color(0xFF5ED8C6))
    )

    private val LEGACY = mapOf(
        "\uD83D\uDD25" to "flame",
        "\u2764\uFE0F" to "heart",
        "\u2764" to "heart",
        "\uD83D\uDE02" to "smile",
        "\uD83E\uDD23" to "smile",
        "\uD83D\uDE04" to "smile",
        "\uD83C\uDF89" to "sparkles",
        "\u2728" to "sparkles",
        "\uD83D\uDC4D" to "thumbs-up"
    )

    fun find(message: String): Reaction {
        val key = LEGACY[message.trim()] ?: message.trim()
        return ALL.firstOrNull { it.key == key } ?: ALL[3]
    }
}

@Composable
private fun PartyNoticeRow(msg: PartyMessage) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = KuraDimens.Space2),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (msg.type == "reaction") {
            val reaction = PartyReactions.find(msg.message)
            Text(
                text = msg.username,
                style = MaterialTheme.typography.labelSmall,
                color = KuraColors.TextMuted
            )
            Spacer(modifier = Modifier.width(6.dp))
            Icon(
                imageVector = reaction.icon,
                contentDescription = reaction.label,
                tint = reaction.color,
                modifier = Modifier.size(18.dp)
            )
        } else {
            Text(
                text = msg.message,
                style = MaterialTheme.typography.labelSmall,
                color = KuraColors.TextMuted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

