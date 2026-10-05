package com.kurastream.app.feature.player

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import android.app.Activity
import android.app.PictureInPictureParams
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.core.app.PictureInPictureModeChangedInfo
import androidx.core.util.Consumer
import androidx.lifecycle.Lifecycle
import androidx.media3.common.Player
import android.content.Context
import android.content.pm.ActivityInfo
import android.media.AudioManager
import android.os.Build
import android.provider.Settings
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.compose.animation.*
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import com.kurastream.app.core.model.Episode
import com.kurastream.app.core.network.ServerUrlResolver
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.media3.ui.SubtitleView
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.kurastream.app.core.model.Chapter
import com.kurastream.app.core.model.PartyMessage
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.kurastream.app.R
import com.kurastream.app.core.designsystem.component.*
import com.kurastream.app.core.designsystem.theme.*
import com.kurastream.app.core.player.PipController
import com.kurastream.app.core.player.VideoFitMode
import com.kurastream.app.core.player.PlayerOrientationManager
import com.kurastream.app.core.player.TrackLabel
import com.kurastream.app.core.player.TrackLabels
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs

@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(
    viewModel: PlayerViewModel,
    onNavigateBack: () -> Unit,
    onNavigateToNextEpisode: (String) -> Unit
) {
    val state by viewModel.playerState.collectAsState()
    val context = LocalContext.current
    val view = LocalView.current

    var showTracksSheet by remember { mutableStateOf(false) }
    var showSpeedSheet by remember { mutableStateOf(false) }
    var showCreatePartyDialog by remember { mutableStateOf(false) }
    var showPartyInfoDialog by remember { mutableStateOf(false) }
    var showEpisodesPanel by remember { mutableStateOf(false) }
    var showPartyChat by remember { mutableStateOf(false) }
    var partyRoomNameInput by remember { mutableStateOf("") }

    BackHandler(enabled = showEpisodesPanel) { showEpisodesPanel = false }
    BackHandler(enabled = showPartyChat && !showEpisodesPanel) { showPartyChat = false }

    LaunchedEffect(showPartyChat) { viewModel.setPartyChatOpen(showPartyChat) }
    LaunchedEffect(state.isWatchPartyActive) { if (!state.isWatchPartyActive) showPartyChat = false }

    // Leaving the app mid-episode: write the exact position (the periodic save lags up to 10 s).
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) viewModel.onAppBackgrounded()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // "Reanudado en…" notice disappears on its own
    LaunchedEffect(state.resumedFromSeconds) {
        if (state.resumedFromSeconds != null) {
            delay(8000)
            viewModel.dismissResumeNotice()
        }
    }

    // Navigation events from PlayerViewModel (e.g. next episode auto-advance)
    LaunchedEffect(Unit) {
        viewModel.navigationEvents.collect { nextEpisodeId ->
            onNavigateToNextEpisode(nextEpisodeId)
        }
    }

    // Gesture HUD overlay state
    var gestureHudText by remember { mutableStateOf<String?>(null) }
    var gestureHudIcon by remember { mutableStateOf<ImageVector?>(null) }
    // Separate flag so the last text/icon stay rendered while the HUD fades out
    var gestureHudVisible by remember { mutableStateOf(false) }
    val coroutineScope = rememberCoroutineScope()
    var hudDismissJob by remember { mutableStateOf<Job?>(null) }

    fun showGestureHud(text: String, icon: ImageVector) {
        gestureHudText = text
        gestureHudIcon = icon
        gestureHudVisible = true
        hudDismissJob?.cancel()
        hudDismissJob = coroutineScope.launch {
            delay(1200)
            gestureHudVisible = false
        }
    }

    LaunchedEffect(Unit) {
        viewModel.hudMessages.collect { message -> showGestureHud(message, Icons.Default.Info) }
    }

    // Brightness adjustment helper
    fun adjustBrightness(delta: Float) {
        val activity = context as? Activity ?: return
        val lp = activity.window.attributes
        val current = if (lp.screenBrightness < 0f) {
            try {
                Settings.System.getInt(
                    activity.contentResolver,
                    Settings.System.SCREEN_BRIGHTNESS
                ) / 255f
            } catch (_: Exception) {
                0.5f
            }
        } else {
            lp.screenBrightness
        }
        val newBrightness = (current + delta * 1.5f).coerceIn(0.01f, 1.0f)
        lp.screenBrightness = newBrightness
        activity.window.attributes = lp
        showGestureHud("Brillo: ${(newBrightness * 100).toInt()}%", Icons.Default.BrightnessMedium)
    }

    // Volume adjustment helper
    var volumeAccumulator by remember { mutableFloatStateOf(0f) }
    fun adjustVolume(delta: Float) {
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        val maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val currentVol = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC)
        volumeAccumulator += delta * 1.5f
        val step = 1f / maxVol.toFloat()
        if (abs(volumeAccumulator) >= step) {
            val steps = (volumeAccumulator / step).toInt()
            val newVol = (currentVol + steps).coerceIn(0, maxVol)
            audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, newVol, 0)
            volumeAccumulator -= steps * step
            val pct = (newVol.toFloat() / maxVol.toFloat() * 100).toInt()
            val icon = if (newVol == 0) Icons.AutoMirrored.Filled.VolumeOff else Icons.AutoMirrored.Filled.VolumeUp
            showGestureHud("Volumen: $pct%", icon)
        }
    }

    // Timeline scrubbing local state
    var isScrubbing by remember { mutableStateOf(false) }
    var scrubPosition by remember { mutableFloatStateOf(0f) }

    // Immersive landscape edge-to-edge (managed globally to handle next-episode navigation)
    DisposableEffect(Unit) {
        val activity = context as? Activity
        PlayerOrientationManager.enterPlayer(activity, view)

        onDispose {
            PlayerOrientationManager.exitPlayer(activity, view)
            // Hand the brightness back to the system: the gesture override must not outlive the player
            activity?.window?.let { w ->
                val lp = w.attributes
                lp.screenBrightness = android.view.WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
                w.attributes = lp
            }
        }
    }

    // Picture-in-Picture: track the mode so the tiny window shows only video, and let Android 12+
    // enter PiP automatically when the user leaves the app mid-episode.
    var isInPip by remember { mutableStateOf(false) }
    DisposableEffect(context) {
        val activity = context as? ComponentActivity
        val listener = Consumer<PictureInPictureModeChangedInfo> { info ->
            isInPip = info.isInPictureInPictureMode
            // Leaving PiP while the activity is no longer started means the user dismissed the window.
            if (!info.isInPictureInPictureMode &&
                activity?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.STARTED) == false
            ) {
                viewModel.pause()
            }
        }
        activity?.addOnPictureInPictureModeChangedListener(listener)
        onDispose {
            activity?.removeOnPictureInPictureModeChangedListener(listener)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && activity != null && activity.supportsPictureInPicture()) {
                activity.setPictureInPictureParams(PictureInPictureParams.Builder().setAutoEnterEnabled(false).build())
            }
        }
    }
    LaunchedEffect(state.isPlaying) {
        val activity = context as? Activity
        PipController.armed = state.isPlaying
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && activity != null && activity.supportsPictureInPicture()) {
            // Updates the window's buttons too (the play/pause icon follows the state)
            activity.setPictureInPictureParams(PipController.buildParams(activity, state.isPlaying, state.isPlaying))
        }
    }
    DisposableEffect(Unit) {
        // Buttons of the PiP window arrive as broadcasts
        val receiver = object : android.content.BroadcastReceiver() {
            override fun onReceive(c: Context?, intent: android.content.Intent?) {
                when (intent?.action) {
                    PipController.ACTION_BACK -> viewModel.seekRelative(-10f)
                    PipController.ACTION_FORWARD -> viewModel.seekRelative(10f)
                    PipController.ACTION_TOGGLE -> viewModel.togglePlayPause()
                }
            }
        }
        val filter = android.content.IntentFilter().apply {
            addAction(PipController.ACTION_BACK)
            addAction(PipController.ACTION_TOGGLE)
            addAction(PipController.ACTION_FORWARD)
        }
        androidx.core.content.ContextCompat.registerReceiver(context, receiver, filter, androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED)
        onDispose {
            PipController.armed = false
            try { context.unregisterReceiver(receiver) } catch (_: IllegalArgumentException) {}
        }
    }

    val player by viewModel.playerFlow.collectAsState()

    if (isInPip) {
        PlayerSurface(
            player = player,
            fitMode = VideoFitMode.FIT,
            keepScreenOn = state.playWhenReady,
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black)
        )
        return
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .pointerInput(state.controlsLocked) {
                if (state.controlsLocked) {
                    detectTapGestures(
                        onTap = { viewModel.onScreenTap() }
                    )
                    return@pointerInput
                }

                var lastTapTime = 0L
                var lastTapPos = Offset.Zero

                coroutineScope {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        val startPos = down.position
                        val startTime = System.currentTimeMillis()
                        var isVerticalDrag = false
                        var isHolding = false
                        // Set when a control (button, seek bar) handled the pointer: that gesture
                        // must not also count as a screen tap or a hold-for-2x.
                        var handledByChild = false
                        val touchSlop = viewConfiguration.touchSlop

                        val holdJob = launch {
                            delay(450)
                            if (!isVerticalDrag) {
                                isHolding = true
                                viewModel.startTemporary2x()
                            }
                        }

                        while (true) {
                            val event = awaitPointerEvent()
                            val change = event.changes.find { it.id == down.id } ?: break

                            if (change.isConsumed && !isVerticalDrag) {
                                handledByChild = true
                                holdJob.cancel()
                            }

                            if (!change.pressed) {
                                holdJob.cancel()
                                if (isHolding) {
                                    viewModel.stopTemporary2x()
                                } else if (!isVerticalDrag && !handledByChild) {
                                    val duration = System.currentTimeMillis() - startTime
                                    if (duration < 350) {
                                        val timeSinceLast = startTime - lastTapTime
                                        val dist = (startPos - lastTapPos).getDistance()
                                        if (timeSinceLast < 300 && dist < 120f) {
                                            // Double tap detected
                                            lastTapTime = 0L
                                            val sec = state.doubleTapSeekSeconds
                                            if (startPos.x < size.width / 2) {
                                                viewModel.seekDoubleTap(forward = false)
                                                showGestureHud("-${sec}s", Icons.Default.Replay10)
                                            } else {
                                                viewModel.seekDoubleTap(forward = true)
                                                showGestureHud("+${sec}s", Icons.Default.Forward10)
                                            }
                                        } else {
                                            // Single tap candidate
                                            lastTapTime = startTime
                                            lastTapPos = startPos
                                            launch {
                                                delay(300)
                                                if (lastTapTime == startTime) {
                                                    viewModel.onScreenTap()
                                                }
                                            }
                                        }
                                    }
                                }
                                break
                            }

                            val dragY = change.position.y - startPos.y
                            val dragX = change.position.x - startPos.x

                            if (!isVerticalDrag && !handledByChild && abs(dragY) > touchSlop && abs(dragY) > abs(dragX) * 1.3f) {
                                isVerticalDrag = true
                                holdJob.cancel()
                            }

                            if (isVerticalDrag) {
                                val deltaY = change.positionChange().y
                                if (startPos.x < size.width * 0.45f) {
                                    adjustBrightness(-deltaY / size.height)
                                } else if (startPos.x > size.width * 0.55f) {
                                    adjustVolume(-deltaY / size.height)
                                }
                                change.consume()
                            }
                        }
                        holdJob.cancel()
                        if (isHolding) {
                            viewModel.stopTemporary2x()
                        }
                    }
                }
            }
    ) {
        // LAYER 1: SurfaceView / PlayerView via MediaController
        PlayerSurface(
            player = player,
            fitMode = state.videoFitMode,
            keepScreenOn = state.playWhenReady,
            modifier = Modifier.fillMaxSize(),
            subtitleScale = state.subtitleScale
        )

        // LAYER 2: Soft scrims behind the top and bottom controls (Netflix-style: the middle of the
        // picture stays clear instead of dimming the whole frame).
        AnimatedVisibility(
            visible = state.controlsVisible && !state.controlsLocked,
            enter = fadeIn(),
            exit = fadeOut()
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            0f to Color.Black.copy(alpha = 0.7f),
                            0.28f to Color.Transparent,
                            0.6f to Color.Transparent,
                            1f to Color.Black.copy(alpha = 0.8f)
                        )
                    )
            )
        }

        // LAYER 3: KuraStream Custom Compose Controls
        AnimatedVisibility(
            visible = state.controlsVisible && !state.controlsLocked,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.fillMaxSize()
        ) {
            Box(modifier = Modifier.fillMaxSize()) {
                // TOP BAR: back, titles, compact actions
                Row(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .fillMaxWidth()
                        .statusBarsPadding()
                        .padding(horizontal = KuraDimens.Space4, vertical = KuraDimens.Space2),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = {
                        viewModel.saveCurrentProgress()
                        onNavigateBack()
                    }) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Volver",
                            tint = Color.White
                        )
                    }

                    Spacer(modifier = Modifier.width(KuraDimens.Space1))

                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = state.show?.title ?: "",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = Color.White,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        val ep = state.episode
                        if (ep != null) {
                            val epLabel = if (ep.seasonNumber == 0) "Especial ${ep.episodeNumber}" else "T${ep.seasonNumber}:E${ep.episodeNumber}"
                            val partyLabel = when {
                                !state.isWatchPartyActive -> ""
                                state.isPartyHost -> " · Watch Party (anfitrión)"
                                else -> " · Watch Party"
                            }
                            Text(
                                text = "$epLabel · ${ep.title.ifBlank { "Episodio ${ep.episodeNumber}" }}$partyLabel",
                                style = MaterialTheme.typography.labelSmall,
                                color = Color.White.copy(alpha = 0.7f),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }

                    // Watch Party: the icon turns mint with a live dot while a room is active; inside a
                    // room it opens the chat (with an unread count), like the web sidebar.
                    IconButton(onClick = {
                        if (state.isWatchPartyActive) {
                            showPartyChat = true
                        } else {
                            partyRoomNameInput = state.show?.let { "${it.title} - T${state.episode?.seasonNumber}E${state.episode?.episodeNumber}" } ?: "Watch Party"
                            showCreatePartyDialog = true
                        }
                    }) {
                        Box {
                            Icon(
                                imageVector = Icons.Default.Group,
                                contentDescription = if (state.isWatchPartyActive) "Watch Party activa" else "Watch Party",
                                tint = if (state.isWatchPartyActive) KuraColors.Secondary else Color.White
                            )
                            if (state.isWatchPartyActive && state.partyUnreadCount > 0) {
                                Box(
                                    modifier = Modifier
                                        .align(Alignment.TopEnd)
                                        .offset(x = 6.dp, y = (-6).dp)
                                        .size(16.dp)
                                        .background(KuraColors.Danger, CircleShape),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        text = if (state.partyUnreadCount > 9) "9+" else state.partyUnreadCount.toString(),
                                        color = Color.White,
                                        fontSize = 9.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            } else if (state.isWatchPartyActive) {
                                Box(
                                    modifier = Modifier
                                        .align(Alignment.TopEnd)
                                        .size(7.dp)
                                        .background(KuraColors.Secondary, CircleShape)
                                )
                            }
                        }
                    }

                    IconButton(onClick = viewModel::toggleLock) {
                        Icon(
                            imageVector = Icons.Default.LockOpen,
                            contentDescription = "Bloquear controles",
                            tint = Color.White
                        )
                    }

                    // PiP (minSdk 26+)
                    IconButton(onClick = {
                        val act = context as? Activity
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && act != null && act.supportsPictureInPicture()) {
                            act.enterPictureInPictureMode(PipController.buildParams(act, state.isPlaying, false))
                        }
                    }) {
                        Icon(
                            imageVector = Icons.Default.PictureInPicture,
                            contentDescription = "Imagen en imagen",
                            tint = Color.White
                        )
                    }
                }

                // CENTER: rewind / play-pause / forward, plain icons over the picture
                Row(
                    modifier = Modifier.align(Alignment.Center),
                    horizontalArrangement = Arrangement.spacedBy(56.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(
                        onClick = {
                            viewModel.seekRelative(-10f)
                            showGestureHud("-10s", Icons.Default.Replay10)
                        },
                        modifier = Modifier.size(56.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Replay10,
                            contentDescription = "Retroceder 10s",
                            tint = Color.White,
                            modifier = Modifier.size(40.dp)
                        )
                    }

                    IconButton(
                        onClick = viewModel::togglePlayPause,
                        modifier = Modifier.size(72.dp)
                    ) {
                        Icon(
                            imageVector = if (state.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = if (state.isPlaying) "Pausar" else "Reproducir",
                            tint = Color.White,
                            modifier = Modifier.size(60.dp)
                        )
                    }

                    IconButton(
                        onClick = {
                            viewModel.seekRelative(10f)
                            showGestureHud("+10s", Icons.Default.Forward10)
                        },
                        modifier = Modifier.size(56.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Forward10,
                            contentDescription = "Adelantar 10s",
                            tint = Color.White,
                            modifier = Modifier.size(40.dp)
                        )
                    }
                }

                // BOTTOM: skip buttons, thin timeline, labelled secondary actions
                Column(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(horizontal = KuraDimens.Space5)
                        .padding(bottom = KuraDimens.Space2)
                ) {
                    if (state.isInIntro) {
                        KuraButton(
                            onClick = viewModel::skipIntro,
                            text = stringResource(R.string.skip_intro),
                            modifier = Modifier.align(Alignment.End),
                            leadingIcon = {
                                Icon(imageVector = Icons.Default.SkipNext, contentDescription = null)
                            }
                        )
                        Spacer(modifier = Modifier.height(KuraDimens.Space3))
                    } else if (state.isInCredits) {
                        KuraButton(
                            onClick = { viewModel.skipCredits() },
                            text = stringResource(R.string.skip_credits),
                            modifier = Modifier.align(Alignment.End),
                            leadingIcon = {
                                Icon(imageVector = Icons.Default.SkipNext, contentDescription = null)
                            }
                        )
                        Spacer(modifier = Modifier.height(KuraDimens.Space3))
                    } else if (state.isInOutro && state.nextEpisode != null && !state.upNextVisible) {
                        KuraButton(
                            onClick = { viewModel.playNextEpisode() },
                            text = stringResource(R.string.next_episode),
                            modifier = Modifier.align(Alignment.End),
                            leadingIcon = {
                                Icon(imageVector = Icons.Default.SkipNext, contentDescription = null)
                            }
                        )
                        Spacer(modifier = Modifier.height(KuraDimens.Space3))
                    }

                    val duration = state.durationSeconds.coerceAtLeast(1f)
                    val currentDisplayPos = (if (isScrubbing) scrubPosition else state.absolutePositionSeconds)
                        .coerceIn(0f, duration)
                    // bufferedPercentage is relative to the current stream, which starts at the
                    // transcode offset when the server remuxes from a seek point.
                    val offset = state.streamStartOffsetSeconds.coerceIn(0f, duration)
                    val bufferedPos = offset + (duration - offset) * (state.bufferedPercentage / 100f)

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = formatTime(currentDisplayPos),
                            style = MaterialTheme.typography.labelSmall,
                            color = Color.White
                        )

                        ThinSeekBar(
                            position = currentDisplayPos,
                            buffered = bufferedPos,
                            duration = duration,
                            chapters = state.chapters,
                            introStart = state.episode?.introStart,
                            introEnd = state.episode?.introEnd,
                            isDragging = isScrubbing,
                            onScrub = { target ->
                                isScrubbing = true
                                scrubPosition = target
                                viewModel.onUserInteraction()
                            },
                            onScrubFinished = {
                                isScrubbing = false
                                viewModel.seekToAbsolute(scrubPosition)
                            },
                            modifier = Modifier
                                .weight(1f)
                                .padding(horizontal = KuraDimens.Space3)
                        )

                        Text(
                            text = "-${formatTime(duration - currentDisplayPos)}",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color.White.copy(alpha = 0.8f)
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        PlayerTextAction(
                            icon = Icons.Default.Speed,
                            label = if (state.isWatchPartyActive) "Velocidad (1x fija)" else "Velocidad (${formatSpeed(state.playbackSpeed)})",
                            onClick = {
                                if (state.isWatchPartyActive) showGestureHud("La velocidad es fija durante un Watch Party", Icons.Default.Info)
                                else showSpeedSheet = true
                            }
                        )
                        if (state.showEpisodes.size > 1) {
                            PlayerTextAction(
                                icon = Icons.Default.VideoLibrary,
                                label = "Episodios",
                                onClick = {
                                    viewModel.loadEpisodeProgress()
                                    showEpisodesPanel = true
                                }
                            )
                        }
                        PlayerTextAction(
                            icon = Icons.Default.Subtitles,
                            label = "Audio y subtítulos",
                            onClick = { showTracksSheet = true }
                        )
                        PlayerTextAction(
                            icon = Icons.Default.AspectRatio,
                            label = when (state.videoFitMode) {
                                VideoFitMode.FIT -> "Ajustar"
                                VideoFitMode.ZOOM -> "Zoom"
                                VideoFitMode.STRETCH -> "Estirar"
                            },
                            onClick = viewModel::toggleFitMode
                        )
                        if (state.nextEpisode != null && (!state.isWatchPartyActive || state.isPartyHost)) {
                            PlayerTextAction(
                                icon = Icons.Default.SkipNext,
                                label = "Siguiente episodio",
                                onClick = { viewModel.playNextEpisode() }
                            )
                        }
                    }
                }
            }
        }

        // Resume notice with a one-tap "start over"
        AnimatedVisibility(
            visible = state.resumedFromSeconds != null && !showEpisodesPanel,
            enter = fadeIn() + slideInVertically { -it / 2 },
            exit = fadeOut(),
            modifier = Modifier
                .align(Alignment.TopCenter)
                .statusBarsPadding()
                .padding(top = 64.dp)
        ) {
            Surface(
                shape = KuraShapes.Pill,
                color = KuraColors.Background.copy(alpha = 0.9f),
                border = BorderStroke(1.dp, KuraColors.Border)
            ) {
                Row(
                    modifier = Modifier.padding(start = KuraDimens.Space4, end = KuraDimens.Space1),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Reanudado en ${formatTime(state.resumedFromSeconds ?: 0f)}",
                        style = MaterialTheme.typography.labelMedium,
                        color = Color.White
                    )
                    TextButton(onClick = viewModel::restartFromBeginning) {
                        Icon(
                            imageVector = Icons.Default.Replay,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Desde el principio", style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }

        AnimatedVisibility(
            visible = showEpisodesPanel,
            enter = fadeIn() + slideInHorizontally { it / 3 },
            exit = fadeOut() + slideOutHorizontally { it / 3 },
            modifier = Modifier.fillMaxSize()
        ) {
            EpisodesPanel(
                episodes = state.showEpisodes,
                currentEpisodeId = viewModel.episodeId,
                progress = state.episodeProgress,
                completed = state.episodeCompleted,
                baseUrl = state.mediaBaseUrl,
                onSelect = { ep ->
                    showEpisodesPanel = false
                    viewModel.playEpisode(ep.id)
                },
                onDismiss = { showEpisodesPanel = false }
            )
        }

        AnimatedVisibility(
            visible = showPartyChat && state.isWatchPartyActive,
            enter = fadeIn() + slideInHorizontally { it / 3 },
            exit = fadeOut() + slideOutHorizontally { it / 3 },
            modifier = Modifier.fillMaxSize()
        ) {
            PartyChatPanel(
                roomId = state.watchPartyRoomId.orEmpty(),
                isHost = state.isPartyHost,
                canControl = state.canControlPlayback,
                messages = state.partyMessages,
                onSend = viewModel::sendPartyMessage,
                onReaction = viewModel::sendPartyReaction,
                onLeave = {
                    showPartyChat = false
                    showPartyInfoDialog = true
                },
                onDismiss = { showPartyChat = false }
            )
        }

        // End of episode with nothing auto-advancing (same choices as the web end screen)
        AnimatedVisibility(
            visible = state.endScreenVisible && !showEpisodesPanel && !showPartyChat,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.fillMaxSize()
        ) {
            EndScreen(
                title = when {
                    state.nextEpisode != null -> "Has terminado este episodio"
                    state.show?.mediaType.equals("movie", ignoreCase = true) -> "Fin de la película"
                    else -> "Has llegado al final de la serie"
                },
                nextLabel = state.nextEpisode?.let { next ->
                    if (next.seasonNumber == 0) "Especial ${next.episodeNumber}" else "T${next.seasonNumber}:E${next.episodeNumber}"
                }?.takeIf { !state.isWatchPartyActive || state.isPartyHost },
                canReplay = state.canControlPlayback,
                onNext = { viewModel.playNextEpisode() },
                onReplay = viewModel::replayEpisode,
                onBack = {
                    viewModel.saveCurrentProgress()
                    onNavigateBack()
                }
            )
        }

        // Reactions from the room float up on the right edge (the web "flying reactions").
        val lastReaction = state.partyMessages.lastOrNull { it.type == "reaction" }
        val initialReactionId = remember { lastReaction?.id }
        var floatingReaction by remember { mutableStateOf<String?>(null) }
        LaunchedEffect(lastReaction?.id) {
            val reaction = lastReaction ?: return@LaunchedEffect
            if (reaction.id == initialReactionId) return@LaunchedEffect
            floatingReaction = PARTY_REACTIONS.firstOrNull { it.first == reaction.message }?.second
                ?: reaction.message.takeIf { it.length <= 4 }
            delay(1800)
            floatingReaction = null
        }
        AnimatedVisibility(
            visible = floatingReaction != null,
            enter = fadeIn() + slideInVertically { it },
            exit = fadeOut() + slideOutVertically { -it },
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .padding(end = 40.dp)
        ) {
            Text(text = floatingReaction.orEmpty(), fontSize = 44.sp)
        }

        // Lock HUD: When locked, tapping anywhere reveals this unlock button for 3s
        if (state.controlsLocked && state.controlsVisible) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .statusBarsPadding()
                    .padding(KuraDimens.Space5)
            ) {
                IconButton(
                    onClick = viewModel::toggleLock,
                    modifier = Modifier
                        .size(48.dp)
                        .background(KuraColors.Background.copy(alpha = 0.85f), CircleShape)
                        .border(1.dp, KuraColors.Primary, CircleShape)
                ) {
                    Icon(
                        imageVector = Icons.Default.Lock,
                        contentDescription = "Desbloquear controles",
                        tint = KuraColors.Primary
                    )
                }
            }
        }

        // Fast Forward 2X Temporary Pill
        if (state.playbackSpeed > 1.0f && !state.controlsVisible) {
            Surface(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .statusBarsPadding()
                    .padding(top = 16.dp),
                shape = CircleShape,
                color = KuraColors.Primary.copy(alpha = 0.9f)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.FastForward,
                        contentDescription = null,
                        tint = KuraColors.Background,
                        modifier = Modifier.size(16.dp)
                    )
                    Text(
                        text = "${state.playbackSpeed}x",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        color = KuraColors.Background
                    )
                }
            }
        }

        // Gesture Feedback HUD
        AnimatedVisibility(
            visible = gestureHudVisible && gestureHudText != null,
            enter = fadeIn(animationSpec = tween(120)) + scaleIn(initialScale = 0.92f, animationSpec = tween(120)),
            exit = fadeOut(animationSpec = tween(220)),
            modifier = Modifier.align(Alignment.Center)
        ) {
            Surface(
                modifier = Modifier
                    .padding(16.dp),
                shape = KuraShapes.Modal,
                color = KuraColors.Background.copy(alpha = 0.88f),
                border = BorderStroke(1.dp, KuraColors.Border)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    gestureHudIcon?.let { icon ->
                        Icon(
                            imageVector = icon,
                            contentDescription = null,
                            tint = KuraColors.Primary,
                            modifier = Modifier.size(28.dp)
                        )
                    }
                    Text(
                        text = gestureHudText.orEmpty(),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = KuraColors.TextMain
                    )
                }
            }
        }

        // Buffering Indicator
        if (state.isBuffering && !state.isPlaying) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(
                    color = KuraColors.Primary,
                    strokeWidth = 3.dp,
                    modifier = Modifier.size(48.dp)
                )
            }
        }

        // Error Banner
        if (state.errorMessage != null) {
            Surface(
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(KuraDimens.Space6),
                shape = KuraShapes.Modal,
                color = KuraColors.Surface,
                border = BorderStroke(1.dp, if (state.isTranscodingBusy) KuraColors.Primary else KuraColors.Danger)
            ) {
                Column(
                    modifier = Modifier.padding(KuraDimens.Space5),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    if (state.isTranscodingBusy) {
                        CircularProgressIndicator(
                            color = KuraColors.Primary,
                            strokeWidth = 3.dp,
                            modifier = Modifier.size(32.dp)
                        )
                        Spacer(modifier = Modifier.height(KuraDimens.Space2))
                    }
                    Text(
                        text = state.errorMessage!!,
                        style = MaterialTheme.typography.bodyMedium,
                        color = KuraColors.TextMain
                    )
                    if (!state.isTranscodingBusy) {
                        Spacer(modifier = Modifier.height(KuraDimens.Space3))
                        KuraButton(
                            onClick = viewModel::retryPlayback,
                            text = stringResource(R.string.retry)
                        )
                    }
                }
            }
        }

        // Up next: thumbnail, title and (with autoplay) a countdown that waits while paused
        val upNext = state.nextEpisode
        AnimatedVisibility(
            visible = state.upNextVisible && upNext != null && !showEpisodesPanel,
            enter = fadeIn() + slideInVertically { it / 3 },
            exit = fadeOut(),
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .navigationBarsPadding()
                .padding(end = KuraDimens.Space5, bottom = if (state.controlsVisible) 120.dp else KuraDimens.Space5)
        ) {
            if (upNext != null) {
                UpNextCard(
                    episode = upNext,
                    baseUrl = state.mediaBaseUrl,
                    countdown = state.nextEpisodeCountdown,
                    onPlay = { viewModel.playNextEpisode() },
                    onDismiss = viewModel::cancelNextEpisodeCountdown
                )
            }
        }

        // Audio & Subtitles Bottom Sheet
        if (showTracksSheet) {
            ModalBottomSheet(
                onDismissRequest = { showTracksSheet = false },
                containerColor = KuraColors.Surface,
                dragHandle = { BottomSheetDefaults.DragHandle(color = KuraColors.Border) }
            ) {
                // The player is in landscape, so a long track list must scroll inside the sheet.
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(KuraDimens.Space5)
                ) {
                    Text(
                        text = stringResource(R.string.audio_and_subtitles),
                        style = MaterialTheme.typography.titleLarge,
                        color = KuraColors.TextMain,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(KuraDimens.Space4))

                    // Audio Tracks
                    Text(
                        text = stringResource(R.string.audio),
                        style = MaterialTheme.typography.titleMedium,
                        color = KuraColors.Secondary
                    )
                    Spacer(modifier = Modifier.height(KuraDimens.Space2))
                    val audioLabels = TrackLabels.audio(state.availableAudioTracks)
                    state.availableAudioTracks.forEachIndexed { index, _ ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(KuraShapes.Control)
                                .clickable {
                                    viewModel.selectAudioTrack(index)
                                    showTracksSheet = false
                                }
                                .padding(vertical = KuraDimens.Space2, horizontal = KuraDimens.Space3),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            TrackLabelText(
                                label = audioLabels[index],
                                selected = state.selectedAudioTrackIndex == index
                            )
                            if (state.selectedAudioTrackIndex == index) {
                                Icon(imageVector = Icons.Default.Check, contentDescription = null, tint = KuraColors.Primary)
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(KuraDimens.Space4))

                    // Subtitle Tracks
                    Text(
                        text = stringResource(R.string.subtitles),
                        style = MaterialTheme.typography.titleMedium,
                        color = KuraColors.Secondary
                    )
                    Spacer(modifier = Modifier.height(KuraDimens.Space2))

                    // Disabled Option
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(KuraShapes.Control)
                            .clickable {
                                viewModel.selectSubtitleTrack(-1)
                                showTracksSheet = false
                            }
                            .padding(vertical = KuraDimens.Space2, horizontal = KuraDimens.Space3),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = stringResource(R.string.subtitles_off),
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (state.selectedSubtitleTrackIndex == -1) KuraColors.Primary else KuraColors.TextMain
                        )
                        if (state.selectedSubtitleTrackIndex == -1) {
                            Icon(imageVector = Icons.Default.Check, contentDescription = null, tint = KuraColors.Primary)
                        }
                    }

                    val subtitleLabels = TrackLabels.subtitles(state.availableSubtitleTracks)
                    state.availableSubtitleTracks.forEachIndexed { index, _ ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(KuraShapes.Control)
                                .clickable {
                                    viewModel.selectSubtitleTrack(index)
                                    showTracksSheet = false
                                }
                                .padding(vertical = KuraDimens.Space2, horizontal = KuraDimens.Space3),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            TrackLabelText(
                                label = subtitleLabels[index],
                                selected = state.selectedSubtitleTrackIndex == index
                            )
                            if (state.selectedSubtitleTrackIndex == index) {
                                Icon(imageVector = Icons.Default.Check, contentDescription = null, tint = KuraColors.Primary)
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(KuraDimens.Space4))
                    Text(
                        text = "Tamaño de subtítulos",
                        style = MaterialTheme.typography.titleMedium,
                        color = KuraColors.Secondary
                    )
                    Spacer(modifier = Modifier.height(KuraDimens.Space2))
                    Row(horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space2)) {
                        listOf(
                            0f to "Original",
                            0.8f to "Pequeño",
                            1.3f to "Grande",
                            1.6f to "Muy grande"
                        ).forEach { (scale, label) ->
                            FilterChip(
                                selected = state.subtitleScale == scale,
                                onClick = { viewModel.setSubtitleScale(scale) },
                                label = { Text(label) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = KuraColors.PrimarySoft,
                                    selectedLabelColor = KuraColors.Primary,
                                    containerColor = KuraColors.SurfaceRaised,
                                    labelColor = KuraColors.TextSecondary
                                )
                            )
                        }
                    }

                    state.episode?.let { ep ->
                        val details = listOfNotNull(
                            ep.resolution.takeIf { it.isNotBlank() },
                            ep.videoCodec.takeIf { it.isNotBlank() }?.uppercase(),
                            ep.fps.takeIf { it > 0f }?.let { "${it.toInt()} fps" },
                            ep.size.takeIf { it > 0L }?.let { formatBytes(it) },
                            ep.container.takeIf { it.isNotBlank() }?.uppercase()
                        )
                        if (details.isNotEmpty()) {
                            Spacer(modifier = Modifier.height(KuraDimens.Space4))
                            Text(
                                text = "Información del archivo",
                                style = MaterialTheme.typography.titleMedium,
                                color = KuraColors.Secondary
                            )
                            Spacer(modifier = Modifier.height(KuraDimens.Space1))
                            Text(
                                text = details.joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                                color = KuraColors.TextSecondary
                            )
                        }
                    }
                }
            }
        }

        // Playback Speed Bottom Sheet
        if (showSpeedSheet) {
            ModalBottomSheet(
                onDismissRequest = { showSpeedSheet = false },
                containerColor = KuraColors.Surface,
                dragHandle = { BottomSheetDefaults.DragHandle(color = KuraColors.Border) }
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(KuraDimens.Space5)
                ) {
                    Text(
                        text = stringResource(R.string.playback_speed),
                        style = MaterialTheme.typography.titleLarge,
                        color = KuraColors.TextMain,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(KuraDimens.Space3))

                    val speeds = listOf(0.5f, 0.75f, 1.0f, 1.25f, 1.5f, 2.0f)
                    speeds.forEach { speed ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(KuraShapes.Control)
                                .clickable {
                                    viewModel.setPlaybackSpeed(speed)
                                    showSpeedSheet = false
                                }
                                .padding(vertical = KuraDimens.Space3, horizontal = KuraDimens.Space3),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "${speed}x",
                                style = MaterialTheme.typography.bodyLarge,
                                color = if (state.playbackSpeed == speed) KuraColors.Primary else KuraColors.TextMain
                            )
                            if (state.playbackSpeed == speed) {
                                Icon(imageVector = Icons.Default.Check, contentDescription = null, tint = KuraColors.Primary)
                            }
                        }
                    }
                }
            }
        }

        // Dialog: Create Watch Party
        if (showCreatePartyDialog) {
            AlertDialog(
                onDismissRequest = { showCreatePartyDialog = false },
                containerColor = KuraColors.Surface,
                title = {
                    Text(
                        text = "Crear Watch Party",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = KuraColors.TextMain
                    )
                },
                text = {
                    Column {
                        Text(
                            text = "Transmite este episodio sincronizado con tus amigos en tiempo real.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = KuraColors.TextSecondary
                        )
                        Spacer(modifier = Modifier.height(KuraDimens.Space3))
                        OutlinedTextField(
                            value = partyRoomNameInput,
                            onValueChange = { partyRoomNameInput = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Nombre de la sala") },
                            singleLine = true,
                            shape = KuraShapes.Control,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = KuraColors.Secondary,
                                unfocusedBorderColor = KuraColors.Border,
                                focusedTextColor = KuraColors.TextMain,
                                unfocusedTextColor = KuraColors.TextMain,
                                focusedContainerColor = KuraColors.SurfaceRaised,
                                unfocusedContainerColor = KuraColors.SurfaceRaised
                            )
                        )
                    }
                },
                confirmButton = {
                    KuraButton(
                        onClick = {
                            viewModel.createWatchParty(roomName = partyRoomNameInput)
                            showCreatePartyDialog = false
                        },
                        text = "Crear Sala"
                    )
                },
                dismissButton = {
                    TextButton(onClick = { showCreatePartyDialog = false }) {
                        Text("Cancelar", color = KuraColors.TextMuted)
                    }
                }
            )
        }

        // Dialog: Active Watch Party Info / Leave
        if (showPartyInfoDialog) {
            AlertDialog(
                onDismissRequest = { showPartyInfoDialog = false },
                containerColor = KuraColors.Surface,
                title = {
                    Text(
                        text = "Watch Party Activa",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = KuraColors.TextMain
                    )
                },
                text = {
                    Column {
                        Text(
                            text = "Estás conectado a la sala:",
                            style = MaterialTheme.typography.bodyMedium,
                            color = KuraColors.TextSecondary
                        )
                        Spacer(modifier = Modifier.height(KuraDimens.Space2))
                        Text(
                            text = state.watchPartyRoomId ?: "Sala Compartida",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = KuraColors.Secondary
                        )
                        Spacer(modifier = Modifier.height(KuraDimens.Space2))
                        Text(
                            text = "La reproducción de video se mantiene sincronizada con el anfitrión y participantes de la sala.",
                            style = MaterialTheme.typography.bodySmall,
                            color = KuraColors.TextMuted
                        )
                    }
                },
                confirmButton = {
                    KuraOutlinedButton(
                        onClick = {
                            viewModel.leaveWatchParty()
                            showPartyInfoDialog = false
                        },
                        text = "Abandonar sala"
                    )
                },
                dismissButton = {
                    TextButton(onClick = { showPartyInfoDialog = false }) {
                        Text("Cerrar", color = KuraColors.TextMuted)
                    }
                }
            )
        }
    }
}

