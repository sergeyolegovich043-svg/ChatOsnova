package com.example.chatosnova.data.call

import com.example.chatosnova.domain.call.CallParticipant
import com.example.chatosnova.domain.call.CallRepository
import com.example.chatosnova.domain.call.CallState
import com.example.chatosnova.domain.call.CallStatus
import com.example.chatosnova.domain.auth.User
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.UUID

class FakeCallRepository : CallRepository {
    private val state = MutableStateFlow(CallState())
    override val callState: StateFlow<CallState> = state

    override suspend fun startCall(chatId: String): Result<String> {
        val callId = UUID.randomUUID().toString()
        state.value = CallState(callId, status = CallStatus.RINGING)
        return Result.success(callId)
    }

    override suspend fun joinCall(callId: String): Result<Unit> {
        val participants = state.value.participants + CallParticipant(User("me", "me"))
        state.value = state.value.copy(callId = callId, participants = participants, status = CallStatus.ACTIVE)
        return Result.success(Unit)
    }

    override suspend fun endCall(callId: String): Result<Unit> {
        state.value = CallState(callId = callId, status = CallStatus.ENDED)
        return Result.success(Unit)
    }
}
