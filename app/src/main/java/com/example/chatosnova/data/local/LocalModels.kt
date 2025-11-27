package com.example.chatosnova.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.time.Instant

@Entity(tableName = "messages")
data class MessageEntity(
    @PrimaryKey val id: String,
    val chatId: String,
    val senderId: String,
    val text: String?,
    val createdAt: Instant,
    val type: String,
    val status: String,
    val mediaPath: String?,
    val durationSeconds: Int?
)

// TODO: Add RoomDatabase and DAO with SQLCipher/EncryptedFile support before shipping production.
