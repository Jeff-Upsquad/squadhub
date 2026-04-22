package com.squadhub.chat.data.model

import kotlinx.serialization.Serializable

// Mirror of shared/src/index.ts:1320 — keep in sync manually.
@Serializable
data class ChatGroup(
    val id: String,
    val name: String,
    val description: String? = null,
    val avatar_url: String? = null,
    val app_scope: ChatAppVariant,
    val created_by: String? = null,
    val archived_at: String? = null,
    val created_at: String,
    val updated_at: String,
    // Joined (optional)
    val member_count: Int? = null,
    val unread_count: Int? = null,
    val my_is_group_admin: Boolean? = null,
    val my_last_read_at: String? = null,
    val last_message: ChatMessage? = null,
)
