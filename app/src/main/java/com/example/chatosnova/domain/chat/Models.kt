package com.example.chatosnova.domain.chat

import com.example.chatosnova.domain.auth.User
import java.time.Instant

enum class MessageType { TEXT, VOICE, SYSTEM }

enum class MessageStatus { SENT, DELIVERED, READ }

data class Chat(
    val id: String,
    val title: String,
    val participants: List<User>
)

data class Message(
    val id: String,
    val chatId: String,
    val sender: User,
    val text: String?,
    val createdAt: Instant,
    val messageType: MessageType,
    val status: MessageStatus,
    val mediaPath: String? = null,
    val durationSeconds: Int? = null
)
