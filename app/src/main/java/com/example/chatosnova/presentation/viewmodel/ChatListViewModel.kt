package com.example.chatosnova.presentation.viewmodel

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.example.chatosnova.domain.auth.User
import com.example.chatosnova.domain.chat.ChatRepository
import com.example.chatosnova.domain.user.UserRepository
import kotlinx.coroutines.launch

class ChatListViewModel(
    private val userRepository: UserRepository,
    private val chatRepository: ChatRepository
) : ViewModel() {

    private var currentUser: User? = null

    var searchQuery by mutableStateOf("")
        private set

    var chatPartners by mutableStateOf<List<User>>(emptyList())
        private set

    var searchResults by mutableStateOf<List<User>>(emptyList())
        private set

    init {
        loadChatPartners()
    }

    fun setCurrentUser(user: User) {
        currentUser = user
        viewModelScope.launch { userRepository.addOrUpdateUser(user) }
        loadChatPartners()
        if (searchQuery.isNotBlank()) {
            performSearch()
        }
    }

    fun onSearchQueryChange(newQuery: String) {
        searchQuery = newQuery
        performSearch()
    }

    fun startChatWithUser(user: User, onChatReady: (String) -> Unit) {
        viewModelScope.launch {
            val chat = chatRepository.startChatWithUser(user, currentUser)
            userRepository.addOrUpdateUser(user)
            loadChatPartners()
            onChatReady(chat.id)
        }
    }

    private fun loadChatPartners() {
        viewModelScope.launch {
            val partners = chatRepository.getChatPartnersForCurrentUser(currentUser?.id)
            chatPartners = partners
            partners.forEach { userRepository.addOrUpdateUser(it) }
        }
    }

    private fun performSearch() {
        viewModelScope.launch {
            searchResults = if (searchQuery.isBlank()) {
                emptyList()
            } else {
                userRepository.searchUsersByNickname(searchQuery)
                    .filter { it.id != currentUser?.id }
            }
        }
    }

    companion object {
        fun factory(userRepository: UserRepository, chatRepository: ChatRepository) = object : ViewModelProvider.Factory {
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                @Suppress("UNCHECKED_CAST")
                return ChatListViewModel(userRepository, chatRepository) as T
            }
        }
    }
}
