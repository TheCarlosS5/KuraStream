@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package com.kurastream.app.feature.detail

import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.animation.animateContentSize
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
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
import com.kurastream.app.core.model.SeasonInfo
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

    val haptics = LocalHapticFeedback.current
    val lifecycleOwner = LocalLifecycleOwner.current

    // Refresh history when returning from player
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                viewModel.refreshHistory()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    Scaffold(
        containerColor = KuraColors.Background,
        // Edge-to-edge hero: the backdrop runs under the status bar; the back/favorite row
        // already applies statusBarsPadding().
        contentWindowInsets = WindowInsets(0)
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
                    // The selected season's own banner/synopsis/year (the show's art is its latest season's).
                    val season = detail.seasonInfo[uiState.selectedSeason]
                    val backdropUrl = ServerUrlResolver.buildMediaUrl(
                        uiState.baseUrl,
                        season?.backdropPath?.ifBlank { null } ?: show.backdropPath.ifBlank { show.posterPath }
                    )
                    val synopsis = season?.synopsis?.ifBlank { null } ?: show.synopsis
                    val year = season?.year ?: show.year
                    val isAiring = season?.status?.equals("airing", ignoreCase = true) ?: show.isAiring

                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + 24.dp
                        )
                    ) {
                        // Header Backdrop & Overlay
                        item {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(300.dp)
                            ) {
                                KuraAsyncImage(
                                    model = backdropUrl,
                                    contentDescription = show.title,
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
                                            contentDescription = stringResource(R.string.back),
                                            tint = KuraColors.TextMain
                                        )
                                    }

                                    IconButton(
                                        onClick = {
                                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                            viewModel.toggleFavorite()
                                        },
                                        modifier = Modifier
                                            .background(KuraColors.Background.copy(alpha = 0.6f), KuraShapes.Pill)
                                    ) {
                                        Icon(
                                            imageVector = if (uiState.isFavorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                                            contentDescription = stringResource(R.string.favorite),
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
                                if (detail.seasons.size > 1) {
                                    Text(
                                        text = listOfNotNull(
                                            seasonLabel(uiState.selectedSeason),
                                            season?.title?.takeIf { it.isNotBlank() && it != show.title }
                                        ).joinToString(" · "),
                                        style = MaterialTheme.typography.labelLarge,
                                        fontWeight = FontWeight.SemiBold,
                                        color = KuraColors.Primary,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Spacer(modifier = Modifier.height(KuraDimens.Space1))
                                }
                                Text(
                                    text = show.title,
                                    style = MaterialTheme.typography.displayMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = KuraColors.TextMain,
                                    maxLines = 3,
                                    overflow = TextOverflow.Ellipsis
                                )

                                Spacer(modifier = Modifier.height(KuraDimens.Space2))

                                // Wraps instead of running off narrow screens; blank fields get no empty pill
                                FlowRow(
                                    horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space2),
                                    verticalArrangement = Arrangement.spacedBy(KuraDimens.Space2)
                                ) {
                                    KuraRatingBadge(rating = show.rating)
                                    if (year != null) {
                                        KuraBadge(text = year.toString())
                                    }
                                    if (show.ageRating.isNotBlank()) {
                                        KuraBadge(text = show.ageRating)
                                    }
                                    if (isAiring) {
                                        KuraBadge(text = stringResource(R.string.airing), isAccent = true)
                                    } else {
                                        KuraBadge(text = stringResource(R.string.finished))
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

                                if (synopsis.isNotBlank()) {
                                    Spacer(modifier = Modifier.height(KuraDimens.Space3))
                                    // Long synopses used to push the episode list off screen
                                    var synopsisExpanded by rememberSaveable(show.id, uiState.selectedSeason) { mutableStateOf(false) }
                                    var hasVisualOverflow by remember(uiState.selectedSeason) { mutableStateOf(false) }
                                    Text(
                                        text = synopsis,
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = KuraColors.TextSecondary,
                                        maxLines = if (synopsisExpanded) Int.MAX_VALUE else 4,
                                        overflow = TextOverflow.Ellipsis,
                                        onTextLayout = { textLayoutResult ->
                                            if (textLayoutResult.hasVisualOverflow) {
                                                hasVisualOverflow = true
                                            }
                                        },
                                        modifier = Modifier.animateContentSize()
                                    )
                                    if (hasVisualOverflow || synopsisExpanded) {
                                        TextButton(
                                            onClick = { synopsisExpanded = !synopsisExpanded },
                                            contentPadding = PaddingValues(0.dp)
                                        ) {
                                            Text(
                                                text = if (synopsisExpanded) "Ver menos" else "Ver más",
                                                style = MaterialTheme.typography.labelLarge,
                                                color = KuraColors.Primary
                                            )
                                        }
                                    }
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
                                    val hasProgress = uiState.episodeProgressMap[resumeEp.id]?.let { it > 5f } == true
                                    val isCompleted = uiState.episodeCompletedMap[resumeEp.id] == true
                                    val buttonText = if (hasProgress && !isCompleted) {
                                        "Continuar T${resumeEp.seasonNumber}:E${resumeEp.episodeNumber}"
                                    } else {
                                        "Reproducir T${resumeEp.seasonNumber}:E${resumeEp.episodeNumber}"
                                    }

                                    KuraButton(
                                        onClick = {
                                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                            onNavigateToPlayer(resumeEp.id)
                                        },
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
                                    text = stringResource(R.string.seasons),
                                    style = MaterialTheme.typography.titleMedium,
                                    color = KuraColors.TextMain,
                                    modifier = Modifier.padding(horizontal = KuraDimens.Space4, vertical = KuraDimens.Space2)
                                )
                                val withPosters = detail.seasonInfo.values.any { it.posterPath.isNotBlank() }
                                LazyRow(
                                    horizontalArrangement = Arrangement.spacedBy(if (withPosters) KuraDimens.Space3 else KuraDimens.Space2),
                                    contentPadding = PaddingValues(horizontal = KuraDimens.Space4)
                                ) {
                                    items(detail.orderedSeasons) { seasonNum ->
                                        if (withPosters) {
                                            val seasonEpisodes = detail.seasons[seasonNum].orEmpty()
                                            SeasonPosterCard(
                                                seasonNumber = seasonNum,
                                                order = detail.orderedSeasons.filter { it > 0 }.indexOf(seasonNum) + 1,
                                                info = detail.seasonInfo[seasonNum],
                                                fallbackPoster = show.posterPath,
                                                baseUrl = uiState.baseUrl,
                                                episodeCount = seasonEpisodes.size,
                                                watchedCount = seasonEpisodes.count { uiState.episodeCompletedMap[it.id] == true },
                                                selected = uiState.selectedSeason == seasonNum,
                                                onClick = { viewModel.selectSeason(seasonNum) }
                                            )
                                        } else {
                                            FilterChip(
                                                selected = uiState.selectedSeason == seasonNum,
                                                onClick = { viewModel.selectSeason(seasonNum) },
                                                label = { Text(seasonLabel(seasonNum)) },
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
                            val isCompleted = uiState.episodeCompletedMap[ep.id] ?: (ep.duration > 0 && progress >= (ep.duration * 0.9f))
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

                        item {
                            CommentsSection(
                                state = uiState,
                                onOpen = viewModel::loadComments,
                                onDraftChange = viewModel::onCommentDraftChanged,
                                onPost = viewModel::postComment,
                                onDelete = viewModel::deleteComment,
                                modifier = Modifier.padding(horizontal = KuraDimens.Space4, vertical = KuraDimens.Space4)
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Comments of the show: opened on demand, post as the active profile, delete your own. */
@Composable
private fun CommentsSection(
    state: ShowDetailUiState,
    onOpen: () -> Unit,
    onDraftChange: (String) -> Unit,
    onPost: () -> Unit,
    onDelete: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(KuraDimens.Space2)) {
        Row(
            modifier = Modifier.fillMaxWidth().clickable {
                expanded = !expanded
                if (expanded && !state.commentsLoaded) onOpen()
            },
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = if (state.commentsLoaded) "Comentarios (${state.comments.size})" else "Comentarios",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
                color = KuraColors.TextMain,
                modifier = Modifier.weight(1f)
            )
            Text(if (expanded) "Ocultar" else "Ver", color = KuraColors.TextSecondary)
        }
        if (!expanded) return@Column

        OutlinedTextField(
            value = state.commentDraft,
            onValueChange = onDraftChange,
            label = { Text("Escribe un comentario") },
            modifier = Modifier.fillMaxWidth(),
            minLines = 2,
            supportingText = { Text("${state.commentDraft.length}/1000") }
        )
        Button(onClick = onPost, enabled = state.commentDraft.isNotBlank() && !state.isPostingComment) {
            Text(if (state.isPostingComment) "Publicando…" else "Publicar")
        }
        state.commentsError?.let {
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        }
        when {
            state.commentsLoading && !state.commentsLoaded -> CircularProgressIndicator()
            state.commentsLoaded && state.comments.isEmpty() ->
                Text("No hay comentarios todavía. ¡Sé el primero!", color = KuraColors.TextSecondary)
            else -> state.comments.forEach { c ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(KuraColors.Surface, KuraShapes.Card)
                        .padding(KuraDimens.Space3)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = c.profileName.ifBlank { "Usuario" },
                            fontWeight = FontWeight.SemiBold,
                            color = KuraColors.TextMain,
                            modifier = Modifier.weight(1f)
                        )
                        Text(
                            text = com.kurastream.app.core.util.RelativeTime.format(c.createdAt),
                            style = MaterialTheme.typography.labelSmall,
                            color = KuraColors.TextMuted
                        )
                    }
                    Text(c.content, color = KuraColors.TextSecondary, style = MaterialTheme.typography.bodyMedium)
                    if (c.canDelete) {
                        TextButton(onClick = { onDelete(c.id) }) { Text("Eliminar") }
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
            KuraAsyncImage(
                model = thumbnailUrl,
                contentDescription = episode.title,
                modifier = Modifier.fillMaxSize()
            )

            // Netflix-style bar inset over the thumbnail; finished episodes show a full bar even when
            // the server kept little progress for them.
            if (isCompleted || (episode.duration > 0 && progressSeconds > 5f)) {
                val pct = if (episode.duration > 0) (progressSeconds / episode.duration).coerceIn(0f, 1f) else 0f
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .fillMaxWidth()
                        .padding(horizontal = 6.dp, vertical = 5.dp)
                        .height(3.dp)
                        .clip(KuraShapes.Pill)
                        .background(Color.White.copy(alpha = 0.3f))
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxHeight()
                            .fillMaxWidth(if (isCompleted) 1f else pct)
                            .background(if (isCompleted) KuraColors.Success else KuraColors.Primary)
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
                        contentDescription = stringResource(R.string.watched),
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
                // Watched episodes step back so the next one stands out
                color = if (isCompleted) KuraColors.TextSecondary else KuraColors.TextMain,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )

            Spacer(modifier = Modifier.height(2.dp))

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space2)
            ) {
                val remainingMin = ((episode.duration - progressSeconds) / 60f).toInt()
                Text(
                    text = when {
                        isCompleted -> "Visto"
                        episode.duration > 0 && progressSeconds > 5f && remainingMin > 0 -> "Quedan $remainingMin min"
                        else -> durationText
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = when {
                        isCompleted -> KuraColors.Success
                        progressSeconds > 5f -> KuraColors.Primary
                        else -> KuraColors.TextMuted
                    }
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

private fun seasonLabel(seasonNumber: Int): String =
    if (seasonNumber <= 0) "Especiales" else "Temporada $seasonNumber"

/** One season in watch order: its own poster, number, year/episode count and watched progress. */
@Composable
private fun SeasonPosterCard(
    seasonNumber: Int,
    order: Int,
    info: SeasonInfo?,
    fallbackPoster: String,
    baseUrl: String,
    episodeCount: Int,
    watchedCount: Int,
    selected: Boolean,
    onClick: () -> Unit
) {
    val posterUrl = ServerUrlResolver.buildMediaUrl(baseUrl, info?.posterPath?.ifBlank { null } ?: fallbackPoster)
    val progress = if (episodeCount > 0) watchedCount.toFloat() / episodeCount else 0f
    Column(
        modifier = Modifier
            .width(108.dp)
            .clip(KuraShapes.Card)
            .clickable(onClick = onClick)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .clip(KuraShapes.Card)
                .border(
                    width = 2.dp,
                    color = if (selected) KuraColors.Primary else KuraColors.Border,
                    shape = KuraShapes.Card
                )
        ) {
            KuraAsyncImage(
                model = posterUrl,
                contentDescription = seasonLabel(seasonNumber),
                modifier = Modifier.fillMaxSize()
            )
            if (!selected) {
                Box(modifier = Modifier.fillMaxSize().background(KuraColors.Background.copy(alpha = 0.3f)))
            }
            if (seasonNumber > 0) {
                Box(
                    modifier = Modifier
                        .padding(6.dp)
                        .size(24.dp)
                        .background(if (selected) KuraColors.Primary else KuraColors.Background.copy(alpha = 0.85f), KuraShapes.Pill),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = order.toString(),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        color = if (selected) KuraColors.Background else KuraColors.TextMain
                    )
                }
            }
            if (progress >= 1f) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(6.dp)
                        .size(24.dp)
                        .background(KuraColors.Success, KuraShapes.Pill),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.Check, contentDescription = "Vista", tint = KuraColors.Background, modifier = Modifier.size(16.dp))
                }
            } else if (progress > 0f) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .fillMaxWidth()
                        .height(4.dp)
                        .background(Color.White.copy(alpha = 0.22f))
                ) {
                    Box(modifier = Modifier.fillMaxHeight().fillMaxWidth(progress).background(KuraColors.Primary))
                }
            }
        }
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = seasonLabel(seasonNumber),
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
            color = if (selected) KuraColors.TextMain else KuraColors.TextSecondary,
            maxLines = 1
        )
        Text(
            text = listOfNotNull(info?.year?.toString(), "$episodeCount cap.").joinToString(" · "),
            style = MaterialTheme.typography.labelSmall,
            color = KuraColors.TextMuted,
            maxLines = 1
        )
    }
}
