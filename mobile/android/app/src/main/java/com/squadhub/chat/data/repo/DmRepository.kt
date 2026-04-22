package com.squadhub.chat.data.repo

import com.squadhub.chat.data.local.dao.DmDao
import com.squadhub.chat.data.local.entities.DmEntity
import com.squadhub.chat.data.model.ChatDmConversation
import com.squadhub.chat.data.remote.ChatApi
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

@Singleton
class DmRepository @Inject constructor(
    private val api: ChatApi,
    private val dao: DmDao,
) {
    fun observeDms(): Flow<List<ChatDmConversation>> =
        dao.observeAll().map { rows -> rows.map { it.toModel() } }

    suspend fun refresh(): Result<Unit> = runCatching {
        val env = api.listDms()
        val dms = env.data ?: throw IllegalStateException(env.error ?: "Failed to list DMs")
        dao.upsertAll(dms.map { DmEntity.fromModel(it) })
        dao.deleteNotIn(dms.map { it.id })
    }
}
