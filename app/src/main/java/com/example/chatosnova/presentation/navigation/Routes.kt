package com.example.chatosnova.presentation.navigation

sealed class Screen(val route: String) {
    object Login : Screen("login")
    object Register : Screen("register")
    object ChatList : Screen("chats")
    object Chat : Screen("chat/{chatId}") {
        fun create(chatId: String) = "chat/$chatId"
    }
    object UserProfile : Screen("user_profile/{userId}") {
        fun create(userId: String) = "user_profile/$userId"
    }
    object Call : Screen("call/{callId}") {
        fun create(callId: String) = "call/$callId"
    }
}
