package com.example.chatosnova.presentation.call

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.example.chatosnova.R
import com.example.chatosnova.presentation.viewmodel.CallViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CallScreen(callId: String, viewModel: CallViewModel, onEnd: () -> Unit, onBack: () -> Unit) {
    val state by viewModel.callState.collectAsState()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.title_call)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
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
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
        ) {
            Text(stringResource(R.string.text_call_id, callId), color = MaterialTheme.colorScheme.onBackground)
            Text(stringResource(R.string.text_status, state.status), color = MaterialTheme.colorScheme.onBackground)
            Text(stringResource(R.string.text_participants, state.participants.size), color = MaterialTheme.colorScheme.onBackground)
            Row(modifier = Modifier.padding(top = 16.dp)) {
                IconButton(onClick = { /* TODO toggle camera */ }) {
                    Icon(Icons.Default.VideocamOff, contentDescription = stringResource(R.string.btn_toggle_video))
                }
                IconButton(onClick = { /* TODO toggle mute */ }) {
                    Icon(Icons.Default.MicOff, contentDescription = stringResource(R.string.btn_toggle_mic))
                }
                IconButton(onClick = { viewModel.endCall(callId); onEnd() }) {
                    Icon(Icons.Default.CallEnd, contentDescription = stringResource(R.string.btn_end_call))
                }
            }
            Button(
                onClick = { viewModel.joinCall(callId) },
                modifier = Modifier.padding(top = 8.dp),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text(stringResource(R.string.btn_join_call))
            }
        }
    }
}
