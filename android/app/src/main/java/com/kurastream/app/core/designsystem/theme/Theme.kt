package com.kurastream.app.core.designsystem.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

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
    val colorScheme = DarkColorScheme
    val view = LocalView.current

    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window
            if (window != null) {
                window.statusBarColor = KuraColors.Background.toArgb()
                window.navigationBarColor = KuraColors.Background.toArgb()
                val controller = WindowCompat.getInsetsController(window, view)
                controller.isAppearanceLightStatusBars = false
                controller.isAppearanceLightNavigationBars = false
            }
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = KuraTypography,
        shapes = MaterialShapes,
        content = content
    )
}
