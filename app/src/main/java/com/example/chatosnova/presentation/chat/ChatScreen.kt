package com.example.chatosnova.presentation.chat

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.VideoCall
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.chatosnova.presentation.components.ChatBubble
import com.example.chatosnova.presentation.viewmodel.ChatViewModel
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(chatId: String, onStartCall: (String) -> Unit, viewModel: ChatViewModel) {
    viewModel.openChat(chatId)
    val messages by viewModel.messages.collectAsState()
    var input by remember { mutableStateOf("") }
    var recording by remember { mutableStateOf(false) }
    var recordedPath by remember { mutableStateOf<File?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Chat $chatId") }, actions = {
                IconButton(onClick = { onStartCall(chatId) }) {
                    Icon(Icons.Default.VideoCall, contentDescription = "Video call")
                }
            })
        },
        bottomBar = {
            Row(modifier = Modifier.fillMaxWidth().padding(8.dp)) {
                TextField(
                    value = input,
                    onValueChange = { input = it },
                    modifier = Modifier.weight(1f),
                    label = { Text("Message") }
                )
                IconButton(onClick = {
                    viewModel.sendMessage(chatId, input)
                    input = ""
                }) { Icon(Icons.Default.Send, contentDescription = "Send") }
                IconButton(onClick = {
                    recording = !recording
                    if (!recording) {
                        recordedPath?.let { viewModel.sendVoice(chatId, it, 3) }
                    } else {
                        // TODO: plug MediaRecorder; using temp file placeholder.
                        recordedPath = File.createTempFile("voice", ".aac")
                    }
                }) { Icon(Icons.Default.Mic, contentDescription = "Record") }
            }
        }
    ) { padding ->
        LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
            items(messages) { message ->
                val isMine = message.sender.id == viewModel.currentUser.value?.id || message.sender.id == "me"
                ChatBubble(message = message, isMine = isMine)
            }
            item { Spacer(modifier = Modifier.height(24.dp)) }
        }
    }
}
