package com.example.chatosnova.domain.auth

data class User(
    val id: String,
    val username: String,
    val email: String? = null,
    val avatarUrl: String? = null
)
