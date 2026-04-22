package com.squadhub.chat.data.model

import kotlinx.serialization.Serializable

// Mirror of shared/src/index.ts:1350 — keep in sync manually.
@Serializable
data class ChatDmConversation(
    val id: String,
    val user1_id: String,
    val user2_id: String,
    val last_message_at: String? = null,
    val created_at: String,
    // Joined
    val other_user: DmOtherUser? = null,
    val unread_count: Int? = null,
    val last_message: ChatMessage? = null,
)

@Serializable
data class DmOtherUser(
    val id: String,
    val display_name: String,
    val avatar_url: String? = null,
    val user_type: UserType,
    val is_admin: Boolean = false,
)
