package com.squadhub.chat.data.local.entities

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.squadhub.chat.data.model.ChatDmConversation
import com.squadhub.chat.data.model.ChatMessage
import com.squadhub.chat.data.model.ChatMessageType
import com.squadhub.chat.data.model.DmOtherUser
import com.squadhub.chat.data.model.UserType

@Entity(tableName = "dms")
data class DmEntity(
    @PrimaryKey val id: String,
    val user1Id: String,
    val user2Id: String,
    val otherUserId: String?,
    val otherUserDisplayName: String?,
    val otherUserAvatarUrl: String?,
    val otherUserType: String?,
    val lastMessageAt: String?,
    val unreadCount: Int?,
    val createdAt: String,
    // Denormalized last message preview.
    val lastMessageId: String?,
    val lastMessageContent: String?,
    val lastMessageType: String?,
    val lastMessageSenderId: String?,
    val lastMessageFileName: String?,
) {
    fun toModel(): ChatDmConversation {
        val last = if (lastMessageId != null) ChatMessage(
            id = lastMessageId,
            dm_conversation_id = id,
            sender_id = lastMessageSenderId,
            content = lastMessageContent,
            type = runCatching { ChatMessageType.valueOf(lastMessageType.orEmpty().uppercase()) }
                .getOrDefault(ChatMessageType.TEXT),
            file_name = lastMessageFileName,
            created_at = lastMessageAt.orEmpty(),
        ) else null

        return ChatDmConversation(
            id = id,
            user1_id = user1Id,
            user2_id = user2Id,
            last_message_at = lastMessageAt,
            created_at = createdAt,
            unread_count = unreadCount,
            other_user = otherUserId?.let {
                DmOtherUser(
                    id = it,
                    display_name = otherUserDisplayName.orEmpty(),
                    avatar_url = otherUserAvatarUrl,
                    user_type = runCatching { UserType.valueOf(otherUserType.orEmpty().uppercase()) }
                        .getOrDefault(UserType.PARTNER),
                )
            },
            last_message = last,
        )
    }

    companion object {
        fun fromModel(d: ChatDmConversation): DmEntity = DmEntity(
            id = d.id,
            user1Id = d.user1_id,
            user2Id = d.user2_id,
            otherUserId = d.other_user?.id,
            otherUserDisplayName = d.other_user?.display_name,
            otherUserAvatarUrl = d.other_user?.avatar_url,
            otherUserType = d.other_user?.user_type?.name?.lowercase(),
            lastMessageAt = d.last_message_at,
            unreadCount = d.unread_count,
            createdAt = d.created_at,
            lastMessageId = d.last_message?.id,
            lastMessageContent = d.last_message?.content,
            lastMessageType = d.last_message?.type?.wireValue,
            lastMessageSenderId = d.last_message?.sender?.id ?: d.last_message?.sender_id,
            lastMessageFileName = d.last_message?.file_name,
        )
    }
}
