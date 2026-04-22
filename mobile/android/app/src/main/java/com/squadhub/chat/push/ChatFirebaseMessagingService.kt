package com.squadhub.chat.push

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.squadhub.chat.data.remote.ChatPushRegistrar
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Receives FCM pushes for Squad Chat.
 *
 *  - onNewToken: registers the device with our server (provider=fcm). The
 *    server's push dispatcher (server/src/push/fcm.ts) will then target this
 *    device when a message arrives and the recipient is offline.
 *  - onMessageReceived: if the app is currently in the foreground, we drop
 *    the push — the Socket.IO stream is already delivering the message, so
 *    duplicating via a notification would be noisy. Otherwise we post a
 *    regular chat notification via NotificationHelper.
 */
@AndroidEntryPoint
class ChatFirebaseMessagingService : FirebaseMessagingService() {

    @Inject lateinit var pushRegistrar: ChatPushRegistrar

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        scope.launch { pushRegistrar.register(token) }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)

        val appForeground = ProcessLifecycleOwner.get().lifecycle.currentState
            .isAtLeast(Lifecycle.State.STARTED)
        if (appForeground) return

        val data = message.data
        val title = message.notification?.title ?: data["title"] ?: "New message"
        val body = message.notification?.body ?: data["body"] ?: ""
        val groupId = data["group_id"]?.takeIf { it.isNotBlank() && it != "null" }
        val dmId = data["dm_conversation_id"]?.takeIf { it.isNotBlank() && it != "null" }
        val messageId = data["message_id"]

        NotificationHelper.postChatMessage(
            context = applicationContext,
            title = title,
            body = body,
            groupId = groupId,
            dmConversationId = dmId,
            messageId = messageId,
        )
    }
}
