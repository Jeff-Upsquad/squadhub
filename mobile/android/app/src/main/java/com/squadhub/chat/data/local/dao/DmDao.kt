package com.squadhub.chat.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.squadhub.chat.data.local.entities.DmEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface DmDao {
    @Query("SELECT * FROM dms ORDER BY COALESCE(lastMessageAt, createdAt) DESC")
    fun observeAll(): Flow<List<DmEntity>>

    @Query("SELECT * FROM dms WHERE id = :id LIMIT 1")
    fun observeById(id: String): Flow<DmEntity?>

    @Query("UPDATE dms SET unreadCount = 0 WHERE id = :id")
    suspend fun markRead(id: String)

    @Query(
        """
        UPDATE dms
        SET lastMessageId = :msgId,
            lastMessageContent = :content,
            lastMessageType = :type,
            lastMessageSenderId = :senderId,
            lastMessageFileName = :fileName,
            lastMessageAt = :createdAt,
            unreadCount = CASE
                WHEN :incrementUnread THEN COALESCE(unreadCount, 0) + 1
                ELSE COALESCE(unreadCount, 0)
            END
        WHERE id = :dmId
        """,
    )
    suspend fun onIncomingMessage(
        dmId: String,
        msgId: String,
        content: String?,
        type: String,
        senderId: String?,
        fileName: String?,
        createdAt: String,
        incrementUnread: Boolean,
    )

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(dms: List<DmEntity>)

    @Query("DELETE FROM dms WHERE id NOT IN (:keep)")
    suspend fun deleteNotIn(keep: List<String>)

    @Query("DELETE FROM dms")
    suspend fun clear()
}
