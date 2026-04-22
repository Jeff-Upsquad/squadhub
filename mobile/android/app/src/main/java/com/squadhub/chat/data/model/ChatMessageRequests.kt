package com.squadhub.chat.data.model

import kotlinx.serialization.Serializable

// Mirror of server/src/routes/chat/messages.ts:176-198 — keep minimal fields
// Phase 2 actually populates (content + type='text' + one conv id + client_temp_id).
// Attachments (file_url, voice duration, etc.) join in Phase 4.
@Serializable
data class ChatSendRequest(
    val group_id: String? = null,
    val dm_conversation_id: String? = null,
    val client_temp_id: String,
    val content: String? = null,
    val type: ChatMessageType = ChatMessageType.TEXT,
    val parent_message_id: String? = null,
    val mentions: List<String>? = null,
)

// Mirror of server/src/routes/chat/receipts.ts:12-16.
@Serializable
data class ChatMarkReadRequest(
    val conversation_type: ChatConversationType,
    val conversation_id: String,
    val up_to_message_id: String,
)

// /chat/messages returns an envelope distinct from the standard ApiEnvelope —
// it carries cursor + has_more alongside `data`.
@Serializable
data class ChatMessagesPage(
    val success: Boolean,
    val data: List<ChatMessage> = emptyList(),
    val cursor: String? = null,
    val has_more: Boolean = false,
    val error: String? = null,
)
