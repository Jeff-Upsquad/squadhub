package com.squadhub.chat.data.local.entities

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.squadhub.chat.data.model.ChatDmConversation
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
) {
    fun toModel(): ChatDmConversation = ChatDmConversation(
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
    )

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
        )
    }
}
