package com.squadhub.chat.data.local.entities

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.squadhub.chat.data.model.ChatAppVariant
import com.squadhub.chat.data.model.ChatGroup
import com.squadhub.chat.data.model.ChatMessage
import com.squadhub.chat.data.model.ChatMessageSender
import com.squadhub.chat.data.model.ChatMessageType

@Entity(tableName = "groups")
data class GroupEntity(
    @PrimaryKey val id: String,
    val name: String,
    val description: String?,
    val avatarUrl: String?,
    val appScope: String,
    val memberCount: Int?,
    val unreadCount: Int?,
    val archivedAt: String?,
    val updatedAt: String,
    // Denormalized last message preview (for the inbox row subtitle + timestamp).
    val lastMessageId: String?,
    val lastMessageContent: String?,
    val lastMessageType: String?,
    val lastMessageSenderId: String?,
    val lastMessageSenderName: String?,
    val lastMessageFileName: String?,
    val lastMessageCreatedAt: String?,
) {
    fun toModel(): ChatGroup {
        val last = if (lastMessageId != null) ChatMessage(
            id = lastMessageId,
            group_id = id,
            sender_id = lastMessageSenderId,
            content = lastMessageContent,
            type = runCatching { ChatMessageType.valueOf(lastMessageType.orEmpty().uppercase()) }
                .getOrDefault(ChatMessageType.TEXT),
            file_name = lastMessageFileName,
            created_at = lastMessageCreatedAt.orEmpty(),
            sender = lastMessageSenderId?.let {
                ChatMessageSender(id = it, display_name = lastMessageSenderName.orEmpty())
            },
        ) else null

        return ChatGroup(
            id = id,
            name = name,
            description = description,
            avatar_url = avatarUrl,
            app_scope = if (appScope == "team") ChatAppVariant.TEAM else ChatAppVariant.CLIENTS,
            created_by = null,
            archived_at = archivedAt,
            created_at = updatedAt,
            updated_at = updatedAt,
            member_count = memberCount,
            unread_count = unreadCount,
            last_message = last,
        )
    }

    companion object {
        fun fromModel(g: ChatGroup): GroupEntity = GroupEntity(
            id = g.id,
            name = g.name,
            description = g.description,
            avatarUrl = g.avatar_url,
            appScope = g.app_scope.wireValue,
            memberCount = g.member_count,
            unreadCount = g.unread_count,
            archivedAt = g.archived_at,
            updatedAt = g.updated_at,
            lastMessageId = g.last_message?.id,
            lastMessageContent = g.last_message?.content,
            lastMessageType = g.last_message?.type?.wireValue,
            lastMessageSenderId = g.last_message?.sender?.id ?: g.last_message?.sender_id,
            lastMessageSenderName = g.last_message?.sender?.display_name,
            lastMessageFileName = g.last_message?.file_name,
            lastMessageCreatedAt = g.last_message?.created_at,
        )
    }
}
