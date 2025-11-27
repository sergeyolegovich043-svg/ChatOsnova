package com.example.chatosnova.data.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.example.chatosnova.domain.auth.AuthRepository
import com.example.chatosnova.domain.auth.User
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.UUID

class AuthRepositoryImpl(private val context: Context) : AuthRepository {

    private val prefs by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "secure_auth",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    override suspend fun register(username: String, email: String, password: String): Result<User> =
        withContext(Dispatchers.IO) {
            // Mock registration: in production call Retrofit ApiService over HTTPS
            if (password.length < 8) return@withContext Result.failure(IllegalArgumentException("Password too short"))
            val user = User(UUID.randomUUID().toString(), username, email)
            prefs.edit().putString(KEY_TOKEN, UUID.randomUUID().toString()).apply()
            prefs.edit().putString(KEY_USERNAME, user.username).putString(KEY_USER_ID, user.id).apply()
            Result.success(user)
        }

    override suspend fun login(usernameOrEmail: String, password: String): Result<User> =
        withContext(Dispatchers.IO) {
            // TODO: Replace with Retrofit login call (HTTPS). Validate token storage.
            val storedUsername = prefs.getString(KEY_USERNAME, null) ?: usernameOrEmail
            val user = User(prefs.getString(KEY_USER_ID, UUID.randomUUID().toString())!!, storedUsername)
            prefs.edit().putString(KEY_TOKEN, UUID.randomUUID().toString()).apply()
            Result.success(user)
        }

    override suspend fun logout() {
        withContext(Dispatchers.IO) { prefs.edit().clear().apply() }
    }

    override suspend fun getCurrentUser(): User? = withContext(Dispatchers.IO) {
        val username = prefs.getString(KEY_USERNAME, null) ?: return@withContext null
        val id = prefs.getString(KEY_USER_ID, null) ?: return@withContext null
        User(id, username)
    }

    companion object {
        private const val KEY_TOKEN = "token"
        private const val KEY_USERNAME = "username"
        private const val KEY_USER_ID = "user_id"
    }
}
