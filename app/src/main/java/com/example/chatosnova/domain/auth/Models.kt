package com.example.chatosnova.domain.auth

data class User(
    val id: String,
    val username: String,
    val email: String? = null,
    val avatarUrl: String? = null,
    val fullName: String? = null
) {
    val nickname: String get() = username
}
