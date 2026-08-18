package com.example.chatosnova.data.chat

import com.example.chatosnova.domain.chat.Message

/**
 * Encapsulates encryption/decryption and signature verification for messages.
 * TODO: Integrate a well-audited library such as Google Tink or the Signal protocol
 * for end-to-end encryption. This placeholder avoids implementing cryptographic
 * primitives manually and keeps a single abstraction for security-critical logic.
 */
interface SecureMessageService {
    suspend fun encryptOutgoing(message: Message): Message
    suspend fun decryptIncoming(message: Message): Message
}

class NoopSecureMessageService : SecureMessageService {
    override suspend fun encryptOutgoing(message: Message): Message = message
    override suspend fun decryptIncoming(message: Message): Message = message
}
