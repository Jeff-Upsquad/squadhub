package com.squadhub.chat.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import com.squadhub.chat.data.local.entities.MessageEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface MessageDao {
    @Query("SELECT * FROM messages WHERE groupId = :groupId ORDER BY createdAt ASC")
    fun observeGroupMessages(groupId: String): Flow<List<MessageEntity>>

    @Query("SELECT * FROM messages WHERE dmConversationId = :dmId ORDER BY createdAt ASC")
    fun observeDmMessages(dmId: String): Flow<List<MessageEntity>>

    @Query("SELECT MIN(createdAt) FROM messages WHERE groupId = :groupId")
    suspend fun oldestGroupCursor(groupId: String): String?

    @Query("SELECT MIN(createdAt) FROM messages WHERE dmConversationId = :dmId")
    suspend fun oldestDmCursor(dmId: String): String?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(messages: List<MessageEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(message: MessageEntity)

    @Query("DELETE FROM messages WHERE id = :id")
    suspend fun deleteById(id: String)

    /**
     * When the server echoes back a send, we delete the optimistic temp-id row
     * (if still present) and upsert the confirmed row in one transaction so the
     * Flow emits a single consistent state.
     */
    @Transaction
    suspend fun reconcileSent(tempId: String, confirmed: MessageEntity) {
        deleteByClientTempId(tempId)
        upsert(confirmed)
    }

    @Query("DELETE FROM messages WHERE clientTempId = :tempId AND localState IS NOT NULL")
    suspend fun deleteByClientTempId(tempId: String)

    @Query("UPDATE messages SET localState = :state WHERE clientTempId = :tempId")
    suspend fun markLocalState(tempId: String, state: String)
}
