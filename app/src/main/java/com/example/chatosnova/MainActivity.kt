package com.example.chatosnova

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Surface
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.example.chatosnova.data.auth.AuthRepositoryImpl
import com.example.chatosnova.data.call.FakeCallRepository
import com.example.chatosnova.data.chat.FakeChatRepository
import com.example.chatosnova.data.chat.NoopSecureMessageService
import com.example.chatosnova.data.user.InMemoryUserRepository
import com.example.chatosnova.presentation.auth.LoginScreen
import com.example.chatosnova.presentation.auth.RegisterScreen
import com.example.chatosnova.presentation.call.CallScreen
import com.example.chatosnova.presentation.chat.ChatListScreen
import com.example.chatosnova.presentation.chat.ChatScreen
import com.example.chatosnova.presentation.navigation.Screen
import com.example.chatosnova.presentation.profile.UserProfileScreen
import com.example.chatosnova.presentation.theme.ChatOsnovaTheme
import com.example.chatosnova.presentation.viewmodel.CallViewModel
import com.example.chatosnova.presentation.viewmodel.ChatListViewModel
import com.example.chatosnova.presentation.viewmodel.ChatViewModel
import com.example.chatosnova.presentation.viewmodel.AuthViewModel
import com.example.chatosnova.presentation.viewmodel.UserProfileViewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val authRepository = AuthRepositoryImpl(this)
        val chatRepository = FakeChatRepository(NoopSecureMessageService())
        val callRepository = FakeCallRepository()
        val userRepository = InMemoryUserRepository()

        setContent {
            ChatOsnovaTheme {
                Surface {
                    val navController = rememberNavController()
                    val authViewModel: AuthViewModel = viewModel(factory = AuthViewModel.factory(authRepository))
                    val chatViewModel: ChatViewModel = viewModel(factory = ChatViewModel.factory(chatRepository))
                    val chatListViewModel: ChatListViewModel =
                        viewModel(factory = ChatListViewModel.factory(userRepository, chatRepository))
                    val callViewModel: CallViewModel = viewModel(factory = CallViewModel.factory(callRepository))

                    NavHost(navController = navController, startDestination = Screen.Login.route) {
                        composable(Screen.Login.route) {
                            LoginScreen(
                                onLogin = { user ->
                                    chatViewModel.setCurrentUser(user)
                                    chatListViewModel.setCurrentUser(user)
                                    navController.navigate(Screen.ChatList.route) {
                                        popUpTo(Screen.Login.route) { inclusive = true }
                                    }
                                },
                                onNavigateToRegister = { navController.navigate(Screen.Register.route) },
                                viewModel = authViewModel
                            )
                        }
                        composable(Screen.Register.route) {
                            RegisterScreen(
                                onRegistered = { user ->
                                    chatViewModel.setCurrentUser(user)
                                    chatListViewModel.setCurrentUser(user)
                                    navController.navigate(Screen.ChatList.route) {
                                        popUpTo(Screen.Register.route) { inclusive = true }
                                    }
                                },
                                onNavigateToLogin = { navController.popBackStack() },
                                viewModel = authViewModel
                            )
                        }
                        composable(Screen.ChatList.route) {
                            ChatListScreen(navController = navController, viewModel = chatListViewModel)
                        }
                        composable(
                            route = Screen.Chat.route,
                            arguments = listOf(navArgument("chatId") { type = NavType.StringType })
                        ) { backStackEntry ->
                            val chatId = backStackEntry.arguments?.getString("chatId").orEmpty()
                            ChatScreen(
                                chatId = chatId,
                                onStartCall = { callId -> navController.navigate(Screen.Call.create(callId)) },
                                viewModel = chatViewModel
                            )
                        }
                        composable(
                            route = Screen.UserProfile.route,
                            arguments = listOf(navArgument("userId") { type = NavType.StringType })
                        ) { backStackEntry ->
                            val userId = backStackEntry.arguments?.getString("userId").orEmpty()
                            val profileViewModel: UserProfileViewModel = viewModel(
                                factory = UserProfileViewModel.factory(userRepository, userId)
                            )
                            UserProfileScreen(
                                navController = navController,
                                viewModel = profileViewModel,
                                chatListViewModel = chatListViewModel
                            )
                        }
                        composable(
                            route = Screen.Call.route,
                            arguments = listOf(navArgument("callId") { type = NavType.StringType })
                        ) { backStackEntry ->
                            val callId = backStackEntry.arguments?.getString("callId").orEmpty()
                            CallScreen(callId = callId, viewModel = callViewModel, onEnd = { navController.popBackStack() })
                        }
                    }
                }
            }
        }
    }
}
