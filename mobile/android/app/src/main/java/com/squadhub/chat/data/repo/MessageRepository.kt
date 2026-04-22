package com.squadhub.chat.data.repo

import com.squadhub.chat.data.local.dao.DmDao
import com.squadhub.chat.data.local.dao.GroupDao
import com.squadhub.chat.data.local.dao.MessageDao
import com.squadhub.chat.data.local.entities.MessageEntity
import com.squadhub.chat.data.model.ChatConversationType
import com.squadhub.chat.data.model.ChatMarkReadRequest
import com.squadhub.chat.data.model.ChatMessage
import com.squadhub.chat.data.model.ChatMessageLocalState
import com.squadhub.chat.data.model.ChatMessageSender
import com.squadhub.chat.data.model.ChatMessageType
import com.squadhub.chat.data.model.ChatSendRequest
import com.squadhub.chat.data.remote.AuthTokenStore
import com.squadhub.chat.data.remote.ChatApi
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Offline-first message repository.
 *
 * - observeMessages() reads the local Room table, so UI is instant.
 * - loadInitial() / loadMore() hit /chat/messages and upsert the rows.
 * - send() inserts a local optimistic row, POSTs, then reconciles.
 */
@Singleton
class MessageRepository @Inject constructor(
    private val api: ChatApi,
    private val dao: MessageDao,
    private val groupDao: GroupDao,
    private val dmDao: DmDao,
    private val tokenStore: AuthTokenStore,
) {

    data class Conversation(val type: ChatConversationType, val id: String) {
        val groupId get() = if (type == ChatConversationType.GROUP) id else null
        val dmId get() = if (type == ChatConversationType.DM) id else null
    }

    fun observeMessages(c: Conversation): Flow<List<ChatMessage>> =
        when (c.type) {
            ChatConversationType.GROUP -> dao.observeGroupMessages(c.id)
            ChatConversationType.DM -> dao.observeDmMessages(c.id)
        }.map { rows -> rows.map { it.toModel() } }

    suspend fun loadInitial(c: Conversation): Result<Boolean> = runCatching {
        val page = api.listMessages(groupId = c.groupId, dmConversationId = c.dmId, cursor = null)
        val messages = page.data
        dao.upsertAll(messages.map { MessageEntity.fromModel(it) })
        page.has_more
    }

    suspend fun loadMore(c: Conversation): Result<Boolean> = runCatching {
        val cursor = when (c.type) {
            ChatConversationType.GROUP -> dao.oldestGroupCursor(c.id)
            ChatConversationType.DM -> dao.oldestDmCursor(c.id)
        }
        val page = api.listMessages(groupId = c.groupId, dmConversationId = c.dmId, cursor = cursor)
        dao.upsertAll(page.data.map { MessageEntity.fromModel(it) })
        page.has_more
    }

    suspend fun send(c: Conversation, content: String): Result<Unit> {
        val trimmed = content.trim()
        if (trimmed.isEmpty()) return Result.success(Unit)

        val tempId = UUID.randomUUID().toString()
        val nowIso = java.time.Instant.now().toString()
        val senderId = tokenStore.currentUserId

        // 1) Optimistic insert.
        val optimistic = MessageEntity(
            id = "temp:$tempId",
            groupId = c.groupId,
            dmConversationId = c.dmId,
            senderId = senderId,
            senderDisplayName = null,
            senderAvatarUrl = null,
            clientTempId = tempId,
            content = trimmed,
            type = ChatMessageType.TEXT.wireValue,
            fileUrl = null,
            fileName = null,
            fileSize = null,
            fileMime = null,
            durationMs = null,
            parentMessageId = null,
            editedAt = null,
            deletedAt = null,
            createdAt = nowIso,
            localState = ChatMessageLocalState.SENDING.name,
        )
        dao.upsert(optimistic)

        // 2) POST.
        val result = runCatching {
            api.sendMessage(
                ChatSendRequest(
                    group_id = c.groupId,
                    dm_conversation_id = c.dmId,
                    client_temp_id = tempId,
                    content = trimmed,
                    type = ChatMessageType.TEXT,
                ),
            )
        }

        return result.fold(
            onSuccess = { env ->
                val confirmed = env.data
                if (env.success && confirmed != null) {
                    dao.reconcileSent(tempId, MessageEntity.fromModel(confirmed))
                    Result.success(Unit)
                } else {
                    dao.markLocalState(tempId, ChatMessageLocalState.FAILED.name)
                    Result.failure(IllegalStateException(env.error ?: "Send failed"))
                }
            },
            onFailure = {
                dao.markLocalState(tempId, ChatMessageLocalState.FAILED.name)
                Result.failure(it)
            },
        )
    }

    suspend fun markRead(c: Conversation, upToMessageId: String): Result<Unit> = runCatching {
        val env = api.markRead(
            ChatMarkReadRequest(
                conversation_type = c.type,
                conversation_id = c.id,
                up_to_message_id = upToMessageId,
            ),
        )
        if (!env.success) throw IllegalStateException(env.error ?: "markRead failed")
        // Server confirmed — zero the local denormalized unread count so the
        // Inbox row's green badge clears immediately on return.
        when (c.type) {
            ChatConversationType.GROUP -> groupDao.markRead(c.id)
            ChatConversationType.DM -> dmDao.markRead(c.id)
        }
    }
}
