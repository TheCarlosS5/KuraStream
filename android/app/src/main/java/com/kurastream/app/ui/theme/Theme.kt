package com.kurastream.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val DarkColorScheme = darkColorScheme(
    primary = AccentColor,
    background = BgDark,
    surface = CardDark,
    onPrimary = TextMain,
    onBackground = TextMain,
    onSurface = TextMain
)

@Composable
fun KuraStreamTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        content = content
    )
}
