package com.example.chatosnova.presentation.call

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.chatosnova.presentation.viewmodel.CallViewModel

@Composable
fun CallScreen(callId: String, viewModel: CallViewModel, onEnd: () -> Unit) {
    val state by viewModel.callState.collectAsState()
    Column(
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.fillMaxSize().padding(16.dp)
    ) {
        Text("Call ID: $callId")
        Text("Status: ${state.status}")
        Text("Participants: ${state.participants.size}")
        Row(modifier = Modifier.padding(top = 16.dp)) {
            IconButton(onClick = { /* TODO toggle camera */ }) {
                Icon(Icons.Default.VideocamOff, contentDescription = "Toggle video")
            }
            IconButton(onClick = { /* TODO toggle mute */ }) {
                Icon(Icons.Default.MicOff, contentDescription = "Mute")
            }
            IconButton(onClick = { viewModel.endCall(callId); onEnd() }) {
                Icon(Icons.Default.CallEnd, contentDescription = "End call")
            }
        }
        Button(onClick = { viewModel.joinCall(callId) }, modifier = Modifier.padding(top = 8.dp)) {
            Text("Join call")
        }
    }
}
