package com.example.chatosnova.domain.user

import com.example.chatosnova.domain.auth.User

interface UserRepository {
    suspend fun getAllUsers(): List<User>
    suspend fun searchUsersByNickname(query: String): List<User>
    suspend fun getUserById(userId: String): User?
    suspend fun addOrUpdateUser(user: User)
}
