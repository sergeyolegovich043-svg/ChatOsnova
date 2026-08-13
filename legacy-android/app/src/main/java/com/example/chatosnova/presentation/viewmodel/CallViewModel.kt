package com.example.chatosnova.presentation.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.example.chatosnova.domain.call.CallRepository
import com.example.chatosnova.domain.call.CallState
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class CallViewModel(private val repository: CallRepository) : ViewModel() {
    val callState: StateFlow<CallState> = repository.callState.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        CallState()
    )

    fun startCall(chatId: String, onCallStarted: (String) -> Unit) {
        viewModelScope.launch {
            repository.startCall(chatId).onSuccess { onCallStarted(it) }
        }
    }

    fun joinCall(callId: String) {
        viewModelScope.launch { repository.joinCall(callId) }
    }

    fun endCall(callId: String) {
        viewModelScope.launch { repository.endCall(callId) }
    }

    companion object {
        fun factory(repository: CallRepository) = object : ViewModelProvider.Factory {
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                @Suppress("UNCHECKED_CAST")
                return CallViewModel(repository) as T
            }
        }
    }
}
