package com.example.chatosnova.data.user

import com.example.chatosnova.domain.auth.User
import com.example.chatosnova.domain.user.UserRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class InMemoryUserRepository : UserRepository {

    private val users = mutableListOf(
        User(id = "bot", username = "HelperBot", fullName = "Helpful Bot", avatarUrl = null)
    )

    override suspend fun getAllUsers(): List<User> = withContext(Dispatchers.IO) { users.toList() }

    override suspend fun searchUsersByNickname(query: String): List<User> = withContext(Dispatchers.IO) {
        if (query.isBlank()) return@withContext getAllUsers()
        users.filter { it.nickname.contains(query, ignoreCase = true) }
    }

    override suspend fun getUserById(userId: String): User? = withContext(Dispatchers.IO) {
        users.firstOrNull { it.id == userId }
    }

    override suspend fun addOrUpdateUser(user: User) {
        withContext(Dispatchers.IO) {
            val index = users.indexOfFirst { it.id == user.id }
            if (index >= 0) {
                users[index] = user
            } else {
                users.add(user)
            }
        }
    }
}
