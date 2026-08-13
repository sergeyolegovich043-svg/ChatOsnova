package com.example.chatosnova.domain.auth

interface AuthRepository {
    suspend fun register(username: String, email: String, password: String): Result<User>
    suspend fun login(usernameOrEmail: String, password: String): Result<User>
    suspend fun logout()
    suspend fun getCurrentUser(): User?
}
