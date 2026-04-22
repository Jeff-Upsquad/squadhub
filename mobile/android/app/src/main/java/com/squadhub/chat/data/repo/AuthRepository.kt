package com.squadhub.chat.data.repo

import com.squadhub.chat.BuildConfig
import com.squadhub.chat.data.model.ChatAppVariant
import com.squadhub.chat.data.model.LoginRequest
import com.squadhub.chat.data.model.User
import com.squadhub.chat.data.model.UserType
import com.squadhub.chat.data.remote.AuthTokenStore
import com.squadhub.chat.data.remote.ChatApi
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.StateFlow

/**
 * Login + variant-fit check + logout. On login, we verify the authenticated
 * user's `user_type` lines up with this APK's flavor — otherwise we sign out
 * and return VariantMismatch so the UI can suggest the other app.
 */
@Singleton
class AuthRepository @Inject constructor(
    private val api: ChatApi,
    private val tokenStore: AuthTokenStore,
) {
    val accessToken: StateFlow<String?> = tokenStore.accessToken

    suspend fun login(email: String, password: String): LoginResult {
        val env = runCatching { api.login(LoginRequest(email, password)) }
            .getOrElse { return LoginResult.NetworkError(it.message ?: "Network error") }

        val data = env.data
        if (!env.success || data == null) {
            return LoginResult.ServerError(env.error ?: "Invalid email or password")
        }

        val expected = variantForBuild()
        val derived = deriveVariant(data.user.user_type)
        if (derived != expected) {
            // Do NOT persist tokens — this user doesn't belong in this APK.
            return LoginResult.VariantMismatch(
                expected = expected,
                actualForUser = derived,
                user = data.user,
            )
        }

        tokenStore.save(data.access_token, data.refresh_token, data.user.id)
        return LoginResult.Success(data.user)
    }

    suspend fun logout() {
        runCatching { api.logout() }
        tokenStore.clear()
    }

    fun variantForBuild(): ChatAppVariant =
        if (BuildConfig.APP_VARIANT == "team") ChatAppVariant.TEAM else ChatAppVariant.CLIENTS

    // Mirrors server/src/middleware/chat.ts:deriveAppVariant (internal/partner/admin → team; client/client_staff → clients).
    private fun deriveVariant(userType: UserType): ChatAppVariant = when (userType) {
        UserType.CLIENT, UserType.CLIENT_STAFF -> ChatAppVariant.CLIENTS
        UserType.INTERNAL, UserType.PARTNER -> ChatAppVariant.TEAM
    }

    sealed interface LoginResult {
        data class Success(val user: User) : LoginResult
        data class VariantMismatch(
            val expected: ChatAppVariant,
            val actualForUser: ChatAppVariant,
            val user: User,
        ) : LoginResult
        data class ServerError(val message: String) : LoginResult
        data class NetworkError(val message: String) : LoginResult
    }
}
