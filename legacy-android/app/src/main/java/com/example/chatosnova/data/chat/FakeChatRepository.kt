package com.example.chatosnova.data.chat

import com.example.chatosnova.domain.auth.User
import com.example.chatosnova.domain.chat.Chat
import com.example.chatosnova.domain.chat.ChatRepository
import com.example.chatosnova.domain.chat.Message
import com.example.chatosnova.domain.chat.MessageStatus
import com.example.chatosnova.domain.chat.MessageType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File
import java.time.Instant
import java.util.UUID

class FakeChatRepository(
    private val secureMessageService: SecureMessageService,
    private val externalScope: CoroutineScope = CoroutineScope(Dispatchers.IO)
) : ChatRepository {

    private val _chats = MutableStateFlow<List<Chat>>(emptyList())
    private val messages: MutableMap<String, MutableStateFlow<List<Message>>> = mutableMapOf()
    private val incomingMessages = MutableSharedFlow<Message>(extraBufferCapacity = 10)
    private val participants = mutableMapOf<String, List<User>>()
    private var currentUser: User? = null

    init {
        val demoUser = User(id = "me", username = "me")
        val bot = User(id = "bot", username = "HelperBot")
        val initialChat = Chat(id = "chat-1", title = "Welcome", participants = listOf(demoUser, bot))
        _chats.value = listOf(initialChat)
        messages[initialChat.id] = MutableStateFlow(
            listOf(
                Message(
                    id = UUID.randomUUID().toString(),
                    chatId = initialChat.id,
                    sender = bot,
                    text = "Hello! This is a secure-ready messenger skeleton.",
                    createdAt = Instant.now(),
                    messageType = MessageType.TEXT,
                    status = MessageStatus.DELIVERED
                )
            )
        )
        participants[initialChat.id] = listOf(demoUser, bot)
        currentUser = demoUser
    }

    override fun getChats(): Flow<List<Chat>> = _chats.asStateFlow()

    override fun getMessages(chatId: String): Flow<List<Message>> =
        messages.getOrPut(chatId) { MutableStateFlow(emptyList()) }.asStateFlow()

    override fun observeIncomingMessages(): Flow<Message> = incomingMessages.asSharedFlow()

    override suspend fun sendMessage(chatId: String, text: String): Result<Unit> {
        val sender = participants[chatId]?.firstOrNull() ?: currentUser ?: User("me", "me")
        val rawMessage = Message(
            id = UUID.randomUUID().toString(),
            chatId = chatId,
            sender = sender,
            text = text,
            createdAt = Instant.now(),
            messageType = MessageType.TEXT,
            status = MessageStatus.SENT
        )
        val encrypted = secureMessageService.encryptOutgoing(rawMessage)
        addMessage(chatId, encrypted)
        return Result.success(Unit)
    }

    override suspend fun sendVoiceMessage(chatId: String, audioFile: File, durationSeconds: Int): Result<Unit> {
        val sender = participants[chatId]?.firstOrNull() ?: currentUser ?: User("me", "me")
        val voiceMessage = Message(
            id = UUID.randomUUID().toString(),
            chatId = chatId,
            sender = sender,
            text = null,
            createdAt = Instant.now(),
            messageType = MessageType.VOICE,
            status = MessageStatus.SENT,
            mediaPath = audioFile.absolutePath,
            durationSeconds = durationSeconds
        )
        val encrypted = secureMessageService.encryptOutgoing(voiceMessage)
        addMessage(chatId, encrypted)
        return Result.success(Unit)
    }

    override suspend fun getParticipants(chatId: String): Result<List<User>> =
        Result.success(participants[chatId] ?: emptyList())

    override suspend fun getChatPartnersForCurrentUser(currentUserId: String?): List<User> {
        val currentIds = buildSet {
            currentUserId?.let { add(it) }
            currentUser?.id?.let { add(it) }
        }
        val partnerIds = participants.values.flatten()
            .filterNot { it.id in currentIds }
        return partnerIds.distinctBy { it.id }
    }

    override suspend fun startChatWithUser(user: User, currentUser: User?): Chat {
        this.currentUser = currentUser ?: this.currentUser
        val existing = _chats.value.firstOrNull { chat ->
            participants[chat.id]?.any { it.id == user.id } == true
        }
        if (existing != null) return existing

        val creator = currentUser ?: User(id = "me", username = "me")
        val chat = Chat(
            id = "chat-${user.id}",
            title = user.nickname,
            participants = listOf(creator, user)
        )
        participants[chat.id] = chat.participants
        _chats.value = _chats.value + chat
        messages[chat.id] = MutableStateFlow(emptyList())
        return chat
    }

    private fun addMessage(chatId: String, message: Message) {
        val flow = messages.getOrPut(chatId) { MutableStateFlow(emptyList()) }
        flow.value = flow.value + message
        externalScope.launch { incomingMessages.emit(secureMessageService.decryptIncoming(message)) }
    }
}
