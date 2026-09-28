package com.kurastream.app.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import com.kurastream.app.core.model.Show
import com.kurastream.app.core.model.UiState
import com.kurastream.app.core.network.ServerUrlResolver

@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    onNavigateToShowDetail: (String) -> Unit,
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
            when (val state = uiState) {
                is UiState.Loading -> {
                    KuraLoadingView(message = "Cargando catálogo…")
                }
                is UiState.Error -> {
                    KuraErrorView(
                        message = state.message,
                        onRetry = viewModel::loadHomeData
                    )
                }
                is UiState.Empty -> {
                    KuraEmptyView(message = state.message)
                }
                is UiState.Content, is UiState.Refreshing -> {
                    val feed = if (state is UiState.Content) state.data else (state as UiState.Refreshing).currentData

                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(bottom = 80.dp)
                    ) {
                        // Billboard Hero Section
                        if (feed.heroShow != null) {
                            item {
                                BillboardHero(
                                    show = feed.heroShow,
                                    baseUrl = feed.baseUrl,
                                    onPlayClick = {
                                        // For hero play, navigate to show detail where first or next episode is resolved
                                        onNavigateToShowDetail(feed.heroShow.id)
                                    },
                                    onInfoClick = { onNavigateToShowDetail(feed.heroShow.id) }
                                )
                            }
                        }

                        // Continue Watching Rail
                        if (feed.continueWatching.isNotEmpty()) {
                            item {
                                RailHeader(title = stringResource(R.string.continue_watching))
                                LazyRow(
                                    horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space3),
                                    contentPadding = PaddingValues(horizontal = KuraDimens.Space4)
                                ) {
                                    items(feed.continueWatching, key = { it.episodeId }) { item ->
                                        val thumbUrl = ServerUrlResolver.buildMediaUrl(feed.baseUrl, item.thumbnailPath)
                                        ContinueWatchingCard(
                                            item = item,
                                            thumbnailUrl = thumbUrl,
                                            onClick = { onNavigateToPlayer(item.episodeId) }
                                        )
                                    }
                                }
                            }
                        }

                        // Recently Added Rail
                        if (feed.recentlyAdded.isNotEmpty()) {
                            item {
                                RailHeader(title = stringResource(R.string.recently_added))
                                ShowsRail(
                                    shows = feed.recentlyAdded,
                                    baseUrl = feed.baseUrl,
                                    onShowClick = onNavigateToShowDetail
                                )
                            }
                        }

                        // Airing Now Rail
                        if (feed.airingList.isNotEmpty()) {
                            item {
                                RailHeader(title = stringResource(R.string.airing_now))
                                ShowsRail(
                                    shows = feed.airingList,
                                    baseUrl = feed.baseUrl,
                                    onShowClick = onNavigateToShowDetail
                                )
                            }
                        }

                        // Anime Rail
                        if (feed.animeList.isNotEmpty()) {
                            item {
                                RailHeader(title = stringResource(R.string.anime))
                                ShowsRail(
                                    shows = feed.animeList,
                                    baseUrl = feed.baseUrl,
                                    onShowClick = onNavigateToShowDetail
                                )
                            }
                        }

                        // Movies Rail
                        if (feed.movieList.isNotEmpty()) {
                            item {
                                RailHeader(title = stringResource(R.string.movies))
                                ShowsRail(
                                    shows = feed.movieList,
                                    baseUrl = feed.baseUrl,
                                    onShowClick = onNavigateToShowDetail
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BillboardHero(
    show: Show,
    baseUrl: String,
    onPlayClick: () -> Unit,
    onInfoClick: () -> Unit
) {
    val backdropUrl = remember(show.backdropPath, baseUrl) {
        val path = show.backdropPath.ifBlank { show.posterPath }
        ServerUrlResolver.buildMediaUrl(baseUrl, path)
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(380.dp)
            .background(KuraColors.SurfaceRaised)
    ) {
        AsyncImage(
            model = backdropUrl,
            contentDescription = show.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize()
        )

        // Vignette Gradients for Legibility (Top subtle shadow, bottom nocturnal fade)
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        colors = listOf(
                            KuraColors.Background.copy(alpha = 0.5f),
                            Color.Transparent,
                            KuraColors.Background.copy(alpha = 0.85f),
                            KuraColors.Background
                        )
                    )
                )
        )

        // Content Info
        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .padding(horizontal = KuraDimens.Space4, vertical = KuraDimens.Space4)
        ) {
            Text(
                text = show.title,
                style = MaterialTheme.typography.displayMedium,
                fontWeight = FontWeight.Bold,
                color = KuraColors.TextMain,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
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
                if (show.isAiring) {
                    KuraBadge(text = "En Emisión", isAccent = true)
                } else {
                    KuraBadge(text = "Finalizado")
                }
            }

            if (show.synopsis.isNotBlank()) {
                Spacer(modifier = Modifier.height(KuraDimens.Space2))
                Text(
                    text = show.synopsis,
                    style = MaterialTheme.typography.bodyMedium,
                    color = KuraColors.TextSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }

            Spacer(modifier = Modifier.height(KuraDimens.Space4))

            Row(
                horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space3)
            ) {
                KuraButton(
                    onClick = onPlayClick,
                    text = stringResource(R.string.play),
                    leadingIcon = {
                        Icon(imageVector = Icons.Default.PlayArrow, contentDescription = null)
                    }
                )
                KuraOutlinedButton(
                    onClick = onInfoClick,
                    text = stringResource(R.string.more_info),
                    leadingIcon = {
                        Icon(imageVector = Icons.Default.Info, contentDescription = null)
                    }
                )
            }
        }
    }
}

@Composable
private fun RailHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleLarge,
        fontWeight = FontWeight.SemiBold,
        color = KuraColors.TextMain,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = KuraDimens.Space4)
            .padding(top = KuraDimens.Space6, bottom = KuraDimens.Space2)
    )
}

@Composable
private fun ShowsRail(
    shows: List<Show>,
    baseUrl: String,
    onShowClick: (String) -> Unit
) {
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space3),
        contentPadding = PaddingValues(horizontal = KuraDimens.Space4)
    ) {
        items(shows, key = { it.id }) { show ->
            val posterUrl = ServerUrlResolver.buildMediaUrl(baseUrl, show.posterPath)
            ShowPosterCard(
                show = show,
                imageUrl = posterUrl,
                onClick = { onShowClick(show.id) }
            )
        }
    }
}
