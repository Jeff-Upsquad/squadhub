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

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(dms: List<DmEntity>)

    @Query("DELETE FROM dms WHERE id NOT IN (:keep)")
    suspend fun deleteNotIn(keep: List<String>)

    @Query("DELETE FROM dms")
    suspend fun clear()
}
