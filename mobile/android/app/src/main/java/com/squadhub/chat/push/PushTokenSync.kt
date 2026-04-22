package com.squadhub.chat.push

import com.google.firebase.messaging.FirebaseMessaging
import com.squadhub.chat.data.remote.AuthTokenStore
import com.squadhub.chat.data.remote.ChatPushRegistrar
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Makes sure the server always knows our current FCM device token.
 *
 *  - On app start, if we're signed in, fetch the current FCM token and POST
 *    it. (Covers: app reinstall, cleared-data, FCM token rotation while the
 *    app was offline.)
 *  - On transition from signed-out → signed-in, register again so a fresh
 *    login on a new device gets tracked.
 *
 * `ChatFirebaseMessagingService.onNewToken` handles the on-the-fly rotation
 * case — between the two, every token change should reach the server.
 */
@Singleton
class PushTokenSync @Inject constructor(
    private val tokenStore: AuthTokenStore,
    private val registrar: ChatPushRegistrar,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun start() {
        scope.launch {
            // Fire once now (if signed in), then on every subsequent sign-in.
            tokenStore.accessToken
                .filterNotNull()
                .collect { _ ->
                    val fcm = runCatching { fetchFcmToken() }.getOrNull() ?: return@collect
                    registrar.register(fcm)
                }
        }
    }

    private suspend fun fetchFcmToken(): String = suspendCancellableCoroutine { cont ->
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { token -> cont.resume(token) }
            .addOnFailureListener { e -> cont.resumeWithException(e) }
    }
}
