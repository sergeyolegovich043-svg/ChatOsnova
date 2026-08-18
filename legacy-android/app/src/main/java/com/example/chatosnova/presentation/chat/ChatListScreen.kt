package com.example.chatosnova.presentation.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.example.chatosnova.R
import com.example.chatosnova.domain.auth.User
import com.example.chatosnova.presentation.navigation.Screen
import com.example.chatosnova.presentation.viewmodel.ChatListViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen(navController: NavController, viewModel: ChatListViewModel) {
    val searchQuery = viewModel.searchQuery
    val chatPartners = viewModel.chatPartners
    val searchResults = viewModel.searchResults

    val list = if (searchQuery.isBlank()) chatPartners else searchResults

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.title_chats)) },
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
                .padding(16.dp)
        ) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = viewModel::onSearchQueryChange,
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.label_search_nickname)) }
            )

            Spacer(modifier = Modifier.height(12.dp))

            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(list) { user ->
                    UserRow(
                        user = user,
                        onOpenProfile = { navController.navigate(Screen.UserProfile.create(user.id)) },
                        onOpenChat = {
                            viewModel.startChatWithUser(user) { chatId ->
                                navController.navigate(Screen.Chat.create(chatId))
                            }
                        }
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                }
            }
        }
    }
}

@Composable
private fun UserRow(user: User, onOpenProfile: () -> Unit, onOpenChat: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onOpenChat() },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(user.nickname, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
            user.fullName?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
            }
            Spacer(modifier = Modifier.height(8.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                Button(onClick = onOpenChat, shape = RoundedCornerShape(12.dp)) { Text(stringResource(R.string.btn_open_chat)) }
                Spacer(modifier = Modifier.weight(1f))
                Button(onClick = onOpenProfile, shape = RoundedCornerShape(12.dp)) { Text(stringResource(R.string.btn_profile)) }
            }
        }
    }
}
