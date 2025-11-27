package com.example.chatosnova.presentation.viewmodel

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.example.chatosnova.domain.auth.User
import com.example.chatosnova.domain.user.UserRepository
import kotlinx.coroutines.launch

class UserProfileViewModel(
    private val userRepository: UserRepository,
    private val userId: String
) : ViewModel() {

    var user by mutableStateOf<User?>(null)
        private set

    init {
        loadUser()
    }

    private fun loadUser() {
        viewModelScope.launch {
            user = userRepository.getUserById(userId)
        }
    }

    companion object {
        fun factory(userRepository: UserRepository, userId: String) = object : ViewModelProvider.Factory {
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                @Suppress("UNCHECKED_CAST")
                return UserProfileViewModel(userRepository, userId) as T
            }
        }
    }
}
