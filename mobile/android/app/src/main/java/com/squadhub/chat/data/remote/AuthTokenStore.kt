package com.squadhub.chat.data.remote

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Persists the Supabase JWT pair (access + refresh) in EncryptedSharedPreferences.
 * Exposes the access token as a StateFlow so UI can react to sign-in/sign-out.
 */
@Singleton
class AuthTokenStore @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val prefs: SharedPreferences by lazy {
        val key = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "squad_chat_auth_encrypted",
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    private val _accessToken = MutableStateFlow(prefs.getString(KEY_ACCESS, null))
    val accessToken: StateFlow<String?> = _accessToken

    val refreshToken: String? get() = prefs.getString(KEY_REFRESH, null)

    val currentUserId: String? get() = prefs.getString(KEY_USER_ID, null)

    fun save(accessToken: String, refreshToken: String, userId: String) {
        prefs.edit()
            .putString(KEY_ACCESS, accessToken)
            .putString(KEY_REFRESH, refreshToken)
            .putString(KEY_USER_ID, userId)
            .apply()
        _accessToken.value = accessToken
    }

    fun updateTokens(accessToken: String, refreshToken: String) {
        prefs.edit()
            .putString(KEY_ACCESS, accessToken)
            .putString(KEY_REFRESH, refreshToken)
            .apply()
        _accessToken.value = accessToken
    }

    fun clear() {
        prefs.edit().clear().apply()
        _accessToken.value = null
    }

    private companion object {
        const val KEY_ACCESS = "access_token"
        const val KEY_REFRESH = "refresh_token"
        const val KEY_USER_ID = "user_id"
    }
}