/** Video surface bound to the service-hosted player; shared by the full UI and the PiP window. */
@OptIn(UnstableApi::class)
@Composable
private fun PlayerSurface(
    player: Player?,
    fitMode: VideoFitMode,
    keepScreenOn: Boolean,
    modifier: Modifier = Modifier,
    subtitleScale: Float = 0f
) {
    if (player == null) return
    val resizeMode = when (fitMode) {
        VideoFitMode.FIT -> AspectRatioFrameLayout.RESIZE_MODE_FIT
        VideoFitMode.ZOOM -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
        VideoFitMode.STRETCH -> AspectRatioFrameLayout.RESIZE_MODE_FILL
    }
    AndroidView(
        factory = { ctx ->
            PlayerView(ctx).apply {
                this.player = player
                useController = false
                this.resizeMode = resizeMode
                layoutParams = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            }
        },
        update = { pv ->
            if (pv.player !== player) pv.player = player
            pv.resizeMode = resizeMode
            // Without this the display times out mid-episode.
            pv.keepScreenOn = keepScreenOn
            pv.subtitleView?.let { subs ->
                if (subtitleScale > 0f) {
                    // A chosen size has to override the per-line sizes ASS files carry.
                    subs.setApplyEmbeddedFontSizes(false)
                    subs.setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * subtitleScale)
                } else {
                    subs.setApplyEmbeddedFontSizes(true)
                    subs.setUserDefaultTextSize()
                }
            }
        },
        onRelease = { pv -> pv.player = null },
        modifier = modifier
    )
}

