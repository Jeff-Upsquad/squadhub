package com.squadhub.chat.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.squadhub.chat.data.local.entities.GroupEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface GroupDao {
    @Query("SELECT * FROM groups WHERE archivedAt IS NULL ORDER BY updatedAt DESC")
    fun observeActive(): Flow<List<GroupEntity>>

    @Query("SELECT * FROM groups WHERE id = :id LIMIT 1")
    fun observeById(id: String): Flow<GroupEntity?>

    @Query("UPDATE groups SET unreadCount = 0 WHERE id = :id")
    suspend fun markRead(id: String)

    /**
     * Denormalize an incoming message onto the group row so the inbox preview,
     * timestamp, and unread badge refresh without hitting the server. Runs
     * from ChatRealtimeBridge on every chat_message_new event.
     *
     * `incrementUnread` should be false when the sender is the current user.
     */
    @Query(
        """
        UPDATE groups
        SET lastMessageId = :msgId,
            lastMessageContent = :content,
            lastMessageType = :type,
            lastMessageSenderId = :senderId,
            lastMessageSenderName = :senderName,
            lastMessageFileName = :fileName,
            lastMessageCreatedAt = :createdAt,
            updatedAt = :createdAt,
            unreadCount = CASE
                WHEN :incrementUnread THEN COALESCE(unreadCount, 0) + 1
                ELSE COALESCE(unreadCount, 0)
            END
        WHERE id = :groupId
        """,
    )
    suspend fun onIncomingMessage(
        groupId: String,
        msgId: String,
        content: String?,
        type: String,
        senderId: String?,
        senderName: String?,
        fileName: String?,
        createdAt: String,
        incrementUnread: Boolean,
    )

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(groups: List<GroupEntity>)

    @Query("DELETE FROM groups WHERE id NOT IN (:keep)")
    suspend fun deleteNotIn(keep: List<String>)

    @Query("DELETE FROM groups")
    suspend fun clear()
}
