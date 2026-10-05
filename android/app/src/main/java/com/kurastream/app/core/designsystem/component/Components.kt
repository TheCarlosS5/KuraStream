package com.kurastream.app.core.designsystem.component

import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.kurastream.app.core.designsystem.theme.*
import com.kurastream.app.core.model.Show
import com.kurastream.app.core.model.WatchHistoryItem

@Composable
fun KuraTopBar(
    title: String,
    modifier: Modifier = Modifier,
    navigationIcon: (@Composable () -> Unit)? = null,
    actions: (@Composable RowScope.() -> Unit)? = null
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = KuraColors.Background,
        tonalElevation = 0.dp
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .height(56.dp)
                .padding(horizontal = KuraDimens.Space4),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (navigationIcon != null) {
                navigationIcon()
                Spacer(modifier = Modifier.width(KuraDimens.Space3))
            }
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                color = KuraColors.TextMain,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
            if (actions != null) {
                actions()
            }
        }
    }
}

@Composable
fun KuraButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    leadingIcon: (@Composable () -> Unit)? = null,
    text: String
) {
    Button(
        onClick = onClick,
        modifier = modifier
            .defaultMinSize(minHeight = KuraDimens.MinTouchTarget),
        enabled = enabled,
        shape = KuraShapes.Control,
        colors = ButtonDefaults.buttonColors(
            containerColor = KuraColors.Primary,
            contentColor = KuraColors.Background,
            disabledContainerColor = KuraColors.SurfaceHover,
            disabledContentColor = KuraColors.TextDisabled
        )
    ) {
        if (leadingIcon != null) {
            leadingIcon()
            Spacer(modifier = Modifier.width(KuraDimens.Space2))
        }
        Text(
            text = text,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold
        )
    }
}

@Composable
fun KuraOutlinedButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    leadingIcon: (@Composable () -> Unit)? = null,
    text: String
) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier
            .defaultMinSize(minHeight = KuraDimens.MinTouchTarget),
        enabled = enabled,
        shape = KuraShapes.Control,
        border = androidx.compose.foundation.BorderStroke(1.dp, KuraColors.BorderStrong),
        colors = ButtonDefaults.outlinedButtonColors(
            contentColor = KuraColors.TextMain
        )
    ) {
        if (leadingIcon != null) {
            leadingIcon()
            Spacer(modifier = Modifier.width(KuraDimens.Space2))
        }
        Text(
            text = text,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Medium
        )
    }
}

@Composable
fun KuraBadge(
    text: String,
    modifier: Modifier = Modifier,
    isAccent: Boolean = false
) {
    Box(
        modifier = modifier
            .background(
                color = if (isAccent) KuraColors.PrimarySoft else KuraColors.SurfaceRaised,
                shape = KuraShapes.Small
            )
            .border(
                width = 1.dp,
                color = if (isAccent) KuraColors.Primary else KuraColors.Border,
                shape = KuraShapes.Small
            )
            .padding(horizontal = 6.dp, vertical = 2.dp)
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = if (isAccent) KuraColors.Primary else KuraColors.TextSecondary,
            fontWeight = FontWeight.Medium
        )
    }
}

@Composable
fun KuraRatingBadge(
    rating: Float,
    modifier: Modifier = Modifier
) {
    if (rating <= 0f) return
    Row(
        modifier = modifier
            .background(KuraColors.SurfaceRaised, KuraShapes.Small)
            .border(1.dp, KuraColors.Border, KuraShapes.Small)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = Icons.Default.Star,
            contentDescription = null,
            tint = KuraColors.Rating,
            modifier = Modifier.size(12.dp)
        )
        Spacer(modifier = Modifier.width(3.dp))
        Text(
            text = String.format(java.util.Locale.US, "%.1f", rating),
            style = MaterialTheme.typography.labelSmall,
            color = KuraColors.Rating,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
fun KuraLoadingView(
    modifier: Modifier = Modifier,
    message: String = "Cargando contenido…"
) {
    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            CircularProgressIndicator(
                color = KuraColors.Primary,
                strokeWidth = 3.dp,
                modifier = Modifier.size(36.dp)
            )
            Spacer(modifier = Modifier.height(KuraDimens.Space4))
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = KuraColors.TextSecondary
            )
        }
    }
}

@Composable
fun KuraErrorView(
    message: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .padding(KuraDimens.Space6),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = message,
                style = MaterialTheme.typography.bodyLarge,
                color = KuraColors.TextSecondary,
                modifier = Modifier.padding(bottom = KuraDimens.Space4)
            )
            KuraButton(
                onClick = onRetry,
                text = "Reintentar",
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                }
            )
        }
    }
}

@Composable
fun KuraEmptyView(
    message: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    actionText: String? = null,
    onAction: (() -> Unit)? = null
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .padding(KuraDimens.Space6),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            if (icon != null) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = KuraColors.TextMuted,
                    modifier = Modifier.size(48.dp)
                )
                Spacer(modifier = Modifier.height(KuraDimens.Space3))
            }
            Text(
                text = message,
                style = MaterialTheme.typography.bodyLarge,
                color = KuraColors.TextMuted,
                textAlign = TextAlign.Center
            )
            if (actionText != null && onAction != null) {
                Spacer(modifier = Modifier.height(KuraDimens.Space4))
                KuraOutlinedButton(onClick = onAction, text = actionText)
            }
        }
    }
}