/**
 * Netflix-style episode picker that slides in from the right over the video, which keeps playing.
 * Seasons are chips at the top; the current episode is highlighted and cannot be re-selected.
 */
@Composable
private fun EpisodesPanel(
    episodes: List<Episode>,
    currentEpisodeId: String,
    progress: Map<String, Float>,
    completed: Map<String, Boolean>,
    baseUrl: String,
    onSelect: (Episode) -> Unit,
    onDismiss: () -> Unit
) {
    val seasons = remember(episodes) { episodes.map { it.seasonNumber }.distinct().sorted() }
    val currentSeason = episodes.firstOrNull { it.id == currentEpisodeId }?.seasonNumber ?: seasons.firstOrNull() ?: 1
    var selectedSeason by remember(currentSeason) { mutableIntStateOf(currentSeason) }
    val seasonEpisodes = episodes.filter { it.seasonNumber == selectedSeason }
    val listState = rememberLazyListState()

    // Open scrolled to the episode being watched
    LaunchedEffect(selectedSeason) {
        val idx = seasonEpisodes.indexOfFirst { it.id == currentEpisodeId }
        if (idx > 0) listState.scrollToItem(idx)
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.55f))
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onDismiss
                )
        )

        Column(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .fillMaxHeight()
                .widthIn(max = 420.dp)
                .fillMaxWidth(0.55f)
                .background(KuraColors.Background.copy(alpha = 0.96f))
                // Swallow taps so they don't fall through to the scrim
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = {}
                )
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(vertical = KuraDimens.Space3)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = KuraDimens.Space4, end = KuraDimens.Space1),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Episodios",
                    style = MaterialTheme.typography.titleLarge,
                    color = Color.White,
                    modifier = Modifier.weight(1f)
                )
                IconButton(onClick = onDismiss) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "Cerrar episodios",
                        tint = Color.White
                    )
                }
            }

            if (seasons.size > 1) {
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space2),
                    contentPadding = PaddingValues(horizontal = KuraDimens.Space4),
                    modifier = Modifier.padding(bottom = KuraDimens.Space2)
                ) {
                    items(seasons) { season ->
                        FilterChip(
                            selected = season == selectedSeason,
                            onClick = { selectedSeason = season },
                            label = { Text("Temporada $season") },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = KuraColors.PrimarySoft,
                                selectedLabelColor = KuraColors.Primary,
                                containerColor = KuraColors.SurfaceRaised,
                                labelColor = KuraColors.TextSecondary
                            )
                        )
                    }
                }
            }

            LazyColumn(
                state = listState,
                contentPadding = PaddingValues(horizontal = KuraDimens.Space4, vertical = KuraDimens.Space1),
                verticalArrangement = Arrangement.spacedBy(KuraDimens.Space2),
                modifier = Modifier.weight(1f)
            ) {
                items(seasonEpisodes, key = { it.id }) { ep ->
                    val isCurrent = ep.id == currentEpisodeId
                    val epProgress = progress[ep.id] ?: 0f
                    val isDone = completed[ep.id] == true
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(KuraShapes.Card)
                            .background(if (isCurrent) KuraColors.SurfaceRaised else Color.Transparent)
                            .clickable(enabled = !isCurrent) { onSelect(ep) }
                            .padding(KuraDimens.Space2),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(width = 112.dp, height = 63.dp)
                                .clip(KuraShapes.Control)
                                .background(KuraColors.SurfaceRaised)
                        ) {
                            KuraAsyncImage(
                                model = ServerUrlResolver.buildMediaUrl(baseUrl, ep.thumbnailPath),
                                contentDescription = ep.title,
                                modifier = Modifier.fillMaxSize()
                            )
                            if (isCurrent) {
                                Box(
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .background(Color.Black.copy(alpha = 0.45f)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.GraphicEq,
                                        contentDescription = null,
                                        tint = KuraColors.Primary
                                    )
                                }
                            }
                            if (isDone || (ep.duration > 0 && epProgress > 5f)) {
                                val pct = if (ep.duration > 0) (epProgress / ep.duration).coerceIn(0f, 1f) else 0f
                                Box(
                                    modifier = Modifier
                                        .align(Alignment.BottomStart)
                                        .fillMaxWidth()
                                        .padding(horizontal = 5.dp, vertical = 4.dp)
                                        .height(3.dp)
                                        .clip(KuraShapes.Pill)
                                        .background(Color.White.copy(alpha = 0.3f))
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .fillMaxHeight()
                                            .fillMaxWidth(if (isDone) 1f else pct)
                                            .background(if (isDone) KuraColors.Success else KuraColors.Primary)
                                    )
                                }
                            }
                        }

                        Spacer(modifier = Modifier.width(KuraDimens.Space3))

                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "${ep.episodeNumber}. ${ep.title.ifBlank { "Episodio ${ep.episodeNumber}" }}",
                                style = MaterialTheme.typography.titleSmall,
                                color = if (isCurrent) KuraColors.Primary else Color.White,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis
                            )
                            Spacer(modifier = Modifier.height(2.dp))
                            Text(
                                text = when {
                                    isCurrent -> "Reproduciendo"
                                    isDone -> "Visto"
                                    ep.duration > 0 && epProgress > 5f ->
                                        "Quedan ${((ep.duration - epProgress) / 60f).toInt().coerceAtLeast(1)} min"
                                    ep.duration > 0 -> "${(ep.duration / 60f).toInt().coerceAtLeast(1)} min"
                                    else -> ""
                                },
                                style = MaterialTheme.typography.labelSmall,
                                color = when {
                                    isCurrent -> KuraColors.Primary
                                    isDone -> KuraColors.Success
                                    else -> Color.White.copy(alpha = 0.6f)
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Netflix-style timeline: 3dp track that thickens slightly while dragging, small thumb. Chapter
 * boundaries are small gaps in the track (like the web ticks) and dragging shows a time bubble
 * with the chapter name above the thumb.
 */
@Composable
private fun ThinSeekBar(
    position: Float,
    buffered: Float,
    duration: Float,
    chapters: List<Chapter>,
    introStart: Float?,
    introEnd: Float?,
    isDragging: Boolean,
    onScrub: (Float) -> Unit,
    onScrubFinished: () -> Unit,
    modifier: Modifier = Modifier
) {
    val trackHeight by animateDpAsState(if (isDragging) 5.dp else 3.dp, label = "seekTrack")
    val thumbSize by animateDpAsState(if (isDragging) 18.dp else 12.dp, label = "seekThumb")
    val played = (position / duration).coerceIn(0f, 1f)
    val bufferedFraction = (buffered / duration).coerceIn(played, 1f)
    var widthPx by remember { mutableFloatStateOf(1f) }
    val toSeconds = { x: Float -> (x / widthPx).coerceIn(0f, 1f) * duration }
    val ticks = remember(chapters, duration) {
        chapters.map { it.start }.filter { it > 1f && it < duration - 1f }.map { it / duration }
    }
    val introRange = if (introStart != null && introEnd != null && introEnd > introStart && duration > 0f) {
        (introStart / duration).coerceIn(0f, 1f) to (introEnd / duration).coerceIn(0f, 1f)
    } else null

    BoxWithConstraints(
        modifier = modifier
            // Tall touch target around a thin visual track
            .height(32.dp)
            .onSizeChanged { widthPx = it.width.toFloat().coerceAtLeast(1f) }
            .pointerInput(duration) {
                detectTapGestures { offset ->
                    onScrub(toSeconds(offset.x))
                    onScrubFinished()
                }
            }
            .pointerInput(duration) {
                detectHorizontalDragGestures(
                    onDragStart = { offset -> onScrub(toSeconds(offset.x)) },
                    onHorizontalDrag = { change, _ ->
                        change.consume()
                        onScrub(toSeconds(change.position.x))
                    },
                    onDragEnd = onScrubFinished,
                    onDragCancel = onScrubFinished
                )
            },
        contentAlignment = Alignment.CenterStart
    ) {
        val trackWidth = maxWidth
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(trackHeight)
                .clip(KuraShapes.Pill)
                .background(Color.White.copy(alpha = 0.25f))
        ) {
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(bufferedFraction)
                    .background(Color.White.copy(alpha = 0.35f))
            )
            introRange?.let { (start, end) ->
                Box(
                    modifier = Modifier
                        .offset(x = trackWidth * start)
                        .fillMaxHeight()
                        .width(trackWidth * (end - start))
                        .background(KuraColors.Secondary.copy(alpha = 0.35f))
                )
            }
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(played)
                    .background(KuraColors.Primary)
            )
            ticks.forEach { fraction ->
                Box(
                    modifier = Modifier
                        .offset(x = trackWidth * fraction - 1.dp)
                        .fillMaxHeight()
                        .width(2.dp)
                        .background(Color.Black.copy(alpha = 0.7f))
                )
            }
        }
        Box(
            modifier = Modifier
                .offset(x = (trackWidth * played) - thumbSize / 2)
                .size(thumbSize)
                .background(KuraColors.Primary, CircleShape)
        )
        if (isDragging) {
            val chapterName = chapters.lastOrNull { it.start <= position }?.title?.takeIf { it.isNotBlank() }
            val bubbleWidth = 120.dp
            val bubbleX = (trackWidth * played - bubbleWidth / 2).coerceIn(0.dp, (trackWidth - bubbleWidth).coerceAtLeast(0.dp))
            Column(
                modifier = Modifier
                    .offset(x = bubbleX, y = (-38).dp)
                    .width(bubbleWidth)
                    .background(KuraColors.Background.copy(alpha = 0.92f), KuraShapes.Control)
                    .border(1.dp, KuraColors.Border, KuraShapes.Control)
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = formatTime(position),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
                if (chapterName != null) {
                    Text(
                        text = chapterName,
                        style = MaterialTheme.typography.labelSmall,
                        color = KuraColors.TextSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }
    }
}

/** End of the episode: replay, next episode (when there is one) and back, centred over the video. */
@Composable
private fun EndScreen(
    title: String,
    nextLabel: String?,
    canReplay: Boolean,
    onNext: () -> Unit,
    onReplay: () -> Unit,
    onBack: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.72f))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = {}),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(KuraDimens.Space6)) {
            Text(
                text = title,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = Color.White
            )
            Spacer(modifier = Modifier.height(KuraDimens.Space5))
            Row(horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space3), verticalAlignment = Alignment.CenterVertically) {
                if (nextLabel != null) {
                    KuraButton(
                        onClick = onNext,
                        text = "Siguiente: $nextLabel",
                        leadingIcon = { Icon(imageVector = Icons.Default.SkipNext, contentDescription = null) }
                    )
                }
                if (canReplay) {
                    KuraOutlinedButton(onClick = onReplay, text = "Volver a ver")
                }
                TextButton(onClick = onBack) {
                    Text("Salir", color = KuraColors.TextSecondary)
                }
            }
        }
    }
}

