package com.squadhub.chat.ui.inbox

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.squadhub.chat.BuildConfig
import com.squadhub.chat.data.model.ChatDmConversation
import com.squadhub.chat.data.model.ChatGroup
import com.squadhub.chat.data.repo.AuthRepository
import com.squadhub.chat.data.repo.DmRepository
import com.squadhub.chat.data.repo.GroupRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@HiltViewModel
class InboxViewModel @Inject constructor(
    private val groupRepository: GroupRepository,
    private val dmRepository: DmRepository,
    private val authRepository: AuthRepository,
) : ViewModel() {

    val isTeamApp: Boolean = BuildConfig.APP_VARIANT == "team"

    val groups: StateFlow<List<ChatGroup>> = groupRepository.observeGroups()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000L), emptyList())

    val dms: StateFlow<List<ChatDmConversation>> = dmRepository.observeDms()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000L), emptyList())

    data class UiState(
        val refreshing: Boolean = false,
        val error: String? = null,
        val signedOut: Boolean = false,
    )

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _ui.update { it.copy(refreshing = true, error = null) }
            val groupsRes = groupRepository.refresh()
            val dmsRes = if (isTeamApp) dmRepository.refresh() else Result.success(Unit)
            val err = groupsRes.exceptionOrNull() ?: dmsRes.exceptionOrNull()
            _ui.update { it.copy(refreshing = false, error = err?.message) }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            authRepository.logout()
            _ui.update { it.copy(signedOut = true) }
        }
    }
}
