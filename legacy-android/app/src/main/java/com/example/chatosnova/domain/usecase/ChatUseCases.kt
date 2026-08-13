package com.example.chatosnova.domain.usecase

import com.example.chatosnova.domain.chat.ChatRepository

class SendMessageUseCase(private val repository: ChatRepository) {
    suspend operator fun invoke(chatId: String, text: String) = repository.sendMessage(chatId, text)
}

class SendVoiceMessageUseCase(private val repository: ChatRepository) {
    suspend operator fun invoke(chatId: String, audioPath: java.io.File, durationSeconds: Int) =
        repository.sendVoiceMessage(chatId, audioPath, durationSeconds)
}
