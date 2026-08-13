package com.example.chatosnova.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.example.chatosnova.domain.auth.User
import com.example.chatosnova.domain.chat.ChatRepository
import com.example.chatosnova.domain.chat.Message
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.io.File

class ChatViewModel(private val repository: ChatRepository) : ViewModel() {

    private val _currentUser = MutableStateFlow<User?>(null)
    val currentUser: StateFlow<User?> = _currentUser
    val chats = repository.getChats().stateIn(viewModelScope, SharingStarted.Lazily, emptyList())

    private val _currentChatId = MutableStateFlow<String?>(null)
    val messages: StateFlow<List<Message>> = _currentChatId
        .flatMapLatest { chatId ->
            if (chatId == null) kotlinx.coroutines.flow.flowOf(emptyList()) else repository.getMessages(chatId)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun setCurrentUser(user: User) { _currentUser.value = user }

    fun openChat(chatId: String) { _currentChatId.value = chatId }

    fun sendMessage(chatId: String, text: String) {
        viewModelScope.launch { repository.sendMessage(chatId, text) }
    }

    fun sendVoice(chatId: String, audio: File, durationSeconds: Int) {
        viewModelScope.launch { repository.sendVoiceMessage(chatId, audio, durationSeconds) }
    }

    companion object {
        fun factory(repository: ChatRepository) = object : ViewModelProvider.Factory {
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                @Suppress("UNCHECKED_CAST")
                return ChatViewModel(repository) as T
            }
        }
    }
}
