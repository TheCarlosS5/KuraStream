package com.kurastream.app.feature.detail

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.kurastream.app.R
import com.kurastream.app.core.designsystem.component.*
import com.kurastream.app.core.designsystem.theme.*
import com.kurastream.app.core.model.Episode
import com.kurastream.app.core.model.ShowDetail
import com.kurastream.app.core.model.UiState
import com.kurastream.app.core.network.ServerUrlResolver

@Composable
fun ShowDetailScreen(
    viewModel: ShowDetailViewModel,
    onNavigateBack: () -> Unit,
    onNavigateToPlayer: (String) -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        containerColor = KuraColors.Background
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when (val state = uiState.detailState) {
                is UiState.Loading -> {
                    KuraLoadingView(message = "Cargando detalles…")
                }
                is UiState.Error -> {
                    KuraErrorView(message = state.message, onRetry = viewModel::loadDetails)
                }
                is UiState.Empty -> {
                    KuraEmptyView(message = state.message)
                }
                is UiState.Content, is UiState.Refreshing -> {
                    val detail = if (state is UiState.Content) state.data else (state as UiState.Refreshing).currentData
                    val show = detail.show
                    val backdropUrl = ServerUrlResolver.buildMediaUrl(uiState.baseUrl, show.backdropPath.ifBlank { show.posterPath })

                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(bottom = 60.dp)
                    ) {
                        // Header Backdrop & Overlay
                        item {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(300.dp)
                            ) {
                                AsyncImage(
                                    model = backdropUrl,
                                    contentDescription = show.title,
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.fillMaxSize()
                                )

                                Box(
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .background(
                                            Brush.verticalGradient(
                                                colors = listOf(
                                                    KuraColors.Background.copy(alpha = 0.6f),
                                                    Color.Transparent,
                                                    KuraColors.Background
                                                )
                                            )
                                        )
                                )

                                // Back & Favorite Actions in Top Bar
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .statusBarsPadding()
                                        .padding(horizontal = KuraDimens.Space4, vertical = KuraDimens.Space2),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    IconButton(
                                        onClick = onNavigateBack,
                                        modifier = Modifier
                                            .background(KuraColors.Background.copy(alpha = 0.6f), KuraShapes.Pill)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.ArrowBack,
                                            contentDescription = "Volver",
                                            tint = KuraColors.TextMain
                                        )
                                    }

                                    IconButton(
                                        onClick = viewModel::toggleFavorite,
                                        modifier = Modifier
                                            .background(KuraColors.Background.copy(alpha = 0.6f), KuraShapes.Pill)
                                    ) {
                                        Icon(
                                            imageVector = if (uiState.isFavorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                                            contentDescription = "Favorito",
                                            tint = if (uiState.isFavorite) KuraColors.Danger else KuraColors.TextMain
                                        )
                                    }
                                }
                            }
                        }

                        // Show Info Header
                        item {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = KuraDimens.Space4)
                            ) {
                                Text(
                                    text = show.title,
                                    style = MaterialTheme.typography.displayMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = KuraColors.TextMain
                                )

                                Spacer(modifier = Modifier.height(KuraDimens.Space2))

                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space2)
                                ) {
                                    KuraRatingBadge(rating = show.rating)
                                    if (show.year != null) {
                                        KuraBadge(text = show.year.toString())
                                    }
                                    KuraBadge(text = show.ageRating)
                                    if (show.isAiring) {
                                        KuraBadge(text = "En Emisión", isAccent = true)
                                    } else {
                                        KuraBadge(text = "Finalizado")
                                    }
                                }

                                if (show.genres.isNotBlank()) {
                                    Spacer(modifier = Modifier.height(KuraDimens.Space2))
                                    Text(
                                        text = show.genres,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = KuraColors.TextSecondary
                                    )
                                }

                                if (show.synopsis.isNotBlank()) {
                                    Spacer(modifier = Modifier.height(KuraDimens.Space3))
                                    Text(
                                        text = show.synopsis,
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = KuraColors.TextSecondary
                                    )
                                }

                                if (show.studio.isNotBlank() || show.director.isNotBlank()) {
                                    Spacer(modifier = Modifier.height(KuraDimens.Space2))
                                    Text(
                                        text = listOfNotNull(
                                            show.studio.ifBlank { null }?.let { "Estudio: $it" },
                                            show.director.ifBlank { null }?.let { "Director: $it" }
                                        ).joinToString(" • "),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = KuraColors.TextMuted
                                    )
                                }

                                Spacer(modifier = Modifier.height(KuraDimens.Space5))

                                // Main Play CTA
                                val resumeEp = uiState.resumeEpisode
                                if (resumeEp != null) {
                                    val isContinued = uiState.episodeProgressMap.containsKey(resumeEp.id)
                                    val buttonText = if (isContinued) {
                                        "Continuar Episodio ${resumeEp.episodeNumber}"
                                    } else {
                                        "Ver Episodio 1"
                                    }

                                    KuraButton(
                                        onClick = { onNavigateToPlayer(resumeEp.id) },
                                        modifier = Modifier.fillMaxWidth(),
                                        text = buttonText,
                                        leadingIcon = {
                                            Icon(imageVector = Icons.Default.PlayArrow, contentDescription = null)
                                        }
                                    )
                                }
                            }
                        }

                        // Season Selector
                        if (detail.seasons.size > 1) {
                            item {
                                Spacer(modifier = Modifier.height(KuraDimens.Space6))
                                Text(
                                    text = "Temporadas",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = KuraColors.TextMain,
                                    modifier = Modifier.padding(horizontal = KuraDimens.Space4, vertical = KuraDimens.Space2)
                                )
                                LazyRow(
                                    horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space2),
                                    contentPadding = PaddingValues(horizontal = KuraDimens.Space4)
                                ) {
                                    items(detail.seasons.keys.sorted()) { seasonNum ->
                                        FilterChip(
                                            selected = uiState.selectedSeason == seasonNum,
                                            onClick = { viewModel.selectSeason(seasonNum) },
                                            label = { Text("Temporada $seasonNum") },
                                            colors = FilterChipDefaults.filterChipColors(
                                                selectedContainerColor = KuraColors.PrimarySoft,
                                                selectedLabelColor = KuraColors.Primary,
                                                containerColor = KuraColors.SurfaceRaised,
                                                labelColor = KuraColors.TextSecondary
                                            ),
                                            border = FilterChipDefaults.filterChipBorder(
                                                borderColor = KuraColors.Border,
                                                selectedBorderColor = KuraColors.Primary,
                                                enabled = true,
                                                selected = uiState.selectedSeason == seasonNum
                                            )
                                        )
                                    }
                                }
                            }
                        }

                        // Episode List Section
                        item {
                            Spacer(modifier = Modifier.height(KuraDimens.Space5))
                            Text(
                                text = "Episodios",
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.SemiBold,
                                color = KuraColors.TextMain,
                                modifier = Modifier.padding(horizontal = KuraDimens.Space4, vertical = KuraDimens.Space2)
                            )
                        }

                        val currentSeasonEpisodes = detail.seasons[uiState.selectedSeason] ?: detail.episodes
                        items(currentSeasonEpisodes, key = { it.id }) { ep ->
                            val progress = uiState.episodeProgressMap[ep.id] ?: 0f
                            val isCompleted = ep.duration > 0 && progress >= (ep.duration * 0.9f)
                            val thumbUrl = ServerUrlResolver.buildMediaUrl(uiState.baseUrl, ep.thumbnailPath)

                            EpisodeListItem(
                                episode = ep,
                                thumbnailUrl = thumbUrl,
                                progressSeconds = progress,
                                isCompleted = isCompleted,
                                onClick = { onNavigateToPlayer(ep.id) },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = KuraDimens.Space4, vertical = KuraDimens.Space2)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EpisodeListItem(
    episode: Episode,
    thumbnailUrl: String,
    progressSeconds: Float,
    isCompleted: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val durationText = remember(episode.duration) {
        val mins = (episode.duration / 60).toInt()
        val secs = (episode.duration % 60).toInt()
        if (mins > 0) "${mins}m ${secs}s" else "${secs}s"
    }

    Row(
        modifier = modifier
            .clip(KuraShapes.Card)
            .background(KuraColors.Surface)
            .border(1.dp, KuraColors.Border, KuraShapes.Card)
            .clickable(onClick = onClick)
            .padding(KuraDimens.Space3),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Thumbnail 16:9
        Box(
            modifier = Modifier
                .size(width = 120.dp, height = 68.dp)
                .background(KuraColors.SurfaceRaised, KuraShapes.Control)
                .clip(KuraShapes.Control)
        ) {
            AsyncImage(
                model = thumbnailUrl,
                contentDescription = episode.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )

            if (episode.duration > 0 && progressSeconds > 5f) {
                val pct = (progressSeconds / episode.duration).coerceIn(0f, 1f)
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
                            .fillMaxWidth(pct)
                            .background(KuraColors.Primary)
                    )
                }
            }

            if (isCompleted) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(4.dp)
                        .background(KuraColors.Background.copy(alpha = 0.7f), KuraShapes.Pill)
                ) {
                    Icon(
                        imageVector = Icons.Default.CheckCircle,
                        contentDescription = "Visto",
                        tint = KuraColors.Success,
                        modifier = Modifier.size(16.dp)
                    )
                }
            }
        }

        Spacer(modifier = Modifier.width(KuraDimens.Space3))

        // Episode Info
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "${episode.episodeNumber}. ${episode.title.ifBlank { "Episodio ${episode.episodeNumber}" }}",
                style = MaterialTheme.typography.titleMedium,
                color = KuraColors.TextMain,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )

            Spacer(modifier = Modifier.height(2.dp))

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space2)
            ) {
                Text(
                    text = durationText,
                    style = MaterialTheme.typography.labelSmall,
                    color = KuraColors.TextMuted
                )
                if (episode.resolution.isNotBlank()) {
                    Text(
                        text = "• ${episode.resolution}",
                        style = MaterialTheme.typography.labelSmall,
                        color = KuraColors.TextMuted
                    )
                }
            }

            if (episode.synopsis.isNotBlank()) {
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = episode.synopsis,
                    style = MaterialTheme.typography.bodyMedium,
                    color = KuraColors.TextSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}
