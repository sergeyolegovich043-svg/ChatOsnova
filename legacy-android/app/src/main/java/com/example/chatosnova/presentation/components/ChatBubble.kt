package com.example.chatosnova.presentation.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.example.chatosnova.domain.chat.Message
import com.example.chatosnova.domain.chat.MessageType
import java.time.format.DateTimeFormatter
import java.time.ZoneId

@Composable
fun ChatBubble(message: Message, isMine: Boolean, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(18.dp)
    val color = if (isMine) {
        MaterialTheme.colorScheme.primary.copy(alpha = 0.2f)
    } else {
        MaterialTheme.colorScheme.surface
    }
    val alignment = if (isMine) Alignment.End else Alignment.Start
    val timeText = remember(message.createdAt) {
        DateTimeFormatter.ofPattern("HH:mm").format(
            message.createdAt.atZone(ZoneId.systemDefault()).toLocalTime()
        )
    }
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalAlignment = alignment
    ) {
        Surface(
            color = color,
            tonalElevation = 1.dp,
            shape = shape,
            modifier = Modifier.clip(shape)
        ) {
            Column(Modifier.padding(12.dp)) {
                when (message.messageType) {
                    MessageType.TEXT -> Text(
                        text = message.text.orEmpty(),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    MessageType.VOICE -> VoiceMessageRow(duration = message.durationSeconds ?: 0)
                    MessageType.SYSTEM -> Text(
                        text = message.text.orEmpty(),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
                Text(
                    text = timeText,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.align(Alignment.End)
                )
            }
        }
    }
}

@Composable
private fun VoiceMessageRow(duration: Int) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(imageVector = Icons.Default.PlayArrow, contentDescription = "Воспроизвести")
        Text(text = "${duration}s", textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurface)
    }
}
