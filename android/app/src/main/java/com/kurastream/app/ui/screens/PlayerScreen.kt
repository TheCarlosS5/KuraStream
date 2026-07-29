package com.kurastream.app.ui.screens

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import androidx.annotation.OptIn
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import com.kurastream.app.data.KuraStreamApi
import com.kurastream.app.data.PreferencesManager
import com.kurastream.app.data.ProgressRequest
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import java.util.Locale
import kotlin.math.sin
import kotlin.random.Random

data class SakuraPetal(
    var x: Float,
    var y: Float,
    var size: Float,
    var speedY: Float,
    var speedX: Float,
    var rotation: Float,
    var rotationSpeed: Float,
    val windOffset: Float
)

data class TrackItem(
    val id: String,
    val name: String,
    val isSelected: Boolean,
    val selectTrack: () -> Unit
)

// Helper tail-recursive function to extract the host activity from a themed/wrapped context safely
tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(
    episodeId: String,
    api: KuraStreamApi,
    preferencesManager: PreferencesManager,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val serverUrl = remember { preferencesManager.getServerUrl() ?: "" }
    val streamUrl = remember(serverUrl, episodeId) {
        if (serverUrl.endsWith("/")) "${serverUrl}api/stream/$episodeId" else "$serverUrl/api/stream/$episodeId"
    }
    val username = remember { preferencesManager.getUsername() ?: "guest" }

    // Force landscape mode during playback safely
    val activity = remember(context) { context.findActivity() }
    DisposableEffect(activity) {
        val originalOrientation = activity?.requestedOrientation ?: ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        onDispose {
            activity?.requestedOrientation = originalOrientation
        }
    }

    val exoPlayer = remember(context) {
        val token = preferencesManager.getAuthToken() ?: ""
        val factory = DefaultHttpDataSource.Factory()
        if (token.isNotEmpty()) {
            factory.setDefaultRequestProperties(mapOf("Authorization" to "Bearer $token"))
        }
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(context).setDataSourceFactory(factory))
            .build()
    }

    var isPlaying by remember { mutableStateOf(false) }
    var currentPosition by remember { mutableStateOf(0L) }
    var duration by remember { mutableStateOf(0L) }
    var showControls by remember { mutableStateOf(true) }
    var isDragging by remember { mutableStateOf(false) }
    var dragProgress by remember { mutableStateOf(0f) }
    var playbackError by remember { mutableStateOf<String?>(null) }
    var showTrackSelector by remember { mutableStateOf(false) }

    // Keeps track of user interactions to reset the auto-hide timer
    var interactionCounter by remember { mutableStateOf(0) }

    // State helper to trigger tracks list reload
    var tracksUpdateCounter by remember { mutableStateOf(0) }

    // Load media and watch progress sequentially but allow ExoPlayer buffering in parallel
    LaunchedEffect(streamUrl) {
        playbackError = null
        val mediaItem = MediaItem.fromUri(streamUrl)
        exoPlayer.setMediaItem(mediaItem)
        exoPlayer.prepare() // Buffer concurrently!
        
        // Fetch progress while buffering
        val savedSeconds = try {
            api.getProgress(episodeId, username).progress
        } catch (e: Exception) {
            0.0
        }

        if (savedSeconds > 0.0) {
            val seekTo = (savedSeconds * 1000.0).toLong()
            exoPlayer.seekTo(seekTo)
            currentPosition = seekTo
        }
        exoPlayer.playWhenReady = true
    }

    // Release player lifecycle
    DisposableEffect(exoPlayer) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(playing: Boolean) {
                isPlaying = playing
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY) {
                    duration = exoPlayer.duration.coerceAtLeast(0L)
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                playbackError = "Error de reproducción: ${error.localizedMessage ?: error.message}"
            }

            override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                tracksUpdateCounter++
            }
        }
        exoPlayer.addListener(listener)

        onDispose {
            exoPlayer.removeListener(listener)
            exoPlayer.release()
        }
    }

    // Observe application lifecycle to pause player when backgrounded
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, exoPlayer) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) {
                exoPlayer.pause()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    // Only query position when playing to conserve battery life
    LaunchedEffect(isPlaying) {
        if (isPlaying) {
            while (isActive) {
                currentPosition = exoPlayer.currentPosition.coerceAtLeast(0L)
                delay(500L)
            }
        }
    }

    // Periodic Progress Auto-Save (every 10 seconds while playing)
    LaunchedEffect(isPlaying) {
        if (isPlaying) {
            while (isActive) {
                delay(10000L)
                try {
                    api.saveProgress(episodeId, ProgressRequest(exoPlayer.currentPosition / 1000.0, username))
                } catch (e: Exception) {
                    // Ignore silently
                }
            }
        }
    }

    // Robust Watch Progress saving on screen exit/destruction (handles paused exit as well!)
    LaunchedEffect(Unit) {
        try {
            awaitCancellation()
        } finally {
            withContext(NonCancellable) {
                try {
                    val seconds = currentPosition / 1000.0
                    if (seconds > 0.0) {
                        api.saveProgress(episodeId, ProgressRequest(seconds, username))
                    }
                } catch (ignored: Exception) {}
            }
        }
    }

    // Auto-hide controls when playing and not interacting/dragging
    LaunchedEffect(showControls, isPlaying, isDragging, showTrackSelector, interactionCounter) {
        if (showControls && isPlaying && !isDragging && !showTrackSelector) {
            delay(3000L)
            showControls = false
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null
            ) {
                if (!showTrackSelector) {
                    showControls = !showControls
                    interactionCounter++
                }
            }
    ) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    player = exoPlayer
                    useController = false
                }
            },
            update = { playerView ->
                playerView.keepScreenOn = isPlaying
            },
            onRelease = { playerView ->
                playerView.player = null
            },
            modifier = Modifier.fillMaxSize()
        )

        SakuraFallingEffect(isPlaying = isPlaying)

        playbackError?.let { error ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.8f))
                    .padding(24.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Error de Reproducción", color = Color.Red, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(error, color = Color.White, fontSize = 14.sp)
                    Spacer(modifier = Modifier.height(24.dp))
                    Row {
                        Button(onClick = {
                            playbackError = null
                            exoPlayer.prepare()
                            exoPlayer.play()
                        }) {
                            Text("Reintentar")
                        }
                        Spacer(modifier = Modifier.width(16.dp))
                        Button(onClick = onBack) {
                            Text("Volver")
                        }
                    }
                }
            }
        }

        if (playbackError == null && (showControls || !isPlaying)) {
            val currentProgress = if (duration > 0) currentPosition.toFloat() / duration.toFloat() else 0f
            val sliderValue = (if (isDragging) dragProgress else currentProgress).coerceIn(0f, 1f)
            val displayPosition = if (isDragging) (dragProgress * duration).toLong() else currentPosition

            PlayerControlsOverlay(
                title = "Capítulo $episodeId",
                isPlaying = isPlaying,
                currentPosition = displayPosition,
                sliderProgress = sliderValue,
                duration = duration,
                onPlayPause = {
                    if (isPlaying) {
                        exoPlayer.pause()
                    } else {
                        exoPlayer.play()
                    }
                    interactionCounter++
                },
                onSeekStarted = {
                    isDragging = true
                    interactionCounter++
                },
                onSeekProgress = { progress ->
                    dragProgress = progress
                },
                onSeekFinished = {
                    isDragging = false
                    val seekTo = (dragProgress * duration).toLong()
                    exoPlayer.seekTo(seekTo)
                    currentPosition = seekTo // Update immediately to prevent snapback when paused!
                    interactionCounter++
                },
                onTrackSelectorClick = {
                    showTrackSelector = true
                    interactionCounter++
                },
                onBack = onBack
            )
        }

        // Floating glassmorphism track selector panel
        if (showTrackSelector) {
            val audioTracks = remember(tracksUpdateCounter) { getTracksForType(exoPlayer, C.TRACK_TYPE_AUDIO) }
            val subtitleTracks = remember(tracksUpdateCounter) { getTracksForType(exoPlayer, C.TRACK_TYPE_TEXT) }
            val isSubtitlesDisabled = remember(tracksUpdateCounter) {
                exoPlayer.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT)
            }

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.6f))
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null
                    ) {
                        showTrackSelector = false
                        interactionCounter++
                    },
                contentAlignment = Alignment.CenterEnd
            ) {
                Surface(
                    modifier = Modifier
                        .fillMaxHeight()
                        .width(320.dp)
                        .clickable(enabled = false) {},
                    color = Color(0xFF1A1F2C).copy(alpha = 0.95f),
                    shape = RoundedCornerShape(topStart = 16.dp, bottomStart = 16.dp),
                    tonalElevation = 8.dp
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(16.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Audio y Subtítulos", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                            IconButton(onClick = {
                                showTrackSelector = false
                                interactionCounter++
                            }) {
                                Icon(Icons.Filled.Close, contentDescription = "Close", tint = Color.White)
                            }
                        }

                        Divider(color = Color.White.copy(alpha = 0.1f), modifier = Modifier.padding(vertical = 8.dp))

                        LazyColumn(
                            modifier = Modifier.weight(1f)
                        ) {
                            item {
                                Text("Pistas de Audio", color = Color(0xFFE91E63), fontWeight = FontWeight.Bold, fontSize = 14.sp, modifier = Modifier.padding(vertical = 8.dp))
                            }
                            if (audioTracks.isEmpty()) {
                                item {
                                    Text("Ninguno disponible", color = Color.White.copy(alpha = 0.5f), fontSize = 12.sp, modifier = Modifier.padding(vertical = 4.dp))
                                }
                            } else {
                                items(audioTracks) { track ->
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable {
                                                track.selectTrack()
                                                interactionCounter++
                                            }
                                            .padding(vertical = 8.dp, horizontal = 4.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        RadioButton(
                                            selected = track.isSelected,
                                            onClick = {
                                                track.selectTrack()
                                                interactionCounter++
                                            },
                                            colors = RadioButtonDefaults.colors(selectedColor = Color(0xFFE91E63))
                                        )
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text(track.name, color = Color.White, fontSize = 14.sp)
                                    }
                                }
                            }

                            item {
                                Spacer(modifier = Modifier.height(16.dp))
                                Text("Subtítulos", color = Color(0xFFE91E63), fontWeight = FontWeight.Bold, fontSize = 14.sp, modifier = Modifier.padding(vertical = 8.dp))
                            }

                            item {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            exoPlayer.trackSelectionParameters = exoPlayer.trackSelectionParameters
                                                .buildUpon()
                                                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                                                .build()
                                            interactionCounter++
                                        }
                                        .padding(vertical = 8.dp, horizontal = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    RadioButton(
                                        selected = isSubtitlesDisabled,
                                        onClick = {
                                            exoPlayer.trackSelectionParameters = exoPlayer.trackSelectionParameters
                                                .buildUpon()
                                                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                                                .build()
                                            interactionCounter++
                                        },
                                        colors = RadioButtonDefaults.colors(selectedColor = Color(0xFFE91E63))
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text("Desactivados", color = Color.White, fontSize = 14.sp)
                                }
                            }

                            if (subtitleTracks.isNotEmpty()) {
                                items(subtitleTracks) { track ->
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable {
                                                track.selectTrack()
                                                interactionCounter++
                                            }
                                            .padding(vertical = 8.dp, horizontal = 4.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        RadioButton(
                                            selected = !isSubtitlesDisabled && track.isSelected,
                                            onClick = {
                                                track.selectTrack()
                                                interactionCounter++
                                            },
                                            colors = RadioButtonDefaults.colors(selectedColor = Color(0xFFE91E63))
                                        )
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text(track.name, color = Color.White, fontSize = 14.sp)
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
fun SakuraFallingEffect(isPlaying: Boolean) {
    val configuration = LocalConfiguration.current
    val density = LocalDensity.current
    val screenWidth = with(density) { configuration.screenWidthDp.dp.toPx() }
    val screenHeight = with(density) { configuration.screenHeightDp.dp.toPx() }

    // Hoist and remember petals without screen size keys to prevent splitting/resizing reset bugs!
    val petals = remember {
        List(40) { index ->
            val startY = if (index % 2 == 0) {
                Random.nextFloat() * screenHeight
            } else {
                Random.nextFloat() * screenHeight - screenHeight
            }
            SakuraPetal(
                x = Random.nextFloat() * screenWidth,
                y = startY,
                size = Random.nextFloat() * 15f + 10f,
                speedY = Random.nextFloat() * 3f + 1f,
                speedX = Random.nextFloat() * 2f - 1f,
                rotation = Random.nextFloat() * 360f,
                rotationSpeed = Random.nextFloat() * 4f - 2f,
                windOffset = Random.nextFloat() * 100f
            )
        }
    }

    var time by remember { mutableStateOf(0f) }

    // Premium Fade-Out transition spec: opacity decreases gradually over 1 second when PLAYING is resumed.
    val alphaState by animateFloatAsState(
        targetValue = if (isPlaying) 0f else 0.8f,
        animationSpec = tween(durationMillis = 1000),
        label = "sakuraAlpha"
    )

    // Completely teardown loop and rendering once fully faded out to conserve battery!
    if (alphaState == 0f) return

    LaunchedEffect(screenWidth, screenHeight) {
        var lastFrameTime = -1L
        var startTime = -1L

        while (isActive) {
            withFrameMillis { frameTime ->
                if (startTime < 0) startTime = frameTime
                if (lastFrameTime < 0) lastFrameTime = frameTime

                val dt = (frameTime - lastFrameTime) / 1000f
                val elapsedSeconds = (frameTime - startTime) / 1000f
                lastFrameTime = frameTime

                petals.forEach { petal ->
                    // Make animation frame-rate independent scaling speeds with dt (normalized to 60fps)
                    petal.y += petal.speedY * dt * 60f
                    petal.x += (petal.speedX + sin(elapsedSeconds * 2f + petal.windOffset) * 1.2f) * dt * 60f
                    petal.rotation += petal.rotationSpeed * dt * 60f

                    // Bounds boundaries updated dynamically in coordinates loop checking
                    if (petal.y > screenHeight + petal.size) {
                        petal.y = -petal.size
                        petal.x = Random.nextFloat() * screenWidth
                    }
                }
                time = elapsedSeconds
            }
        }
    }

    // High performance pre-calculated organic Sakura petal cleft path (no runtime allocations in Draw phase!)
    val basePetalPath = remember {
        Path().apply {
            moveTo(0f, 0.5f)
            cubicTo(-0.5f, 0.25f, -0.3f, -0.5f, 0f, -0.5f)
            lineTo(0f, -0.3f)
            cubicTo(0.3f, -0.5f, 0.5f, 0.25f, 0f, 0.5f)
            close()
        }
    }

    Canvas(modifier = Modifier.fillMaxSize()) {
        // Reading the time state within Canvas scope triggers invalidation/redraw on every frame physics update
        val timeVal = time
        val currentAlpha = alphaState
        petals.forEach { petal ->
            withTransform({
                translate(petal.x, petal.y)
                rotate(petal.rotation)
                scale(petal.size, petal.size)
            }) {
                drawPath(
                    path = basePetalPath,
                    color = Color(0xFFFFB7C5).copy(alpha = currentAlpha)
                )
            }
        }
    }
}

@Composable
fun PlayerControlsOverlay(
    title: String,
    isPlaying: Boolean,
    currentPosition: Long,
    sliderProgress: Float,
    duration: Long,
    onPlayPause: () -> Unit,
    onSeekStarted: () -> Unit,
    onSeekProgress: (Float) -> Unit,
    onSeekFinished: () -> Unit,
    onTrackSelectorClick: () -> Unit,
    onBack: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.4f))
    ) {
        // Top bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .align(Alignment.TopStart),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Filled.ArrowBack, contentDescription = "Back", tint = Color.White)
            }
            Spacer(modifier = Modifier.width(8.dp))
            Text(title, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            
            IconButton(onClick = onTrackSelectorClick) {
                Icon(Icons.Filled.Settings, contentDescription = "Track settings", tint = Color.White)
            }
        }

        // Center play/pause
        IconButton(
            onClick = onPlayPause,
            modifier = Modifier
                .align(Alignment.Center)
                .size(64.dp)
        ) {
            Icon(
                if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                contentDescription = if (isPlaying) "Pause" else "Play",
                tint = Color.White,
                modifier = Modifier.size(48.dp)
            )
        }

        // Bottom seek bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.BottomCenter)
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(formatTime(currentPosition), color = Color.White, fontSize = 14.sp)
            Spacer(modifier = Modifier.width(8.dp))
            Slider(
                value = sliderProgress,
                onValueChange = { progress ->
                    onSeekStarted()
                    onSeekProgress(progress)
                },
                onValueChangeFinished = onSeekFinished,
                modifier = Modifier.weight(1f),
                colors = SliderDefaults.colors(
                    thumbColor = Color(0xFFE91E63),
                    activeTrackColor = Color(0xFFE91E63),
                    inactiveTrackColor = Color.White.copy(alpha = 0.3f)
                )
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(formatTime(duration), color = Color.White, fontSize = 14.sp)
        }
    }
}

