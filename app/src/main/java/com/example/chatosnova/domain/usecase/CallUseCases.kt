package com.example.chatosnova.domain.usecase

import com.example.chatosnova.domain.call.CallRepository

class StartCallUseCase(private val repository: CallRepository) {
    suspend operator fun invoke(chatId: String) = repository.startCall(chatId)
}

class JoinCallUseCase(private val repository: CallRepository) {
    suspend operator fun invoke(callId: String) = repository.joinCall(callId)
}

class EndCallUseCase(private val repository: CallRepository) {
    suspend operator fun invoke(callId: String) = repository.endCall(callId)
}
