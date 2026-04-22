package com.squadhub.chat.di

import android.content.Context
import androidx.room.Room
import com.squadhub.chat.data.local.ChatDatabase
import com.squadhub.chat.data.local.dao.DmDao
import com.squadhub.chat.data.local.dao.GroupDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): ChatDatabase =
        Room.databaseBuilder(context, ChatDatabase::class.java, "squad_chat.db")
            .fallbackToDestructiveMigration()
            .build()

    @Provides
    fun provideGroupDao(db: ChatDatabase): GroupDao = db.groupDao()

    @Provides
    fun provideDmDao(db: ChatDatabase): DmDao = db.dmDao()
}
