package com.squadhub.chat.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient

// Mirror of shared/src/index.ts:1369-1397 (ChatMessage) — keep in sync manually.
//
// Only the fields the Android app currently reads are typed; extras are
// tolerated by the deserializer (ignoreUnknownKeys = true in NetworkModule).
@Serializable
data class ChatMessage(
    val id: String,
    val group_id: String? = null,
    val dm_conversation_id: String? = null,
    val sender_id: String? = null,
    val client_temp_id: String? = null,
    val content: String? = null,
    val type: ChatMessageType = ChatMessageType.TEXT,
    val file_url: String? = null,
    val file_name: String? = null,
    val file_size: Long? = null,
    val file_mime: String? = null,
    val duration_ms: Long? = null,
    val width: Int? = null,
    val height: Int? = null,
    val parent_message_id: String? = null,
    val mentions: List<String> = emptyList(),
    val edited_at: String? = null,
    val deleted_at: String? = null,
    val created_at: String,
    // Joined
    val sender: ChatMessageSender? = null,
    // Client-only — never serialized outbound, not returned from server.
    @Transient val local_state: ChatMessageLocalState? = null,
)

// Mirror of the Pick<User, ...> the server joins on sender
// (server/src/routes/chat/messages.ts MESSAGE_SELECT).
@Serializable
data class ChatMessageSender(
    val id: String,
    val display_name: String,
    val avatar_url: String? = null,
    val user_type: UserType = UserType.INTERNAL,
    val is_admin: Boolean = false,
)
