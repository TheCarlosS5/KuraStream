package com.kurastream.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.*
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kurastream.app.data.KuraStreamApi
import com.kurastream.app.data.Show
import com.kurastream.app.ui.theme.BgDark
import com.kurastream.app.ui.theme.CardDark
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogScreen(
    api: KuraStreamApi,
    onShowClick: (String) -> Unit,
    onDisconnect: () -> Unit
) {
    var shows by remember { mutableStateOf<List<Show>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    
    var searchQuery by remember { mutableStateOf("") }
    var selectedTab by remember { mutableStateOf(0) } // 0: All, 1: Anime, 2: Movies/Series
    
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        try {
            shows = api.getShows()
        } catch (e: Exception) {
            errorMessage = "Error al cargar catálogo: ${e.localizedMessage ?: e.message}"
        } finally {
            isLoading = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { 
                    Text(
                        text = "Biblioteca KuraStream", 
                        fontWeight = FontWeight.Bold,
                        fontSize = 20.sp
                    ) 
                },
                actions = {
                    TextButton(
                        onClick = onDisconnect,
                        colors = ButtonDefaults.textButtonColors(
                            contentColor = MaterialTheme.colorScheme.primary
                        )
                    ) {
                        Text("Desconectar", fontWeight = FontWeight.Bold)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BgDark,
                    titleContentColor = MaterialTheme.colorScheme.onBackground
                )
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(BgDark)
                .padding(innerPadding)
        ) {
            // Search field
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                placeholder = { Text("Buscar shows...") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = "Search") },
                trailingIcon = {
                    if (searchQuery.isNotEmpty()) {
                        IconButton(onClick = { searchQuery = "" }) {
                            Icon(Icons.Default.Close, contentDescription = "Clear")
                        }
                    }
                },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    unfocusedBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f),
                    focusedContainerColor = CardDark,
                    unfocusedContainerColor = CardDark
                )
            )

            // Tabs for filtering
            TabRow(
                selectedTabIndex = selectedTab,
                containerColor = BgDark,
                contentColor = MaterialTheme.colorScheme.primary,
                indicator = { tabPositions ->
                    TabRowDefaults.Indicator(
                        modifier = Modifier.tabIndicatorOffset(tabPositions[selectedTab]),
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            ) {
                Tab(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    text = { Text("Todos") }
                )
                Tab(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    text = { Text("Anime") }
                )
                Tab(
                    selected = selectedTab == 2,
                    onClick = { selectedTab = 2 },
                    text = { Text("Peliculas/Series") }
                )
            }

            if (isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                }
            } else if (errorMessage != null) {
                Box(
                    modifier = Modifier.fillMaxSize().padding(24.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(errorMessage!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(bottom = 16.dp))
                        Button(onClick = {
                            isLoading = true
                            errorMessage = null
                            scope.launch {
                                try {
                                    shows = api.getShows()
                                } catch (e: Exception) {
                                    errorMessage = "Error: ${e.localizedMessage}"
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
                // Apply filters
                val filteredShows = remember(shows, searchQuery, selectedTab) {
                    shows.filter { show ->
                        val matchesSearch = show.title.contains(searchQuery, ignoreCase = true) ||
                                (show.synopsis?.contains(searchQuery, ignoreCase = true) ?: false) ||
                                (show.genres?.contains(searchQuery, ignoreCase = true) ?: false)
                        
                        val matchesTab = when (selectedTab) {
                            1 -> show.mediaType.equals("anime", ignoreCase = true)
                            2 -> !show.mediaType.equals("anime", ignoreCase = true)
                            else -> true
                        }
                        matchesSearch && matchesTab
                    }
                }

                if (filteredShows.isEmpty()) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("No se encontraron shows.", color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f))
                    }
                } else {
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(2),
                        modifier = Modifier.fillMaxSize().padding(horizontal = 8.dp),
                        contentPadding = PaddingValues(top = 12.dp, bottom = 24.dp, start = 8.dp, end = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        items(filteredShows, key = { it.id }) { show ->
                            Card(
                                onClick = { onShowClick(show.id) },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(260.dp),
                                shape = RoundedCornerShape(16.dp),
                                colors = CardDefaults.cardColors(
                                    containerColor = CardDark
                                )
                            ) {
                                Column(
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .padding(12.dp)
                                ) {
                                    // Simulated Poster Placeholder with Gradient
                                    Box(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .weight(1f)
                                            .background(
                                                brush = Brush.verticalGradient(
                                                    colors = listOf(
                                                        MaterialTheme.colorScheme.primary.copy(alpha = 0.2f),
                                                        MaterialTheme.colorScheme.primary.copy(alpha = 0.05f)
                                                    )
                                                ),
                                                shape = RoundedCornerShape(8.dp)
                                            )
                                            .padding(8.dp),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                            Text(
                                                text = show.mediaType.uppercase(),
                                                fontSize = 11.sp,
                                                fontWeight = FontWeight.Bold,
                                                color = MaterialTheme.colorScheme.primary
                                            )
                                            if (show.rating != null) {
                                                Row(
                                                    verticalAlignment = Alignment.CenterVertically,
                                                    modifier = Modifier.padding(top = 4.dp)
                                                ) {
                                                    Icon(
                                                        Icons.Default.Star,
                                                        contentDescription = "Rating",
                                                        tint = Color(0xFFFFC107),
                                                        modifier = Modifier.size(14.dp)
                                                    )
                                                    Spacer(modifier = Modifier.width(2.dp))
                                                    Text(
                                                        text = show.rating.toString(),
                                                        fontSize = 12.sp,
                                                        fontWeight = FontWeight.Bold,
                                                        color = Color(0xFFFFC107)
                                                    )
                                                }
                                            }
                                            if (show.year != null) {
                                                Text(
                                                    text = show.year.toString(),
                                                    fontSize = 11.sp,
                                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                                                    modifier = Modifier.padding(top = 2.dp)
                                                )
                                            }
                                        }
                                    }

                                    Spacer(modifier = Modifier.height(8.dp))

                                    Text(
                                        text = show.title,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 15.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )

                                    if (!show.studio.isNullOrBlank()) {
                                        Text(
                                            text = show.studio,
                                            fontSize = 11.sp,
                                            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.8f),
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }

                                    Spacer(modifier = Modifier.height(4.dp))

                                    Text(
                                        text = show.synopsis ?: "Sin sinopsis disponible.",
                                        fontSize = 11.sp,
                                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
                                        maxLines = 3,
                                        overflow = TextOverflow.Ellipsis,
                                        lineHeight = 14.sp
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
