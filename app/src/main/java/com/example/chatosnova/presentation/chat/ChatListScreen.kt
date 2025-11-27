package com.example.chatosnova.presentation.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.chatosnova.presentation.viewmodel.ChatViewModel

@Composable
fun ChatListScreen(onChatSelected: (String) -> Unit, viewModel: ChatViewModel) {
    val chats by viewModel.chats.collectAsState()
    Surface(modifier = Modifier.fillMaxSize()) {
        Column { chats.forEach { chat ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { viewModel.openChat(chat.id); onChatSelected(chat.id) }
                    .padding(16.dp)
            ) {
                Text(chat.title, style = MaterialTheme.typography.titleMedium)
                Text("Participants: ${chat.participants.size}", style = MaterialTheme.typography.bodySmall)
            }
        } }
    }
}
