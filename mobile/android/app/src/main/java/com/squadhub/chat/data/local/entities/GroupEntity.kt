package com.squadhub.chat.data.local.entities

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.squadhub.chat.data.model.ChatAppVariant
import com.squadhub.chat.data.model.ChatGroup

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
) {
    fun toModel(): ChatGroup = ChatGroup(
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
    )

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
        )
    }
}
