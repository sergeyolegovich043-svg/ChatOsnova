package com.example.chatosnova.domain.chat

import com.example.chatosnova.domain.auth.User
import kotlinx.coroutines.flow.Flow
import java.io.File

interface ChatRepository {
    fun getChats(): Flow<List<Chat>>
    fun getMessages(chatId: String): Flow<List<Message>>
    fun observeIncomingMessages(): Flow<Message>
    suspend fun sendMessage(chatId: String, text: String): Result<Unit>
    suspend fun sendVoiceMessage(chatId: String, audioFile: File, durationSeconds: Int): Result<Unit>
    suspend fun getParticipants(chatId: String): Result<List<User>>
}
