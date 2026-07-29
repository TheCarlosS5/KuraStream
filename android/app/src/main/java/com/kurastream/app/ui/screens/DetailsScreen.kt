package com.kurastream.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kurastream.app.data.Episode
import com.kurastream.app.data.KuraStreamApi
import com.kurastream.app.data.Show
import com.kurastream.app.ui.theme.BgDark
import com.kurastream.app.ui.theme.CardDark
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailsScreen(
    showId: String,
    api: KuraStreamApi,
    onEpisodeClick: (String) -> Unit,
    onBack: () -> Unit
) {
    var show by remember { mutableStateOf<Show?>(null) }
    var episodes by remember { mutableStateOf<List<Episode>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(showId) {
        try {
            val response = api.getShowDetails(showId)
            show = response.show
            episodes = response.episodes
        } catch (e: Exception) {
            errorMessage = "Error al cargar detalles: ${e.localizedMessage ?: e.message}"
        } finally {
            isLoading = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(show?.title ?: "Detalle", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.Default.ArrowBack,
                            contentDescription = "Atrás",
                            tint = MaterialTheme.colorScheme.onBackground
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BgDark,
                    titleContentColor = MaterialTheme.colorScheme.onBackground
                )
            )
        }
    ) { innerPadding ->
        if (isLoading) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(BgDark),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            }
        } else if (errorMessage != null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(BgDark)
                    .padding(24.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(errorMessage!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(bottom = 16.dp))
                    Button(onClick = {
                        isLoading = true
                        errorMessage = null
                        scope.launch {
                            try {
                                val response = api.getShowDetails(showId)
                                show = response.show
                                episodes = response.episodes
                            } catch (e: Exception) {
                                errorMessage = e.localizedMessage
                            } finally {
                                isLoading = false
                            }
                        }
                    }) {
                        Text("Reintentar")
                    }
                }
            }
        } else {
            val currentShow = show
            val episodesGroupedBySeason = remember(episodes) {
                episodes.groupBy { it.seasonNumber }.toSortedMap()
            }

            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .background(BgDark)
                    .padding(innerPadding)
                    .padding(horizontal = 16.dp)
            ) {
                item {
                    // Header visual container
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(180.dp)
                            .background(
                                brush = Brush.verticalGradient(
                                    colors = listOf(
                                        MaterialTheme.colorScheme.primary.copy(alpha = 0.15f),
                                        Color.Transparent
                                    )
                                ),
                                shape = RoundedCornerShape(16.dp)
                            )
                            .padding(16.dp),
                        contentAlignment = Alignment.BottomStart
                    ) {
                        Column {
                            if (currentShow?.genres != null) {
                                Text(
                                    text = currentShow.genres,
                                    color = MaterialTheme.colorScheme.primary,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                            Text(
                                text = currentShow?.title ?: "",
                                fontSize = 24.sp,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onBackground,
                                modifier = Modifier.padding(top = 4.dp)
                            )
                            Row(
                                modifier = Modifier.padding(top = 6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                if (currentShow?.rating != null) {
                                    Icon(
                                        Icons.Default.Star,
                                        contentDescription = "Rating",
                                        tint = Color(0xFFFFC107),
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(
                                        text = currentShow.rating.toString(),
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color(0xFFFFC107)
                                    )
                                    Spacer(modifier = Modifier.width(16.dp))
                                }
                                if (currentShow?.year != null) {
                                    Text(
                                        text = currentShow.year.toString(),
                                        fontSize = 13.sp,
                                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.7f)
                                    )
                                    Spacer(modifier = Modifier.width(16.dp))
                                }
                                Text(
                                    text = currentShow?.mediaType?.uppercase() ?: "",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    // Overview Synopsis
                    Text(
                        text = "Sinopsis",
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                    Text(
                        text = currentShow?.synopsis ?: "Sin sinopsis disponible.",
                        fontSize = 14.sp,
                        lineHeight = 20.sp,
                        color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.8f),
                        modifier = Modifier.padding(bottom = 16.dp)
                    )

                    // Additional metadata if available
                    if (currentShow != null && (!currentShow.studio.isNullOrBlank() || !currentShow.director.isNullOrBlank())) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(CardDark, shape = RoundedCornerShape(12.dp))
                                .padding(12.dp)
                                .padding(bottom = 8.dp)
                        ) {
                            if (!currentShow.studio.isNullOrBlank()) {
                                Text(
                                    text = "Estudio: ${currentShow.studio}",
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                                )
                            }
                            if (!currentShow.director.isNullOrBlank()) {
                                Text(
                                    text = "Director: ${currentShow.director}",
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                                    modifier = Modifier.padding(top = 2.dp)
                                )
                            }
                            if (!currentShow.writer.isNullOrBlank()) {
                                Text(
                                    text = "Guion: ${currentShow.writer}",
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f),
                                    modifier = Modifier.padding(top = 2.dp)
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(24.dp))
                    }

                    Text(
                        text = "Episodios",
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )
                }

                // Seasons and episodes lists
                episodesGroupedBySeason.forEach { (seasonNum, seasonEpisodes) ->
                    item {
                        Surface(
                            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.1f),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 8.dp)
                        ) {
                            Text(
                                text = "Temporada $seasonNum",
                                fontWeight = FontWeight.Bold,
                                fontSize = 15.sp,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                            )
                        }
                    }

                    items(seasonEpisodes.sortedBy { it.episodeNumber }, key = { it.id }) { episode ->
                        Card(
                            onClick = { onEpisodeClick(episode.id) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 6.dp),
                            shape = RoundedCornerShape(12.dp),
                            colors = CardDefaults.cardColors(
                                containerColor = CardDark
                            )
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = "Episodio ${episode.episodeNumber}: ${episode.title ?: "Sin título"}",
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 14.sp,
                                        color = MaterialTheme.colorScheme.onSurface
                                    )
                                    
                                    if (!episode.synopsis.isNullOrBlank()) {
                                        Text(
                                            text = episode.synopsis,
                                            fontSize = 12.sp,
                                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                                            maxLines = 2,
                                            modifier = Modifier.padding(top = 4.dp)
                                        )
                                    }

                                    val durationMin = episode.duration?.let { (it / 60.0).toInt() } ?: 0
                                    Text(
                                        text = "Duración: $durationMin min",
                                        fontSize = 12.sp,
                                        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.8f),
                                        modifier = Modifier.padding(top = 6.dp)
                                    )
                                }

                                IconButton(
                                    onClick = { onEpisodeClick(episode.id) },
                                    colors = IconButtonDefaults.iconButtonColors(
                                        containerColor = MaterialTheme.colorScheme.primary,
                                        contentColor = MaterialTheme.colorScheme.onPrimary
                                    ),
                                    modifier = Modifier.size(36.dp)
                                ) {
                                    Icon(
                                        Icons.Default.PlayArrow,
                                        contentDescription = "Reproducir",
                                        modifier = Modifier.size(20.dp)
                                    )
                                }
                            }
                        }
                    }
                }

                item {
                    Spacer(modifier = Modifier.height(32.dp))
                }
            }
        }
    }
}
