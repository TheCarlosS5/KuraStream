package com.kurastream.app.feature.favorites

import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.Icons
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.kurastream.app.R
import com.kurastream.app.core.designsystem.component.*
import com.kurastream.app.core.designsystem.theme.*
import com.kurastream.app.core.model.UiState
import com.kurastream.app.core.network.ServerUrlResolver

@Composable
fun FavoritesScreen(
    viewModel: FavoritesViewModel,
    onNavigateToShowDetail: (String) -> Unit,
    onNavigateToExplore: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    val baseUrl by viewModel.baseUrl.collectAsState()

    Scaffold(
        topBar = {
            KuraTopBar(title = stringResource(R.string.nav_my_list))
        },
        containerColor = KuraColors.Background
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when (val state = uiState) {
                is UiState.Loading -> {
                    KuraLoadingView(message = "Cargando Mi Lista…")
                }
                is UiState.Error -> {
                    KuraErrorView(message = state.message, onRetry = viewModel::loadFavorites)
                }
                is UiState.Empty -> {
                    KuraEmptyView(
                        message = state.message,
                        icon = Icons.Outlined.BookmarkBorder,
                        actionText = "Explorar catálogo",
                        onAction = onNavigateToExplore
                    )
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
                            val posterUrl = ServerUrlResolver.buildMediaUrl(baseUrl, show.posterPath)
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
}
