package com.example.chatosnova.presentation.components

import androidx.compose.foundation.background
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.example.chatosnova.domain.chat.Message
import com.example.chatosnova.domain.chat.MessageType
import com.example.chatosnova.presentation.theme.BubbleMe
import com.example.chatosnova.presentation.theme.BubbleOther
import java.time.format.DateTimeFormatter

@Composable
fun ChatBubble(message: Message, isMine: Boolean, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(18.dp)
    val color = if (isMine) BubbleMe else BubbleOther
    val alignment = if (isMine) Alignment.End else Alignment.Start
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
                    MessageType.TEXT -> Text(text = message.text.orEmpty(), style = MaterialTheme.typography.bodyLarge)
                    MessageType.VOICE -> VoiceMessageRow(duration = message.durationSeconds ?: 0)
                    MessageType.SYSTEM -> Text(text = message.text.orEmpty(), style = MaterialTheme.typography.labelMedium)
                }
                Text(
                    text = DateTimeFormatter.ISO_LOCAL_TIME.format(message.createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.align(Alignment.End)
                )
            }
        }
    }
}

@Composable
private fun VoiceMessageRow(duration: Int) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(imageVector = Icons.Default.PlayArrow, contentDescription = "Play")
        Text(text = "${duration}s", textAlign = TextAlign.Center)
    }
}
