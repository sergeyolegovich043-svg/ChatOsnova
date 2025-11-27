package com.example.chatosnova.domain.call

import com.example.chatosnova.domain.auth.User

data class CallParticipant(
    val user: User,
    val isMuted: Boolean = false,
    val isVideoEnabled: Boolean = true
)

enum class CallStatus { IDLE, RINGING, ACTIVE, ENDED }

data class CallState(
    val callId: String? = null,
    val participants: List<CallParticipant> = emptyList(),
    val status: CallStatus = CallStatus.IDLE
)