/**
 * Watch Party chat over the video (the web sidebar, adapted): messages, quick reactions and an
 * input. The video keeps playing behind it.
 */
@Composable
private fun PartyChatPanel(
    roomId: String,
    isHost: Boolean,
    canControl: Boolean,
    messages: List<PartyMessage>,
    onSend: (String) -> Unit,
    onReaction: (String) -> Unit,
    onLeave: () -> Unit,
    onDismiss: () -> Unit
) {
    var input by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val visible = remember(messages) { messages.filter { it.type != "reaction" } }
    LaunchedEffect(visible.size) {
        if (visible.isNotEmpty()) listState.animateScrollToItem(visible.lastIndex)
    }
    val submit = {
        if (input.isNotBlank()) {
            onSend(input)
            input = ""
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onDismiss)
        )
        Column(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .fillMaxHeight()
                .widthIn(max = 380.dp)
                .fillMaxWidth(0.45f)
                .background(KuraColors.Background.copy(alpha = 0.94f))
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = {})
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
                .padding(vertical = KuraDimens.Space2)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = KuraDimens.Space4, end = KuraDimens.Space1),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Watch Party", style = MaterialTheme.typography.titleMedium, color = Color.White, fontWeight = FontWeight.Bold)
                    Text(
                        text = buildString {
                            append(roomId)
                            append(if (isHost) " · Anfitrión" else if (canControl) " · Controles compartidos" else " · El anfitrión controla")
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = KuraColors.Secondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                IconButton(onClick = onLeave) {
                    Icon(Icons.AutoMirrored.Filled.ExitToApp, contentDescription = "Salir de la sala", tint = KuraColors.TextSecondary)
                }
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = "Cerrar chat", tint = Color.White)
                }
            }

            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = KuraDimens.Space3, vertical = KuraDimens.Space2),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                if (visible.isEmpty()) {
                    item {
                        Text(
                            text = "Todavía no hay mensajes. ¡Saluda a la sala!",
                            style = MaterialTheme.typography.bodySmall,
                            color = KuraColors.TextMuted,
                            modifier = Modifier.padding(KuraDimens.Space2)
                        )
                    }
                }
                items(visible, key = { it.id }) { msg ->
                    if (msg.type == "system") {
                        Text(
                            text = msg.message,
                            style = MaterialTheme.typography.labelSmall,
                            color = KuraColors.TextMuted,
                            modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)
                        )
                    } else {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(KuraColors.SurfaceRaised, KuraShapes.Control)
                                .padding(horizontal = 10.dp, vertical = 6.dp)
                        ) {
                            Text(msg.username, style = MaterialTheme.typography.labelSmall, color = KuraColors.Primary, fontWeight = FontWeight.Bold)
                            Text(msg.message, style = MaterialTheme.typography.bodySmall, color = KuraColors.TextMain)
                        }
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = KuraDimens.Space2),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                PARTY_REACTIONS.forEach { (key, emoji) ->
                    TextButton(onClick = { onReaction(key) }, contentPadding = PaddingValues(4.dp)) {
                        Text(emoji, fontSize = 20.sp)
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = KuraDimens.Space3),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = input,
                    onValueChange = { input = it.take(500) },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Escribe un mensaje…", style = MaterialTheme.typography.bodySmall) },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodySmall,
                    shape = KuraShapes.Control,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { submit() }),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = KuraColors.Secondary,
                        unfocusedBorderColor = KuraColors.Border,
                        focusedTextColor = KuraColors.TextMain,
                        unfocusedTextColor = KuraColors.TextMain,
                        focusedContainerColor = KuraColors.SurfaceRaised,
                        unfocusedContainerColor = KuraColors.SurfaceRaised
                    )
                )
                IconButton(onClick = { submit() }, enabled = input.isNotBlank()) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Enviar", tint = if (input.isNotBlank()) KuraColors.Secondary else KuraColors.TextMuted)
                }
            }
        }
    }
}

