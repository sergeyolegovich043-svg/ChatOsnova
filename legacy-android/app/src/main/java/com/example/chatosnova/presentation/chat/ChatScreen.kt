@file:OptIn(ExperimentalMaterial3Api::class)

package com.example.chatosnova.presentation.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.VideoCall
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.example.chatosnova.presentation.components.ChatBubble
import com.example.chatosnova.presentation.viewmodel.ChatViewModel
import java.io.File
import com.example.chatosnova.R
@Composable
fun ChatScreen(navController: NavController, chatId: String, onStartCall: (String) -> Unit, viewModel: ChatViewModel) {
    if (chatId.isBlank()) {
        PlaceholderChat(navController)
        return
    }

    LaunchedEffect(chatId) {
        viewModel.openChat(chatId)
    }
    val messages by viewModel.messages.collectAsState()
    var input by remember { mutableStateOf("") }
    var recording by remember { mutableStateOf(false) }
    var recordedPath by remember { mutableStateOf<File?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.title_chat, chatId)) },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.btn_back)
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { onStartCall(chatId) }) {
                        Icon(Icons.Default.VideoCall, contentDescription = stringResource(R.string.btn_start_call))
                    }
                }
            )
        },
        bottomBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                TextField(
                    value = input,
                    onValueChange = { input = it },
                    modifier = Modifier.weight(1f),
                    label = { Text(stringResource(R.string.label_message)) }
                )
                Button(
                    onClick = {
                        if (input.isNotBlank()) {
                            viewModel.sendMessage(chatId, input)
                            input = ""
                        }
                    },
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(Icons.Default.Send, contentDescription = stringResource(R.string.btn_send))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(stringResource(R.string.btn_send))
                }
                IconButton(onClick = {
                    recording = !recording
                    if (!recording) {
                        recordedPath?.let { viewModel.sendVoice(chatId, it, 3) }
                    } else {
                        recordedPath = File.createTempFile("voice", ".aac")
                    }
                }) { Icon(Icons.Default.Mic, contentDescription = stringResource(R.string.btn_record)) }
            }
        }
    ) { padding ->
        if (messages.isEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(24.dp),
                verticalArrangement = Arrangement.Center
            ) {
                Text(
                    text = stringResource(R.string.hint_chat_placeholder),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onBackground
                )
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxSize().padding(padding)) {
                items(messages) { message ->
                    val isMine = message.sender.id == viewModel.currentUser.value?.id || message.sender.id == "me"
                    ChatBubble(message = message, isMine = isMine)
                }
                item { Spacer(modifier = Modifier.height(24.dp)) }
            }
        }
    }
}

@Composable
private fun PlaceholderChat(navController: NavController) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.title_chat, "")) },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.btn_back)
                        )
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                text = stringResource(R.string.hint_chat_placeholder),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onBackground
            )
        }
    }
}
