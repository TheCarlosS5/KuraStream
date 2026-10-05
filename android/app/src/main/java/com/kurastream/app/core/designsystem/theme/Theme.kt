package com.kurastream.app.core.designsystem.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val DarkColorScheme = darkColorScheme(
    primary = KuraColors.Primary,
    onPrimary = KuraColors.Background,
    primaryContainer = KuraColors.SurfaceRaised,
    onPrimaryContainer = KuraColors.Primary,
    secondary = KuraColors.Secondary,
    onSecondary = KuraColors.Background,
    background = KuraColors.Background,
    onBackground = KuraColors.TextMain,
    surface = KuraColors.Surface,
    onSurface = KuraColors.TextMain,
    surfaceVariant = KuraColors.SurfaceRaised,
    onSurfaceVariant = KuraColors.TextSecondary,
    error = KuraColors.Danger,
    onError = KuraColors.TextMain
)

@Composable
fun KuraTheme(
    content: @Composable () -> Unit
) {
    // System bars are configured once in MainActivity (transparent, light icons). Painting them
    // opaque here would cover edge-to-edge content such as the show-detail backdrop.
    val colorScheme = DarkColorScheme

    MaterialTheme(
        colorScheme = colorScheme,
        typography = KuraTypography,
        shapes = MaterialShapes,
        content = content
    )
}
