package com.kurastream.app.feature.explore

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
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
import com.kurastream.app.core.model.CalendarItem
import com.kurastream.app.core.model.Show
import com.kurastream.app.core.model.UiState
import com.kurastream.app.core.network.ServerUrlResolver

@Composable
fun ExploreScreen(
    viewModel: ExploreViewModel,
    onNavigateToShowDetail: (String) -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        containerColor = KuraColors.Background
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Prominent Search Bar & Surprise Button
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = KuraDimens.Space4, vertical = KuraDimens.Space3),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = uiState.searchQuery,
                    onValueChange = viewModel::onSearchQueryChanged,
                    modifier = Modifier.weight(1f),
                    placeholder = {
                        Text(
                            text = stringResource(R.string.search_hint),
                            style = MaterialTheme.typography.bodyMedium,
                            color = KuraColors.TextMuted
                        )
                    },
                    leadingIcon = {
                        Icon(
                            imageVector = Icons.Default.Search,
                            contentDescription = null,
                            tint = KuraColors.TextSecondary
                        )
                    },
                    trailingIcon = {
                        if (uiState.searchQuery.isNotBlank()) {
                            IconButton(onClick = { viewModel.onSearchQueryChanged("") }) {
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

                Spacer(modifier = Modifier.width(KuraDimens.Space2))

                IconButton(
                    onClick = { viewModel.surpriseMe(onNavigateToShowDetail) },
                    modifier = Modifier
                        .size(48.dp)
                        .background(KuraColors.SurfaceRaised, KuraShapes.Control)
                        .border(1.dp, KuraColors.Border, KuraShapes.Control)
                ) {
                    Icon(
                        imageVector = Icons.Default.AutoAwesome,
                        contentDescription = stringResource(R.string.surprise_me),
                        tint = KuraColors.Rating
                    )
                }
            }

            // Tabs: Catálogo / Calendario
            TabRow(
                selectedTabIndex = uiState.activeTab.ordinal,
                containerColor = KuraColors.Background,
                contentColor = KuraColors.Primary,
                divider = { HorizontalDivider(color = KuraColors.Border) }
            ) {
                Tab(
                    selected = uiState.activeTab == ExploreTab.CATALOG,
                    onClick = { viewModel.setTab(ExploreTab.CATALOG) },
                    text = { Text("Catálogo", fontWeight = FontWeight.SemiBold) }
                )
                Tab(
                    selected = uiState.activeTab == ExploreTab.CALENDAR,
                    onClick = { viewModel.setTab(ExploreTab.CALENDAR) },
                    text = { Text("Calendario Semanal", fontWeight = FontWeight.SemiBold) }
                )
            }

            when (uiState.activeTab) {
                ExploreTab.CATALOG -> {
                    // Filters Row
                    LazyRow(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = KuraDimens.Space2),
                        horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space2),
                        contentPadding = PaddingValues(horizontal = KuraDimens.Space4)
                    ) {
                        // Type filter
                        items(TypeFilter.entries) { type ->
                            FilterChip(
                                selected = uiState.typeFilter == type,
                                onClick = { viewModel.setTypeFilter(type) },
                                label = { Text(type.label) },
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
                                    selected = uiState.typeFilter == type
                                )
                            )
                        }

                        // Status filter
                        items(StatusFilter.entries) { status ->
                            if (status != StatusFilter.ALL) {
                                FilterChip(
                                    selected = uiState.statusFilter == status,
                                    onClick = { viewModel.setStatusFilter(status) },
                                    label = { Text(status.label) },
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
                                        selected = uiState.statusFilter == status
                                    )
                                )
                            }
                        }

                        // Genres
                        items(uiState.availableGenres) { genre ->
                            FilterChip(
                                selected = uiState.selectedGenre == genre,
                                onClick = { viewModel.setGenreFilter(genre) },
                                label = { Text(genre) },
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
                                    selected = uiState.selectedGenre == genre
                                )
                            )
                        }
                    }

                    // Catalog Grid
                    Box(modifier = Modifier.fillMaxSize()) {
                        when (val state = uiState.catalogState) {
                            is UiState.Loading -> {
                                KuraLoadingView(message = "Buscando en catálogo…")
                            }
                            is UiState.Error -> {
                                KuraErrorView(message = state.message, onRetry = viewModel::loadData)
                            }
                            is UiState.Empty -> {
                                KuraEmptyView(message = state.message)
                            }
                            is UiState.Content, is UiState.Refreshing -> {
                                val shows = if (state is UiState.Content) state.data else (state as UiState.Refreshing).currentData
                                LazyVerticalGrid(
                                    columns = GridCells.Adaptive(minSize = KuraDimens.PosterWidth),
                                    horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space3),
                                    verticalArrangement = Arrangement.spacedBy(KuraDimens.Space4),
                                    contentPadding = PaddingValues(KuraDimens.Space4),
                                    modifier = Modifier.fillMaxSize()
                                ) {
                                    items(shows, key = { it.id }) { show ->
                                        val posterUrl = ServerUrlResolver.buildMediaUrl(uiState.baseUrl, show.posterPath)
                                        ShowPosterCard(
                                            show = show,
                                            imageUrl = posterUrl,
                                            onClick = { onNavigateToShowDetail(show.id) }
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                ExploreTab.CALENDAR -> {
                    // Weekly Calendar Tab
                    Box(modifier = Modifier.fillMaxSize()) {
                        when (val state = uiState.calendarState) {
                            is UiState.Loading -> {
                                KuraLoadingView(message = "Cargando calendario…")
                            }
                            is UiState.Error -> {
                                KuraErrorView(message = state.message, onRetry = { viewModel.setTab(ExploreTab.CALENDAR) })
                            }
                            is UiState.Empty -> {
                                KuraEmptyView(message = state.message)
                            }
                            is UiState.Content, is UiState.Refreshing -> {
                                val schedule = if (state is UiState.Content) state.data else (state as UiState.Refreshing).currentData
                                val daysOrder = listOf("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

                                LazyColumn(
                                    modifier = Modifier.fillMaxSize(),
                                    contentPadding = PaddingValues(KuraDimens.Space4),
                                    verticalArrangement = Arrangement.spacedBy(KuraDimens.Space4)
                                ) {
                                    daysOrder.forEach { dayKey ->
                                        val items = schedule[dayKey] ?: emptyList()
                                        if (items.isNotEmpty()) {
                                            item {
                                                CalendarDaySection(
                                                    dayName = translateDayName(dayKey),
                                                    items = items,
                                                    onItemClick = { item ->
                                                        item.libraryShowId?.let(onNavigateToShowDetail)
                                                    }
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CalendarDaySection(
    dayName: String,
    items: List<CalendarItem>,
    onItemClick: (CalendarItem) -> Unit
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = dayName,
            style = MaterialTheme.typography.titleLarge,
            color = KuraColors.Secondary,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(bottom = KuraDimens.Space2)
        )

        Column(
            verticalArrangement = Arrangement.spacedBy(KuraDimens.Space2)
        ) {
            items.forEach { item ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(KuraShapes.Card)
                        .background(KuraColors.Surface)
                        .border(1.dp, KuraColors.Border, KuraShapes.Card)
                        .clickable { onItemClick(item) }
                        .padding(KuraDimens.Space3),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (item.coverImage.isNotBlank()) {
                        AsyncImage(
                            model = item.coverImage,
                            contentDescription = item.title,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier
                                .size(width = 48.dp, height = 68.dp)
                                .clip(KuraShapes.Small)
                        )
                        Spacer(modifier = Modifier.width(KuraDimens.Space3))
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = item.title,
                            style = MaterialTheme.typography.titleMedium,
                            color = KuraColors.TextMain,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = "Episodio ${item.episode} • ${item.studio}",
                            style = MaterialTheme.typography.labelSmall,
                            color = KuraColors.TextSecondary
                        )
                        if (item.inLibrary) {
                            Spacer(modifier = Modifier.height(2.dp))
                            KuraBadge(text = "En tu biblioteca", isAccent = true)
                        }
                    }
                }
            }
        }
    }
}

private fun translateDayName(day: String): String = when (day.lowercase()) {
    "monday" -> "Lunes"
    "tuesday" -> "Martes"
    "wednesday" -> "Miércoles"
    "thursday" -> "Jueves"
    "friday" -> "Viernes"
    "saturday" -> "Sábado"
    "sunday" -> "Domingo"
    else -> day
}
