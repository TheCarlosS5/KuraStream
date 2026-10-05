package com.kurastream.app.feature.home

import kotlinx.coroutines.delay
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
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
import com.kurastream.app.core.model.Show
import com.kurastream.app.core.model.WatchHistoryItem
import com.kurastream.app.core.model.UiState
import com.kurastream.app.core.network.ServerUrlResolver

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    onNavigateToShowDetail: (String) -> Unit,
    onNavigateToPlayer: (String) -> Unit,
    onNavigateToWatchParty: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    val notifications by viewModel.notifications.collectAsState()
    val unreadCount by viewModel.unreadCount.collectAsState()

    var showNotificationsSheet by remember { mutableStateOf(false) }
    val lifecycleOwner = LocalLifecycleOwner.current

    // Refresh continue watching when returning from player
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                viewModel.refreshContinueWatching()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "KuraStream",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = KuraColors.Primary
                    )
                },
                actions = {
                    // Watch Party Contextual Shortcut
                    IconButton(onClick = onNavigateToWatchParty) {
                        Icon(
                            imageVector = Icons.Default.Groups,
                            contentDescription = "Watch Party",
                            tint = KuraColors.TextMain
                        )
                    }

                    // In-App Notifications Feed
                    IconButton(onClick = {
                        showNotificationsSheet = true
                        viewModel.loadNotifications()
                    }) {
                        BadgedBox(
                            badge = {
                                if (unreadCount > 0) {
                                    Badge(
                                        containerColor = KuraColors.Danger,
                                        contentColor = Color.White
                                    ) {
                                        Text("$unreadCount")
                                    }
                                }
                            }
                        ) {
                            Icon(
                                imageVector = Icons.Default.Notifications,
                                contentDescription = "Notificaciones",
                                tint = KuraColors.TextMain
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = KuraColors.Background.copy(alpha = 0.95f),
                    titleContentColor = KuraColors.Primary
                )
            )
        },
        containerColor = KuraColors.Background
    ) { padding ->
        // Pull down to re-fetch catalog/history (e.g. after adding new episodes on the server)
        PullToRefreshBox(
            isRefreshing = (uiState as? UiState.Content)?.data?.isRefreshing == true,
            onRefresh = viewModel::refresh,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when (val state = uiState) {
                is UiState.Loading -> {
                    HomeSkeleton()
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
                        // Billboard Hero Section (carousel when there are several candidates)
                        val heroes = feed.heroShows.ifEmpty { listOfNotNull(feed.heroShow) }
                        if (heroes.isNotEmpty()) {
                            item {
                                HeroCarousel(
                                    shows = heroes,
                                    baseUrl = feed.baseUrl,
                                    resumeByShow = feed.continueWatching.associateBy { it.showId },
                                    onPlayClick = { showId ->
                                        viewModel.playShow(
                                            showId = showId,
                                            onEpisode = onNavigateToPlayer,
                                            onFallback = { onNavigateToShowDetail(showId) }
                                        )
                                    },
                                    onShowClick = onNavigateToShowDetail
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
                                        // Episodes without a generated thumbnail fall back to the show artwork
                                        val artwork = item.thumbnailPath.ifBlank { item.backdropPath.ifBlank { item.posterPath } }
                                        val thumbUrl = ServerUrlResolver.buildMediaUrl(feed.baseUrl, artwork)
                                        var menuOpen by remember { mutableStateOf(false) }
                                        Box {
                                            ContinueWatchingCard(
                                                item = item,
                                                thumbnailUrl = thumbUrl,
                                                onClick = { onNavigateToPlayer(item.episodeId) },
                                                onLongClick = { menuOpen = true }
                                            )
                                            DropdownMenu(
                                                expanded = menuOpen,
                                                onDismissRequest = { menuOpen = false },
                                                containerColor = KuraColors.SurfaceRaised
                                            ) {
                                                DropdownMenuItem(
                                                    text = { Text("Ver detalles de la serie") },
                                                    leadingIcon = { Icon(Icons.Default.Info, contentDescription = null) },
                                                    onClick = {
                                                        menuOpen = false
                                                        onNavigateToShowDetail(item.showId)
                                                    },
                                                    enabled = item.showId.isNotBlank()
                                                )
                                                DropdownMenuItem(
                                                    text = { Text("Quitar de Continuar viendo") },
                                                    leadingIcon = { Icon(Icons.Default.RemoveCircleOutline, contentDescription = null) },
                                                    onClick = {
                                                        menuOpen = false
                                                        viewModel.removeFromContinueWatching(item.episodeId)
                                                    }
                                                )
                                            }
                                        }
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

        // In-App Notifications Modal Bottom Sheet
        if (showNotificationsSheet) {
            ModalBottomSheet(
                onDismissRequest = {
                    showNotificationsSheet = false
                    viewModel.markNotificationsSeen()
                },
                containerColor = KuraColors.Surface,
                dragHandle = { BottomSheetDefaults.DragHandle(color = KuraColors.Border) }
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = KuraDimens.Space5, vertical = KuraDimens.Space3)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Notificaciones",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = KuraColors.TextMain
                        )
                        if (unreadCount > 0) {
                            TextButton(onClick = viewModel::markNotificationsSeen) {
                                Text("Marcar vistas", color = KuraColors.Primary)
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(KuraDimens.Space3))

                    if (notifications.isEmpty()) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = KuraDimens.Space6),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = "No tienes notificaciones pendientes",
                                style = MaterialTheme.typography.bodyMedium,
                                color = KuraColors.TextMuted
                            )
                        }
                    } else {
                        LazyColumn(
                            verticalArrangement = Arrangement.spacedBy(KuraDimens.Space3),
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(max = 400.dp)
                        ) {
                            items(notifications, key = { it.id }) { notif ->
                                Surface(
                                    shape = KuraShapes.Card,
                                    color = if (notif.isRead) KuraColors.SurfaceRaised else KuraColors.SurfaceHover,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            showNotificationsSheet = false
                                            viewModel.markNotificationsSeen()
                                            if (!notif.showId.isNullOrBlank()) {
                                                onNavigateToShowDetail(notif.showId)
                                            } else if (!notif.episodeId.isNullOrBlank()) {
                                                onNavigateToPlayer(notif.episodeId)
                                            }
                                        }
                                ) {
                                    Row(
                                        modifier = Modifier.padding(KuraDimens.Space4),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        if (!notif.isRead) {
                                            Box(
                                                modifier = Modifier
                                                    .size(8.dp)
                                                    .clip(CircleShape)
                                                    .background(KuraColors.Primary)
                                            )
                                            Spacer(modifier = Modifier.width(KuraDimens.Space3))
                                        }
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(
                                                text = notif.title,
                                                style = MaterialTheme.typography.titleMedium,
                                                fontWeight = FontWeight.SemiBold,
                                                color = KuraColors.TextMain
                                            )
                                            Spacer(modifier = Modifier.height(KuraDimens.Space1))
                                            Text(
                                                text = notif.message,
                                                style = MaterialTheme.typography.bodyMedium,
                                                color = KuraColors.TextSecondary
                                            )
                                            if (notif.createdAt.isNotBlank()) {
                                                Spacer(modifier = Modifier.height(KuraDimens.Space1))
                                                Text(
                                                    text = com.kurastream.app.core.util.RelativeTime.format(notif.createdAt),
                                                    style = MaterialTheme.typography.labelSmall,
                                                    color = KuraColors.TextMuted
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(KuraDimens.Space4))
                }
            }
        }
    }
}

@Composable
private fun HeroCarousel(
    shows: List<Show>,
    baseUrl: String,
    resumeByShow: Map<String, WatchHistoryItem>,
    onPlayClick: (String) -> Unit,
    onShowClick: (String) -> Unit
) {
    val pagerState = rememberPagerState(pageCount = { shows.size })
    if (shows.size > 1) {
        // Advance every 7s; keyed on the settled page so a manual swipe restarts the timer
        LaunchedEffect(pagerState.settledPage, shows.size) {
            while (true) {
                delay(7_000)
                if (!pagerState.isScrollInProgress) {
                    pagerState.animateScrollToPage((pagerState.settledPage + 1) % shows.size)
                }
            }
        }
    }
    Column {
        HorizontalPager(state = pagerState, key = { shows[it].id }) { page ->
            val show = shows[page]
            BillboardHero(
                show = show,
                baseUrl = baseUrl,
                resume = resumeByShow[show.id],
                onPlayClick = { onPlayClick(show.id) },
                onInfoClick = { onShowClick(show.id) }
            )
        }
        if (shows.size > 1) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = KuraDimens.Space2),
                horizontalArrangement = Arrangement.Center
            ) {
                repeat(shows.size) { index ->
                    val selected = pagerState.currentPage == index
                    val width by animateDpAsState(if (selected) 18.dp else 6.dp, label = "heroDot")
                    Box(
                        modifier = Modifier
                            .padding(horizontal = 3.dp)
                            .height(6.dp)
                            .width(width)
                            .clip(CircleShape)
                            .background(if (selected) KuraColors.Primary else KuraColors.Border)
                    )
                }
            }
        }
    }
}

/** Layout-shaped placeholder while the catalog loads (cheaper and calmer than a spinner). */
@Composable
private fun HomeSkeleton() {
    val pulse = rememberInfiniteTransition(label = "skeleton")
    val alpha by pulse.animateFloat(
        initialValue = 0.45f,
        targetValue = 0.9f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "skeletonAlpha"
    )
    Column(
        modifier = Modifier
            .fillMaxSize()
            .graphicsLayer { this.alpha = alpha }
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(380.dp)
                .background(KuraColors.SurfaceRaised)
        )
        repeat(2) {
            Spacer(modifier = Modifier.height(KuraDimens.Space5))
            Box(
                modifier = Modifier
                    .padding(horizontal = KuraDimens.Space4)
                    .width(160.dp)
                    .height(20.dp)
                    .clip(KuraShapes.Small)
                    .background(KuraColors.SurfaceRaised)
            )
            Spacer(modifier = Modifier.height(KuraDimens.Space3))
            Row(
                modifier = Modifier.padding(horizontal = KuraDimens.Space4),
                horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space3)
            ) {
                repeat(4) {
                    Box(
                        modifier = Modifier
                            .width(KuraDimens.PosterWidth)
                            .height(KuraDimens.PosterHeight)
                            .clip(KuraShapes.Card)
                            .background(KuraColors.SurfaceRaised)
                    )
                }
            }
        }
    }
}

@Composable
private fun BillboardHero(
    show: Show,
    baseUrl: String,
    resume: WatchHistoryItem?,
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
        KuraAsyncImage(
            model = backdropUrl,
            contentDescription = show.title,
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
                    text = if (resume != null) {
                        "Continuar T${resume.seasonNumber}:E${resume.episodeNumber}"
                    } else {
                        stringResource(R.string.play)
                    },
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
