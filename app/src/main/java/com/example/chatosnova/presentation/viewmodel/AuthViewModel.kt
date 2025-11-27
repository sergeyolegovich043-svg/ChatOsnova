package com.example.chatosnova.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.example.chatosnova.domain.auth.AuthRepository
import com.example.chatosnova.domain.auth.User
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class AuthViewModel(private val repository: AuthRepository) : ViewModel() {

    private val _currentUser = MutableStateFlow<User?>(null)
    val currentUser: StateFlow<User?> = _currentUser
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    fun login(usernameOrEmail: String, password: String, onSuccess: (User) -> Unit) {
        viewModelScope.launch {
            repository.login(usernameOrEmail, password)
                .onSuccess {
                    _currentUser.value = it
                    onSuccess(it)
                }
                .onFailure { _error.value = it.message }
        }
    }

    fun register(username: String, email: String, password: String, onSuccess: (User) -> Unit) {
        viewModelScope.launch {
            repository.register(username, email, password)
                .onSuccess {
                    _currentUser.value = it
                    onSuccess(it)
                }
                .onFailure { _error.value = it.message }
        }
    }

    companion object {
        fun factory(repository: AuthRepository) = object : ViewModelProvider.Factory {
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                @Suppress("UNCHECKED_CAST")
                return AuthViewModel(repository) as T
            }
        }
    }
}
