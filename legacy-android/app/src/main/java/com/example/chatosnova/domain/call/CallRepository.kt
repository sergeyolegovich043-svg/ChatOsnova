package com.example.chatosnova.domain.call

import kotlinx.coroutines.flow.Flow

interface CallRepository {
    suspend fun startCall(chatId: String): Result<String>
    suspend fun joinCall(callId: String): Result<Unit>
    suspend fun endCall(callId: String): Result<Unit>
    val callState: Flow<CallState>
}
