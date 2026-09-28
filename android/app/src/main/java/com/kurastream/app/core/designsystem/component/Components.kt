package com.kurastream.app.core.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import coil.compose.AsyncImage
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
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .padding(KuraDimens.Space6),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodyLarge,
            color = KuraColors.TextMuted
        )
    }
}

@Composable
fun ShowPosterCard(
    show: Show,
    imageUrl: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .width(KuraDimens.PosterWidth)
            .clip(KuraShapes.Card)
            .clickable(onClick = onClick)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(KuraDimens.PosterHeight)
                .background(KuraColors.SurfaceRaised)
                .border(1.dp, KuraColors.Border, KuraShapes.Card)
                .clip(KuraShapes.Card)
        ) {
            AsyncImage(
                model = imageUrl,
                contentDescription = show.title,
                contentScale = ContentScale.Crop,
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

@Composable
fun ContinueWatchingCard(
    item: WatchHistoryItem,
    thumbnailUrl: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .width(220.dp)
            .clip(KuraShapes.Card)
            .clickable(onClick = onClick)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(124.dp)
                .background(KuraColors.SurfaceRaised)
                .border(1.dp, KuraColors.Border, KuraShapes.Card)
                .clip(KuraShapes.Card)
        ) {
            AsyncImage(
                model = thumbnailUrl,
                contentDescription = item.showTitle,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
            // Progress Bar Overlay at bottom of card
            Box(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .height(4.dp)
                    .background(KuraColors.SurfaceHover)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(fraction = (item.progressPercentage / 100f).coerceIn(0f, 1f))
                        .background(KuraColors.Primary)
                )
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
            text = "T${item.seasonNumber} E${item.episodeNumber} • ${item.progressPercentage}% completado",
            style = MaterialTheme.typography.labelSmall,
            color = KuraColors.TextSecondary
        )
    }
}
