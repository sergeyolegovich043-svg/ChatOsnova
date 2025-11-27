package com.example.chatosnova.presentation.navigation

sealed class Screen(val route: String) {
    object Login : Screen("login")
    object Register : Screen("register")
    object ChatList : Screen("chats")
    object Chat : Screen("chat/{chatId}") {
        fun create(chatId: String) = "chat/$chatId"
    }
    object Call : Screen("call/{callId}") {
        fun create(callId: String) = "call/$callId"
    }
}
