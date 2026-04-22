package com.squadhub.chat.data.remote

import com.squadhub.chat.BuildConfig
import com.squadhub.chat.data.model.ChatAppVariant
import com.squadhub.chat.data.model.ChatPushProvider
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.Serializable

/**
 * Thin wrapper around POST /chat/push/register so the FCM service can call
 * it without pulling in Retrofit directly. We build our own Retrofit call
 * via ChatApi to keep auth + base URL consistent.
 */
@Singleton
class ChatPushRegistrar @Inject constructor(
    private val api: PushApi,
) {
    suspend fun register(token: String) {
        val variant = if (BuildConfig.APP_VARIANT == "team") ChatAppVariant.TEAM else ChatAppVariant.CLIENTS
        runCatching {
            api.register(
                PushRegisterBody(
                    token = token,
                    app_variant = variant,
                    platform = "android",
                    provider = ChatPushProvider.FCM,
                ),
            )
        }.onFailure { android.util.Log.w("ChatPushRegistrar", "register failed: ${it.message}") }
    }

    suspend fun unregister(token: String) {
        runCatching { api.unregister(PushUnregisterBody(token)) }
    }

    @Serializable
    data class PushRegisterBody(
        val token: String,
        val app_variant: ChatAppVariant,
        val platform: String,
        val provider: ChatPushProvider,
    )

    @Serializable
    data class PushUnregisterBody(val token: String)
}

// Split the push endpoints into a small interface so they're easy to use from
// a WorkManager worker later. Same Retrofit instance; auth interceptor still
// attaches the JWT.
interface PushApi {
    @retrofit2.http.POST("chat/push/register")
    suspend fun register(@retrofit2.http.Body body: ChatPushRegistrar.PushRegisterBody)

    @retrofit2.http.POST("chat/push/unregister")
    suspend fun unregister(@retrofit2.http.Body body: ChatPushRegistrar.PushUnregisterBody)
}
