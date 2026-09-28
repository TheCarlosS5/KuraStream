package com.kurastream.app.feature.player

import android.app.Activity
import android.content.Context
import android.content.pm.ActivityInfo
import android.media.AudioManager
import android.os.Build
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.kurastream.app.R
import com.kurastream.app.core.designsystem.component.*
import com.kurastream.app.core.designsystem.theme.*
import com.kurastream.app.core.model.AudioTrack
import com.kurastream.app.core.model.SubtitleTrack
import com.kurastream.app.core.player.VideoFitMode

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

    // Immersive landscape edge-to-edge
    DisposableEffect(Unit) {
        val activity = context as? Activity
        val originalOrientation = activity?.requestedOrientation ?: ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE

        val window = activity?.window
        if (window != null) {
            val controller = WindowCompat.getInsetsController(window, view)
            controller.hide(WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        onDispose {
            activity?.requestedOrientation = originalOrientation
            val window = activity?.window
            if (window != null) {
                val controller = WindowCompat.getInsetsController(window, view)
                controller.show(WindowInsetsCompat.Type.systemBars())
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .pointerInput(state.controlsLocked) {
                detectTapGestures(
                    onTap = { viewModel.toggleControls() },
                    onDoubleTap = { offset ->
                        if (!state.controlsLocked) {
                            val halfWidth = size.width / 2
                            if (offset.x < halfWidth) {
                                viewModel.seekRelative(-10f)
                            } else {
                                viewModel.seekRelative(10f)
                            }
                        }
                    },
                    onLongPress = {
                        if (!state.controlsLocked) {
                            viewModel.setPlaybackSpeed(2.0f)
                        }
                    }
                )
            }
    ) {
        // LAYER 1: SurfaceView / PlayerView (without default controllers)
        val exoPlayer = viewModel.getExoPlayer()
        if (exoPlayer != null) {
            AndroidView(
                factory = { ctx ->
                    PlayerView(ctx).apply {
                        player = exoPlayer
                        useController = false
                        resizeMode = when (state.videoFitMode) {
                            VideoFitMode.FIT -> AspectRatioFrameLayout.RESIZE_MODE_FIT
                            VideoFitMode.ZOOM -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                            VideoFitMode.STRETCH -> AspectRatioFrameLayout.RESIZE_MODE_FILL
                        }
                        layoutParams = FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                    }
                },
                update = { pv ->
                    pv.player = exoPlayer
                    pv.resizeMode = when (state.videoFitMode) {
                        VideoFitMode.FIT -> AspectRatioFrameLayout.RESIZE_MODE_FIT
                        VideoFitMode.ZOOM -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                        VideoFitMode.STRETCH -> AspectRatioFrameLayout.RESIZE_MODE_FILL
                    }
                },
                modifier = Modifier.fillMaxSize()
            )
        }

        // LAYER 2: Vignette / Ambient Dark Overlay (only when controls are visible)
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
                            colors = listOf(
                                KuraColors.Background.copy(alpha = 0.85f),
                                Color.Transparent,
                                KuraColors.Background.copy(alpha = 0.9f)
                            )
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
                // TOP BAR CONTROLS
                Row(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .fillMaxWidth()
                        .statusBarsPadding()
                        .padding(horizontal = KuraDimens.Space5, vertical = KuraDimens.Space3),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = {
                        viewModel.saveCurrentProgress()
                        onNavigateBack()
                    }) {
                        Icon(
                            imageVector = Icons.Default.ArrowBack,
                            contentDescription = "Volver",
                            tint = KuraColors.TextMain
                        )
                    }

                    Spacer(modifier = Modifier.width(KuraDimens.Space2))

                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = state.show?.title ?: "",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = KuraColors.TextMain,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        val ep = state.episode
                        if (ep != null) {
                            Text(
                                text = "T${ep.seasonNumber} E${ep.episodeNumber} • ${ep.title.ifBlank { "Episodio ${ep.episodeNumber}" }}",
                                style = MaterialTheme.typography.labelSmall,
                                color = KuraColors.TextSecondary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }

                    // Top Action Buttons
                    IconButton(onClick = viewModel::toggleLock) {
                        Icon(
                            imageVector = Icons.Default.LockOpen,
                            contentDescription = "Bloquear controles",
                            tint = KuraColors.TextMain
                        )
                    }

                    // PiP Button (minSdk 26+)
                    IconButton(onClick = {
                        val act = context as? Activity
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && act != null) {
                            act.enterPictureInPictureMode(
                                android.app.PictureInPictureParams.Builder().build()
                            )
                        }
                    }) {
                        Icon(
                            imageVector = Icons.Default.PictureInPicture,
                            contentDescription = "PiP",
                            tint = KuraColors.TextMain
                        )
                    }
                }

                // CENTER PLAYBACK CONTROLS
                Row(
                    modifier = Modifier
                        .align(Alignment.Center)
                        .fillMaxWidth(0.5f),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Rewind 10s
                    IconButton(
                        onClick = { viewModel.seekRelative(-10f) },
                        modifier = Modifier
                            .size(56.dp)
                            .background(KuraColors.SurfaceRaised.copy(alpha = 0.7f), CircleShape)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Replay10,
                            contentDescription = "Retroceder 10s",
                            tint = KuraColors.TextMain,
                            modifier = Modifier.size(28.dp)
                        )
                    }

                    // Play / Pause
                    IconButton(
                        onClick = viewModel::togglePlayPause,
                        modifier = Modifier
                            .size(72.dp)
                            .background(KuraColors.Primary, CircleShape)
                    ) {
                        Icon(
                            imageVector = if (state.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = if (state.isPlaying) "Pausar" else "Reproducir",
                            tint = KuraColors.Background,
                            modifier = Modifier.size(36.dp)
                        )
                    }

                    // Forward 10s
                    IconButton(
                        onClick = { viewModel.seekRelative(10f) },
                        modifier = Modifier
                            .size(56.dp)
                            .background(KuraColors.SurfaceRaised.copy(alpha = 0.7f), CircleShape)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Forward10,
                            contentDescription = "Adelantar 10s",
                            tint = KuraColors.TextMain,
                            modifier = Modifier.size(28.dp)
                        )
                    }
                }

                // BOTTOM CONTROLS & TIMELINE
                Column(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(horizontal = KuraDimens.Space5, vertical = KuraDimens.Space3)
                ) {
                    // Skip Intro / Outro floating action button
                    if (state.isInIntro) {
                        KuraButton(
                            onClick = viewModel::skipIntro,
                            text = stringResource(R.string.skip_intro),
                            modifier = Modifier.align(Alignment.End),
                            leadingIcon = {
                                Icon(imageVector = Icons.Default.SkipNext, contentDescription = null)
                            }
                        )
                        Spacer(modifier = Modifier.height(KuraDimens.Space2))
                    } else if (state.isInOutro && state.nextEpisode != null) {
                        KuraButton(
                            onClick = { onNavigateToNextEpisode(state.nextEpisode!!.id) },
                            text = stringResource(R.string.next_episode),
                            modifier = Modifier.align(Alignment.End),
                            leadingIcon = {
                                Icon(imageVector = Icons.Default.SkipNext, contentDescription = null)
                            }
                        )
                        Spacer(modifier = Modifier.height(KuraDimens.Space2))
                    }

                    // Timeline Slider
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = formatTime(state.absolutePositionSeconds),
                            style = MaterialTheme.typography.labelSmall,
                            color = KuraColors.TextMain
                        )

                        Slider(
                            value = state.absolutePositionSeconds.coerceIn(0f, state.durationSeconds.coerceAtLeast(1f)),
                            onValueChange = { targetPos ->
                                viewModel.seekToAbsolute(targetPos)
                            },
                            valueRange = 0f..state.durationSeconds.coerceAtLeast(1f),
                            modifier = Modifier
                                .weight(1f)
                                .padding(horizontal = KuraDimens.Space3),
                            colors = SliderDefaults.colors(
                                thumbColor = KuraColors.Primary,
                                activeTrackColor = KuraColors.Primary,
                                inactiveTrackColor = KuraColors.Border
                            )
                        )

                        Text(
                            text = formatTime(state.durationSeconds),
                            style = MaterialTheme.typography.labelSmall,
                            color = KuraColors.TextSecondary
                        )
                    }

                    // Secondary Action Controls Row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(KuraDimens.Space2)) {
                            // Audio & Subtitles
                            TextButton(
                                onClick = { showTracksSheet = true },
                                colors = ButtonDefaults.textButtonColors(contentColor = KuraColors.TextMain)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Subtitles,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(modifier = Modifier.width(KuraDimens.Space1))
                                Text("Audio y Subs", style = MaterialTheme.typography.labelSmall)
                            }

                            // Playback Speed
                            TextButton(
                                onClick = { showSpeedSheet = true },
                                colors = ButtonDefaults.textButtonColors(contentColor = KuraColors.TextMain)
                            ) {
                                Text("${state.playbackSpeed}x", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                            }

                            // Aspect Ratio Fit
                            TextButton(
                                onClick = viewModel::toggleFitMode,
                                colors = ButtonDefaults.textButtonColors(contentColor = KuraColors.TextMain)
                            ) {
                                Text(state.videoFitMode.name, style = MaterialTheme.typography.labelSmall)
                            }
                        }

                        if (state.nextEpisode != null) {
                            TextButton(
                                onClick = { onNavigateToNextEpisode(state.nextEpisode!!.id) },
                                colors = ButtonDefaults.textButtonColors(contentColor = KuraColors.TextMain)
                            ) {
                                Text(stringResource(R.string.next_episode), style = MaterialTheme.typography.labelSmall)
                                Spacer(modifier = Modifier.width(KuraDimens.Space1))
                                Icon(
                                    imageVector = Icons.Default.SkipNext,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }
                    }
                }
            }
        }

        // Lock HUD: Only appears if locked and user taps
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
                        .background(KuraColors.Background.copy(alpha = 0.8f), CircleShape)
                        .border(1.dp, KuraColors.Border, CircleShape)
                ) {
                    Icon(
                        imageVector = Icons.Default.Lock,
                        contentDescription = "Desbloquear",
                        tint = KuraColors.Primary
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
                border = androidx.compose.foundation.BorderStroke(1.dp, KuraColors.Danger)
            ) {
                Column(
                    modifier = Modifier.padding(KuraDimens.Space5),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = state.errorMessage!!,
                        style = MaterialTheme.typography.bodyMedium,
                        color = KuraColors.TextMain
                    )
                    Spacer(modifier = Modifier.height(KuraDimens.Space3))
                    KuraButton(
                        onClick = { viewModel.seekRelative(0f) },
                        text = stringResource(R.string.retry)
                    )
                }
            }
        }

        // Next Episode Countdown Overlay Card
        if (state.nextEpisodeCountdown != null && state.nextEpisode != null) {
            Surface(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(KuraDimens.Space5)
                    .width(280.dp),
                shape = KuraShapes.Modal,
                color = KuraColors.SurfaceRaised,
                border = androidx.compose.foundation.BorderStroke(1.dp, KuraColors.BorderStrong),
                tonalElevation = 8.dp
            ) {
                Column(modifier = Modifier.padding(KuraDimens.Space4)) {
                    Text(
                        text = stringResource(R.string.next_episode),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = KuraColors.TextMain
                    )
                    Spacer(modifier = Modifier.height(KuraDimens.Space1))
                    Text(
                        text = "Episodio ${state.nextEpisode!!.episodeNumber}: ${state.nextEpisode!!.title}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = KuraColors.TextSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Spacer(modifier = Modifier.height(KuraDimens.Space2))
                    Text(
                        text = "Reproduciendo en ${state.nextEpisodeCountdown} s…",
                        style = MaterialTheme.typography.labelSmall,
                        color = KuraColors.Primary
                    )
                    Spacer(modifier = Modifier.height(KuraDimens.Space3))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End
                    ) {
                        TextButton(onClick = viewModel::cancelNextEpisodeCountdown) {
                            Text(stringResource(R.string.cancel), color = KuraColors.TextMuted)
                        }
                        Spacer(modifier = Modifier.width(KuraDimens.Space2))
                        KuraButton(
                            onClick = { onNavigateToNextEpisode(state.nextEpisode!!.id) },
                            text = "Ver ahora"
                        )
                    }
                }
            }
        }

        // Audio & Subtitles Bottom Sheet
        if (showTracksSheet) {
            ModalBottomSheet(
                onDismissRequest = { showTracksSheet = false },
                containerColor = KuraColors.Surface,
                dragHandle = { BottomSheetDefaults.DragHandle(color = KuraColors.Border) }
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
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
                    state.availableAudioTracks.forEachIndexed { index, track ->
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
                            Text(
                                text = "${track.title.ifBlank { "Pista ${index + 1}" }} (${track.language})",
                                style = MaterialTheme.typography.bodyMedium,
                                color = if (state.selectedAudioTrackIndex == index) KuraColors.Primary else KuraColors.TextMain
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

                    state.availableSubtitleTracks.forEachIndexed { index, sub ->
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
                            Text(
                                text = "${sub.title.ifBlank { "Subtítulo ${index + 1}" }} (${sub.language})",
                                style = MaterialTheme.typography.bodyMedium,
                                color = if (state.selectedSubtitleTrackIndex == index) KuraColors.Primary else KuraColors.TextMain
                            )
                            if (state.selectedSubtitleTrackIndex == index) {
                                Icon(imageVector = Icons.Default.Check, contentDescription = null, tint = KuraColors.Primary)
                            }
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
    }
}

private fun formatTime(seconds: Float): String {
    val totalSec = seconds.toInt().coerceAtLeast(0)
    val hrs = totalSec / 3600
    val mins = (totalSec % 3600) / 60
    val secs = totalSec % 60
    return if (hrs > 0) {
        String.format("%d:%02d:%02d", hrs, mins, secs)
    } else {
        String.format("%02d:%02d", mins, secs)
    }
}
