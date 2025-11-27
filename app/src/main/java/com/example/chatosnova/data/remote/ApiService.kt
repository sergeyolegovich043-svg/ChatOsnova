package com.example.chatosnova.data.remote

import com.example.chatosnova.domain.auth.User
import com.example.chatosnova.domain.chat.Message
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * REST endpoints definitions. Implement with Retrofit and real backend as needed.
 * All endpoints must be HTTPS in production; this interface assumes TLS termination by server.
 */
interface ApiService {
    @POST("auth/register")
    suspend fun register(@Body payload: RegisterRequest): User

    @POST("auth/login")
    suspend fun login(@Body payload: LoginRequest): TokenResponse

    @GET("chats")
    suspend fun getChats(): List<RemoteChat>

    @GET("chats/{id}/messages")
    suspend fun getMessages(@Path("id") chatId: String): List<Message>
}

data class RegisterRequest(val username: String, val email: String, val password: String)
data class LoginRequest(val username: String, val password: String)
data class TokenResponse(val token: String, val user: User)

data class RemoteChat(
    val id: String,
    val title: String,
    val participantIds: List<String>
)
