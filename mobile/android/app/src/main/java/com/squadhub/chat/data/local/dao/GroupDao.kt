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

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(groups: List<GroupEntity>)

    @Query("DELETE FROM groups WHERE id NOT IN (:keep)")
    suspend fun deleteNotIn(keep: List<String>)

    @Query("DELETE FROM groups")
    suspend fun clear()
}
