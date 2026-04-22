package com.squadhub.chat.data.local.entities

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import com.squadhub.chat.data.model.ChatMessage
import com.squadhub.chat.data.model.ChatMessageLocalState
import com.squadhub.chat.data.model.ChatMessageSender
import com.squadhub.chat.data.model.ChatMessageType

/**
 * One row per message. Keyed by the server id for confirmed messages, and by
 * a client-only temp id for optimistic sends. On server echo we upsert by
 * `clientTempId` match then drop the temp row.
 */
@Entity(
    tableName = "messages",
    indices = [
        Index(value = ["groupId", "createdAt"]),
        Index(value = ["dmConversationId", "createdAt"]),
        Index(value = ["clientTempId"], unique = false),
    ],
)
data class MessageEntity(
    @PrimaryKey val id: String,
    val groupId: String?,
    val dmConversationId: String?,
    val senderId: String?,
    val senderDisplayName: String?,
    val senderAvatarUrl: String?,
    val clientTempId: String?,
    val content: String?,
    val type: String,
    val fileUrl: String?,
    val fileName: String?,
    val fileSize: Long?,
    val fileMime: String?,
    val durationMs: Long?,
    val parentMessageId: String?,
    val editedAt: String?,
    val deletedAt: String?,
    val createdAt: String,
    // Client-only. NULL for confirmed server rows; SENDING/FAILED for queued.
    val localState: String?,
) {
    fun toModel(): ChatMessage = ChatMessage(
        id = id,
        group_id = groupId,
        dm_conversation_id = dmConversationId,
        sender_id = senderId,
        client_temp_id = clientTempId,
        content = content,
        type = runCatching { ChatMessageType.valueOf(type.uppercase()) }
            .getOrDefault(ChatMessageType.TEXT),
        file_url = fileUrl,
        file_name = fileName,
        file_size = fileSize,
        file_mime = fileMime,
        duration_ms = durationMs,
        parent_message_id = parentMessageId,
        edited_at = editedAt,
        deleted_at = deletedAt,
        created_at = createdAt,
        sender = senderId?.let {
            ChatMessageSender(
                id = it,
                display_name = senderDisplayName.orEmpty(),
                avatar_url = senderAvatarUrl,
            )
        },
        local_state = localState?.let { runCatching { ChatMessageLocalState.valueOf(it) }.getOrNull() },
    )

    companion object {
        fun fromModel(m: ChatMessage): MessageEntity = MessageEntity(
            id = m.id,
            groupId = m.group_id,
            dmConversationId = m.dm_conversation_id,
            senderId = m.sender?.id ?: m.sender_id,
            senderDisplayName = m.sender?.display_name,
            senderAvatarUrl = m.sender?.avatar_url,
            clientTempId = m.client_temp_id,
            content = m.content,
            type = m.type.wireValue,
            fileUrl = m.file_url,
            fileName = m.file_name,
            fileSize = m.file_size,
            fileMime = m.file_mime,
            durationMs = m.duration_ms,
            parentMessageId = m.parent_message_id,
            editedAt = m.edited_at,
            deletedAt = m.deleted_at,
            createdAt = m.created_at,
            localState = m.local_state?.name,
        )
    }
}
