package com.kurastream.app.feature.history

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.kurastream.app.R
import com.kurastream.app.core.designsystem.component.*
import com.kurastream.app.core.designsystem.theme.*
import com.kurastream.app.core.model.UiState
import com.kurastream.app.core.model.WatchHistoryItem
import com.kurastream.app.core.network.ServerUrlResolver

@Composable
fun HistoryScreen(
    viewModel: HistoryViewModel,
    onNavigateToPlayer: (String) -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = {
            KuraTopBar(
                title = stringResource(R.string.nav_history),
                actions = {
                    val hasContent = (uiState.state as? UiState.Content)?.data?.isNotEmpty() == true
                    if (hasContent) {
                        IconButton(onClick = viewModel::requestClearAll) {
                            Icon(
                                imageVector = Icons.Default.DeleteSweep,
                                contentDescription = "Borrar todo",
                                tint = KuraColors.TextSecondary
                            )
                        }
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
            when (val state = uiState.state) {
                is UiState.Loading -> {
                    KuraLoadingView(message = "Cargando historial…")
                }
                is UiState.Error -> {
                    KuraErrorView(message = state.message, onRetry = viewModel::loadHistory)
                }
                is UiState.Empty -> {
                    KuraEmptyView(message = state.message)
                }
                is UiState.Content, is UiState.Refreshing -> {
                    val items = if (state is UiState.Content) state.data else (state as UiState.Refreshing).currentData

                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(KuraDimens.Space4),
                        verticalArrangement = Arrangement.spacedBy(KuraDimens.Space3)
                    ) {
                        items(items, key = { it.episodeId }) { item ->
                            val thumbUrl = ServerUrlResolver.buildMediaUrl(uiState.baseUrl, item.thumbnailPath)
                            HistoryRowItem(
                                item = item,
                                thumbnailUrl = thumbUrl,
                                onClick = { onNavigateToPlayer(item.episodeId) },
                                onDelete = { viewModel.deleteItem(item.episodeId) }
                            )
                        }
                    }
                }
            }

            // Clear All History Confirmation Dialog
            if (uiState.showClearConfirmation) {
                AlertDialog(
                    onDismissRequest = viewModel::dismissClearDialog,
                    title = { Text(stringResource(R.string.clear_history), color = KuraColors.TextMain) },
                    text = { Text(stringResource(R.string.clear_history_confirm), color = KuraColors.TextSecondary) },
                    confirmButton = {
                        TextButton(onClick = viewModel::confirmClearAll) {
                            Text("Borrar", color = KuraColors.Danger, fontWeight = FontWeight.Bold)
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = viewModel::dismissClearDialog) {
                            Text(stringResource(R.string.cancel), color = KuraColors.TextSecondary)
                        }
                    },
                    containerColor = KuraColors.Surface,
                    shape = KuraShapes.Modal
                )
            }
        }
    }
}

@Composable
private fun HistoryRowItem(
    item: WatchHistoryItem,
    thumbnailUrl: String,
    onClick: () -> Unit,
    onDelete: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(KuraShapes.Card)
            .background(KuraColors.Surface)
            .border(1.dp, KuraColors.Border, KuraShapes.Card)
            .clickable(onClick = onClick)
            .padding(KuraDimens.Space3),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Thumbnail with progress
        Box(
            modifier = Modifier
                .size(width = 120.dp, height = 68.dp)
                .background(KuraColors.SurfaceRaised, KuraShapes.Control)
                .clip(KuraShapes.Control)
        ) {
            AsyncImage(
                model = thumbnailUrl,
                contentDescription = item.showTitle,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
            // Progress Bar
            Box(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .height(3.dp)
                    .background(KuraColors.SurfaceHover)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxHeight()
                        .fillMaxWidth((item.progressPercentage / 100f).coerceIn(0f, 1f))
                        .background(KuraColors.Primary)
                )
            }
        }

        Spacer(modifier = Modifier.width(KuraDimens.Space3))

        // Info
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = item.showTitle,
                style = MaterialTheme.typography.titleMedium,
                color = KuraColors.TextMain,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = "T${item.seasonNumber} E${item.episodeNumber}",
                style = MaterialTheme.typography.labelSmall,
                color = KuraColors.TextSecondary
            )
            Spacer(modifier = Modifier.height(2.dp))
            if (item.completed) {
                KuraBadge(text = "Completado")
            } else {
                Text(
                    text = "${item.progressPercentage}% completado",
                    style = MaterialTheme.typography.labelSmall,
                    color = KuraColors.Primary
                )
            }
        }

        IconButton(onClick = onDelete) {
            Icon(
                imageVector = Icons.Default.Delete,
                contentDescription = "Eliminar del historial",
                tint = KuraColors.TextMuted,
                modifier = Modifier.size(20.dp)
            )
        }
    }
}
