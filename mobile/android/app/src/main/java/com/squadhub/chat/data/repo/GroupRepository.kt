package com.squadhub.chat.data.repo

import com.squadhub.chat.data.local.dao.GroupDao
import com.squadhub.chat.data.local.entities.GroupEntity
import com.squadhub.chat.data.model.ChatGroup
import com.squadhub.chat.data.remote.ChatApi
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Offline-first: UI observes the local DAO; a refresh() call hits the server
 * and rewrites the cached rows. UI gets the fresh list via Flow automatically.
 */
@Singleton
class GroupRepository @Inject constructor(
    private val api: ChatApi,
    private val dao: GroupDao,
) {
    fun observeGroups(): Flow<List<ChatGroup>> =
        dao.observeActive().map { rows -> rows.map { it.toModel() } }

    suspend fun refresh(): Result<Unit> = runCatching {
        val env = api.listGroups()
        val groups = env.data ?: throw IllegalStateException(env.error ?: "Failed to list groups")
        dao.upsertAll(groups.map { GroupEntity.fromModel(it) })
        dao.deleteNotIn(groups.map { it.id })
    }
}
