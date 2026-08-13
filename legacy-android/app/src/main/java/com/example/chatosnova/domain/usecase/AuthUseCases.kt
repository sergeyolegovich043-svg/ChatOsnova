package com.example.chatosnova.domain.usecase

import com.example.chatosnova.domain.auth.AuthRepository
import com.example.chatosnova.domain.auth.User

class LoginUseCase(private val repository: AuthRepository) {
    suspend operator fun invoke(usernameOrEmail: String, password: String): Result<User> =
        repository.login(usernameOrEmail, password)
}

class RegisterUseCase(private val repository: AuthRepository) {
    suspend operator fun invoke(username: String, email: String, password: String): Result<User> =
        repository.register(username, email, password)
}

class LogoutUseCase(private val repository: AuthRepository) {
    suspend operator fun invoke() = repository.logout()
}
