package com.example.chatosnova.presentation.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.example.chatosnova.presentation.theme.ChatGptBackground
import com.example.chatosnova.presentation.theme.ChatGptGreen
import com.example.chatosnova.presentation.theme.ChatGptOnBackground
import com.example.chatosnova.presentation.theme.ChatGptOnSurface
import com.example.chatosnova.presentation.theme.ChatGptSurface

private val DarkColorScheme = darkColorScheme(
    primary = ChatGptGreen,
    onPrimary = Color.White,
    background = ChatGptBackground,
    onBackground = ChatGptOnBackground,
    surface = ChatGptSurface,
    onSurface = ChatGptOnSurface,
    secondary = ChatGptGreen,
    onSecondary = Color.White
)

@Composable
fun ChatOsnovaTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        typography = Typography,
        shapes = Shapes(),
        content = content
    )
}
