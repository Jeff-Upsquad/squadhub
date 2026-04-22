package com.squadhub.chat.data.repo

import com.squadhub.chat.data.local.dao.DmDao
import com.squadhub.chat.data.local.dao.GroupDao
import com.squadhub.chat.data.local.dao.MessageDao
import com.squadhub.chat.data.local.entities.MessageEntity
import com.squadhub.chat.data.remote.SocketManager
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Long-lived subscriber that bridges SocketManager events into the local DB.
 * One instance, process-scoped — started from Application.onCreate.
 *
 *  - chat_message_new  → upsert into messages table (MessageRepository flows
 *    pick it up automatically; any open ChatScreen re-renders).
 *  - chat_message_edit → same upsert (edited_at is part of the payload).
 *  - chat_message_delete → delete row by id.
 *
 * Inbox `last_message` freshness is handled by the UI triggering a groups/dms
 * refresh when it comes back into view — a real-time merge of the inbox row
 * would need denormalized last-message logic in the bridge; skipping for now
 * since the inbox already refreshes on foreground.
 */
@Singleton
class ChatRealtimeBridge @Inject constructor(
    private val socketManager: SocketManager,
    private val messageDao: MessageDao,
    @Suppress("unused") private val groupDao: GroupDao,
    @Suppress("unused") private val dmDao: DmDao,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun start() {
        scope.launch {
            socketManager.onMessageNew.collect { msg ->
                messageDao.upsert(MessageEntity.fromModel(msg))
            }
        }
        scope.launch {
            socketManager.onMessageEdit.collect { msg ->
                messageDao.upsert(MessageEntity.fromModel(msg))
            }
        }
        scope.launch {
            socketManager.onMessageDelete.collect { event ->
                messageDao.deleteById(event.id)
            }
        }
    }
}