/** Same reaction keys as the web player (js/modules/party.js REACTION_ICONS). */
private val PARTY_REACTIONS = listOf(
    "flame" to "🔥",
    "heart" to "❤️",
    "smile" to "😄",
    "sparkles" to "✨",
    "thumbs-up" to "👍"
)

private fun formatBytes(bytes: Long): String {
    val gb = bytes / 1_073_741_824.0
    return if (gb >= 1) String.format(java.util.Locale.US, "%.2f GB", gb)
    else String.format(java.util.Locale.US, "%.0f MB", bytes / 1_048_576.0)
}

/** Icon + small label button used in the player's bottom row. */
@Composable
private fun PlayerTextAction(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit
) {
    TextButton(
        onClick = onClick,
        colors = ButtonDefaults.textButtonColors(contentColor = Color.White),
        contentPadding = PaddingValues(horizontal = KuraDimens.Space2, vertical = KuraDimens.Space1)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(20.dp)
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

private fun formatSpeed(speed: Float): String {
    return if (speed % 1f == 0f) "${speed.toInt()}x" else "${speed}x"
}

private fun formatTime(seconds: Float): String {
    val totalSec = seconds.toInt().coerceAtLeast(0)
    val hrs = totalSec / 3600
    val mins = (totalSec % 3600) / 60
    val secs = totalSec % 60
    return if (hrs > 0) {
        String.format(java.util.Locale.US, "%d:%02d:%02d", hrs, mins, secs)
    } else {
        String.format(java.util.Locale.US, "%02d:%02d", mins, secs)
    }
}

@Composable
private fun TrackLabelText(label: TrackLabel, selected: Boolean) {
    Column {
        Text(
            text = label.label,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = if (selected) KuraColors.Primary else KuraColors.TextMain
        )
        if (label.detail.isNotBlank()) {
            Text(
                text = label.detail,
                style = MaterialTheme.typography.labelSmall,
                color = KuraColors.TextMuted
            )
        }
    }
}

@Composable
private fun UpNextCard(
    episode: Episode,
    baseUrl: String,
    countdown: Int?,
    onPlay: () -> Unit,
    onDismiss: () -> Unit
) {
    Surface(
        modifier = Modifier.widthIn(max = 420.dp),
        shape = KuraShapes.Modal,
        color = KuraColors.Surface.copy(alpha = 0.96f),
        border = BorderStroke(1.dp, KuraColors.BorderStrong),
        tonalElevation = 8.dp
    ) {
        Row(
            modifier = Modifier.padding(KuraDimens.Space3),
            horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space3),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .width(136.dp)
                    .aspectRatio(16f / 9f)
                    .clip(KuraShapes.Small)
                    .background(Color.Black),
                contentAlignment = Alignment.Center
            ) {
                KuraAsyncImage(
                    model = ServerUrlResolver.buildMediaUrl(baseUrl, episode.thumbnailPath),
                    contentDescription = null,
                    modifier = Modifier.fillMaxSize()
                )
                if (countdown != null) {
                    Box(
                        modifier = Modifier
                            .size(42.dp)
                            .background(KuraColors.Background.copy(alpha = 0.85f), CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(
                            progress = { 1f - (countdown.coerceIn(0, 10) / 10f) },
                            modifier = Modifier.fillMaxSize(),
                            color = KuraColors.Primary,
                            trackColor = Color.White.copy(alpha = 0.2f),
                            strokeWidth = 3.dp
                        )
                        Text(
                            text = countdown.toString(),
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.Bold,
                            color = Color.White
                        )
                    }
                }
            }
            Column(modifier = Modifier.weight(1f, fill = false)) {
                Text(
                    text = "SIGUIENTE EPISODIO",
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = KuraColors.Primary
                )
                Text(
                    text = episode.title.ifBlank { "Episodio ${episode.episodeNumber}" },
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = KuraColors.TextMain,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = if (episode.seasonNumber == 0) "Especial ${episode.episodeNumber}" else "T${episode.seasonNumber} · E${episode.episodeNumber}",
                    style = MaterialTheme.typography.labelSmall,
                    color = KuraColors.TextMuted
                )
                Spacer(modifier = Modifier.height(KuraDimens.Space2))
                Row(horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space2)) {
                    KuraButton(
                        onClick = onPlay,
                        text = "Ver ahora",
                        leadingIcon = { Icon(imageVector = Icons.Default.PlayArrow, contentDescription = null) }
                    )
                    TextButton(onClick = onDismiss) {
                        Text(if (countdown != null) "Ver créditos" else "Cerrar", color = KuraColors.TextSecondary)
                    }
                }
            }
        }
    }
}

/**
 * Picture-in-picture is a hardware/OS feature: Android Go builds and some tablets do not have it, and calling
 * enterPictureInPictureMode / setPictureInPictureParams there throws (the app closed).
 */
private fun Activity.supportsPictureInPicture(): Boolean =
    packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE)
