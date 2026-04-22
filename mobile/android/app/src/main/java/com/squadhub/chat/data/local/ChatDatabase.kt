package com.squadhub.chat.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import com.squadhub.chat.data.local.dao.DmDao
import com.squadhub.chat.data.local.dao.GroupDao
import com.squadhub.chat.data.local.dao.MessageDao
import com.squadhub.chat.data.local.entities.DmEntity
import com.squadhub.chat.data.local.entities.GroupEntity
import com.squadhub.chat.data.local.entities.MessageEntity

@Database(
    entities = [GroupEntity::class, DmEntity::class, MessageEntity::class],
    version = 2,
    exportSchema = true,
)
abstract class ChatDatabase : RoomDatabase() {
    abstract fun groupDao(): GroupDao
    abstract fun dmDao(): DmDao
    abstract fun messageDao(): MessageDao
}
