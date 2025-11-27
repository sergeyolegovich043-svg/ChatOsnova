package com.example.chatosnova.presentation.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    surface = Background,
    background = Background,
    primary = Color(0xFF10A37F),
    secondary = Color(0xFF4C5AE3)
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF10A37F),
    secondary = Color(0xFF4C5AE3)
)

@Composable
fun ChatOsnovaTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) DarkColors else LightColors
    MaterialTheme(
        colorScheme = colors,
        typography = Typography,
        content = content
    )
}
