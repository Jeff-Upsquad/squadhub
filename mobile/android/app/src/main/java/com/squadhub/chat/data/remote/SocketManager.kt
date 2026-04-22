package com.squadhub.chat.data.remote

import com.squadhub.chat.BuildConfig
import com.squadhub.chat.data.model.ChatMessage
import io.socket.client.IO
import io.socket.client.Socket
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import org.json.JSONObject

/**
 * Singleton wrapper around the socket.io-client Socket.
 *
 *  - Connects on foreground (driven by ProcessLifecycleOwner in Application).
 *  - Disconnects on background to save battery.
 *  - Server auto-joins the user into all their chat_user / chat_group / chat_dm
 *    rooms based on the JWT, so we don't emit any join_* events from here.
 *  - Events are exposed as SharedFlow so multiple consumers (repositories,
 *    active ChatScreen, InboxViewModel) can subscribe independently.
 */
@Singleton
class SocketManager @Inject constructor(
    private val tokenStore: AuthTokenStore,
    private val json: Json,
) {
    private var socket: Socket? = null

    enum class Status { DISCONNECTED, CONNECTING, CONNECTED, ERROR }

    private val _status = MutableStateFlow(Status.DISCONNECTED)
    val status: StateFlow<Status> = _status.asStateFlow()

    private val _onMessageNew = MutableSharedFlow<ChatMessage>(extraBufferCapacity = 64)
    val onMessageNew: SharedFlow<ChatMessage> = _onMessageNew.asSharedFlow()

    private val _onMessageEdit = MutableSharedFlow<ChatMessage>(extraBufferCapacity = 32)
    val onMessageEdit: SharedFlow<ChatMessage> = _onMessageEdit.asSharedFlow()

    private val _onMessageDelete = MutableSharedFlow<MessageDeletedEvent>(extraBufferCapacity = 16)
    val onMessageDelete: SharedFlow<MessageDeletedEvent> = _onMessageDelete.asSharedFlow()

    fun connect() {
        val token = tokenStore.accessToken.value
        if (token.isNullOrBlank()) {
            // Not signed in — nothing to connect for.
            return
        }
        if (socket?.connected() == true) return

        _status.value = Status.CONNECTING

        val options = IO.Options.builder()
            .setAuth(mapOf("token" to token))
            .setReconnection(true)
            .setReconnectionAttempts(Int.MAX_VALUE)
            .setReconnectionDelay(1_000)
            .setReconnectionDelayMax(15_000)
            .setTransports(arrayOf("websocket"))
            .build()

        val s = IO.socket(BuildConfig.API_BASE_URL.trimEnd('/'), options)
        socket = s

        s.on(Socket.EVENT_CONNECT) { _status.value = Status.CONNECTED }
        s.on(Socket.EVENT_DISCONNECT) { _status.value = Status.DISCONNECTED }
        s.on(Socket.EVENT_CONNECT_ERROR) { _status.value = Status.ERROR }

        s.on("chat_message_new") { args -> emitMessage(args, _onMessageNew) }
        s.on("chat_message_edit") { args -> emitMessage(args, _onMessageEdit) }
        s.on("chat_message_delete") { args -> emitDelete(args) }

        s.connect()
    }

    fun disconnect() {
        socket?.off()
        socket?.disconnect()
        socket = null
        _status.value = Status.DISCONNECTED
    }

    /** Called when the user signs out — drop tokens AND any active connection. */
    fun disconnectAndReset() {
        disconnect()
    }

    private fun emitMessage(args: Array<Any?>, target: MutableSharedFlow<ChatMessage>) {
        val payload = args.firstOrNull() as? JSONObject ?: return
        val parsed = runCatching {
            json.decodeFromString(ChatMessage.serializer(), payload.toString())
        }.getOrNull() ?: return
        target.tryEmit(parsed)
    }

    private fun emitDelete(args: Array<Any?>) {
        val payload = args.firstOrNull() as? JSONObject ?: return
        val id = payload.optString("id", null) ?: return
        val groupId = payload.optString("group_id", null)?.takeIf { it.isNotBlank() }
        val dmId = payload.optString("dm_conversation_id", null)?.takeIf { it.isNotBlank() }
        _onMessageDelete.tryEmit(MessageDeletedEvent(id, groupId, dmId))
    }

    data class MessageDeletedEvent(
        val id: String,
        val groupId: String?,
        val dmConversationId: String?,
    )
}