fun formatTime(ms: Long): String {
    val totalSeconds = (ms / 1000).coerceAtLeast(0)
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    val mStr = if (minutes < 10) "0$minutes" else minutes.toString()
    val sStr = if (seconds < 10) "0$seconds" else seconds.toString()
    return "$mStr:$sStr"
}

// Media3 track extractor helper function
fun getTracksForType(exoPlayer: ExoPlayer, trackType: Int): List<TrackItem> {
    val trackList = mutableListOf<TrackItem>()
    val currentTracks = exoPlayer.currentTracks
    for (group in currentTracks.groups) {
        if (group.type == trackType) {
            val mediaTrackGroup = group.mediaTrackGroup
            for (i in 0 until group.length) {
                val format = group.getTrackFormat(i)
                val isSelected = group.isTrackSelected(i)
                val languageCode = format.language ?: ""
                // Premium UX: convert track code to native local display language (e.g. "spa" -> "Español")
                val label = format.label ?: if (languageCode.isNotEmpty()) {
                    Locale(languageCode).getDisplayLanguage(Locale.getDefault()).replaceFirstChar { it.uppercase() }
                } else {
                    "Pista $i"
                }
                trackList.add(
                    TrackItem(
                        id = "${mediaTrackGroup.id}_$i",
                        name = label,
                        isSelected = isSelected,
                        selectTrack = {
                            exoPlayer.trackSelectionParameters = exoPlayer.trackSelectionParameters
                                .buildUpon()
                                .setTrackTypeDisabled(trackType, false)
                                .setOverrideForType(TrackSelectionOverride(mediaTrackGroup, i))
                                .build()
                        }
                    )
                )
            }
        }
    }
    return trackList
}
