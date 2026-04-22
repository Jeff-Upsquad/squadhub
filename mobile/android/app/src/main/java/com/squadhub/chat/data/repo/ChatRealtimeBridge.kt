package com.squadhub.chat.data.repo

import com.squadhub.chat.data.local.dao.DmDao
import com.squadhub.chat.data.local.dao.GroupDao
import com.squadhub.chat.data.local.dao.MessageDao
import com.squadhub.chat.data.local.entities.MessageEntity
import com.squadhub.chat.data.model.ChatMessage
import com.squadhub.chat.data.remote.AuthTokenStore
import com.squadhub.chat.data.remote.SocketManager
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Process-scoped subscriber bridging SocketManager events into the local DB.
 * Started once from Application.onCreate.
 *
 *   chat_message_new
 *     → upsert into messages table (any open ChatScreen re-renders)
 *     → denormalize onto the group/DM inbox row (lastMessage*, unread bump
 *       unless the sender is the current user).
 *   chat_message_edit → upsert into messages.
 *   chat_message_delete → delete the row by id.
 */
@Singleton
class ChatRealtimeBridge @Inject constructor(
    private val socketManager: SocketManager,
    private val messageDao: MessageDao,
    private val groupDao: GroupDao,
    private val dmDao: DmDao,
    private val tokenStore: AuthTokenStore,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun start() {
        scope.launch {
            socketManager.onMessageNew.collect { msg ->
                messageDao.upsert(MessageEntity.fromModel(msg))
                updateInboxRow(msg)
            }
        }
        scope.launch {
            socketManager.onMessageEdit.collect { msg ->
                messageDao.upsert(MessageEntity.fromModel(msg))
                // An edit of the newest message could re-denormalize, but for
                // simplicity we only refresh last_message on *new* messages;
                // edits update the bubble in-place via the messages table.
            }
        }
        scope.launch {
            socketManager.onMessageDelete.collect { event ->
                messageDao.deleteById(event.id)
            }
        }
    }

    private suspend fun updateInboxRow(msg: ChatMessage) {
        val isFromMe = msg.sender_id != null && msg.sender_id == tokenStore.currentUserId
        val incrementUnread = !isFromMe

        when {
            msg.group_id != null -> groupDao.onIncomingMessage(
                groupId = msg.group_id,
                msgId = msg.id,
                content = msg.content,
                type = msg.type.wireValue,
                senderId = msg.sender_id,
                senderName = msg.sender?.display_name,
                fileName = msg.file_name,
                createdAt = msg.created_at,
                incrementUnread = incrementUnread,
            )
            msg.dm_conversation_id != null -> dmDao.onIncomingMessage(
                dmId = msg.dm_conversation_id,
                msgId = msg.id,
                content = msg.content,
                type = msg.type.wireValue,
                senderId = msg.sender_id,
                fileName = msg.file_name,
                createdAt = msg.created_at,
                incrementUnread = incrementUnread,
            )
        }
    }
}