@Composable
fun ShowPosterCard(
    show: Show,
    imageUrl: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    // Subtle press-in so taps feel physical
    val pressScale by animateFloatAsState(if (pressed) 0.96f else 1f, tween(120), label = "cardPress")
    Column(
        modifier = modifier
            .graphicsLayer { scaleX = pressScale; scaleY = pressScale }
            .width(KuraDimens.PosterWidth)
            .clip(KuraShapes.Card)
            .clickable(interactionSource = interactionSource, indication = LocalIndication.current, onClick = onClick)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(KuraDimens.PosterHeight)
                .background(KuraColors.SurfaceRaised)
                .border(1.dp, KuraColors.Border, KuraShapes.Card)
                .clip(KuraShapes.Card)
        ) {
            KuraAsyncImage(
                model = imageUrl,
                contentDescription = show.title,
                fallbackText = show.title,
                modifier = Modifier.fillMaxSize()
            )
            if (show.isAiring) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(KuraDimens.Space2)
                ) {
                    KuraBadge(text = "En Emisión", isAccent = true)
                }
            }
        }
        Spacer(modifier = Modifier.height(KuraDimens.Space2))
        Text(
            text = show.title,
            style = MaterialTheme.typography.titleMedium,
            color = KuraColors.TextMain,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = show.year?.toString() ?: "",
                style = MaterialTheme.typography.labelSmall,
                color = KuraColors.TextMuted
            )
            KuraRatingBadge(rating = show.rating)
        }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun ContinueWatchingCard(
    item: WatchHistoryItem,
    thumbnailUrl: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    onLongClick: (() -> Unit)? = null
) {
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    // Subtle press-in so taps feel physical
    val pressScale by animateFloatAsState(if (pressed) 0.96f else 1f, tween(120), label = "cardPress")
    Column(
        modifier = modifier
            .graphicsLayer { scaleX = pressScale; scaleY = pressScale }
            .width(220.dp)
            .clip(KuraShapes.Card)
            .combinedClickable(
                interactionSource = interactionSource,
                indication = LocalIndication.current,
                onLongClick = onLongClick,
                onClick = onClick
            )
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(124.dp)
                .background(KuraColors.SurfaceRaised)
                .border(1.dp, KuraColors.Border, KuraShapes.Card)
                .clip(KuraShapes.Card)
        ) {
            KuraAsyncImage(
                model = thumbnailUrl,
                contentDescription = item.showTitle,
                modifier = Modifier.fillMaxSize()
            )
            val notStarted = item.upNext && item.progressSeconds < 1f
            if (notStarted) {
                Text(
                    text = "NUEVO",
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(8.dp)
                        .background(KuraColors.Primary, KuraShapes.Pill)
                        .padding(horizontal = 8.dp, vertical = 2.dp)
                )
            } else {
                // Same inset bar as the episode list in the show detail
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 6.dp)
                        .height(3.dp)
                        .clip(KuraShapes.Pill)
                        .background(Color.White.copy(alpha = 0.3f))
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxHeight()
                            .fillMaxWidth(fraction = (item.progressPercentage / 100f).coerceIn(0f, 1f))
                            .background(KuraColors.Primary)
                    )
                }
            }
        }
        Spacer(modifier = Modifier.height(KuraDimens.Space2))
        Text(
            text = item.showTitle,
            style = MaterialTheme.typography.titleMedium,
            color = KuraColors.TextMain,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(
            text = (if (item.seasonNumber > 0) "T${item.seasonNumber}:E${item.episodeNumber}" else "Especial ${item.episodeNumber}") + " • " +
                when {
                    item.upNext && item.progressSeconds < 1f -> "Siguiente episodio"
                    item.duration > 0f -> "Quedan ${(item.remainingSeconds / 60).coerceAtLeast(1)} min"
                    else -> "${item.progressPercentage}% visto"
                },
            style = MaterialTheme.typography.labelSmall,
            color = KuraColors.TextSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/**
 * Artwork loader used across the app: cross-fades in, and when there is no URL or the request
 * fails shows a branded fallback (icon + optional title) instead of an empty box.
 */
@Composable
fun KuraAsyncImage(
    model: String?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
    fallbackText: String? = null
) {
    var failed by remember(model) { mutableStateOf(model.isNullOrBlank()) }
    Box(
        modifier = modifier.background(KuraColors.SurfaceRaised),
        contentAlignment = Alignment.Center
    ) {
        if (!failed) {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(model)
                    .crossfade(true)
                    .build(),
                contentDescription = contentDescription,
                contentScale = contentScale,
                onError = { failed = true },
                modifier = Modifier.fillMaxSize()
            )
        } else {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(KuraDimens.Space2)
            ) {
                Icon(
                    imageVector = Icons.Outlined.Movie,
                    contentDescription = null,
                    tint = KuraColors.TextMuted,
                    modifier = Modifier.size(28.dp)
                )
                if (!fallbackText.isNullOrBlank()) {
                    Spacer(modifier = Modifier.height(KuraDimens.Space1))
                    Text(
                        text = fallbackText,
                        style = MaterialTheme.typography.labelSmall,
                        color = KuraColors.TextMuted,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }
    }
}
