package com.squadhub.chat.ui.chat

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.squadhub.chat.data.local.dao.DmDao
import com.squadhub.chat.data.local.dao.GroupDao
import com.squadhub.chat.data.model.ChatConversationType
import com.squadhub.chat.data.model.ChatMessage
import com.squadhub.chat.data.remote.AuthTokenStore
import com.squadhub.chat.data.repo.MessageRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val repository: MessageRepository,
    private val tokenStore: AuthTokenStore,
    groupDao: GroupDao,
    dmDao: DmDao,
    savedState: SavedStateHandle,
) : ViewModel() {

    private val conversationType: ChatConversationType =
        when (savedState.get<String>("type")) {
            "dm" -> ChatConversationType.DM
            else -> ChatConversationType.GROUP
        }
    private val conversationId: String = checkNotNull(savedState.get<String>("id"))

    private val conversation = MessageRepository.Conversation(conversationType, conversationId)

    val currentUserId: String? = tokenStore.currentUserId
    val isGroup: Boolean = conversationType == ChatConversationType.GROUP

    val messages: StateFlow<List<ChatMessage>> = repository.observeMessages(conversation)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000L), emptyList())

    /**
     * Display title for the TopAppBar. For groups this is the group name; for
     * DMs it's the other user's display_name. Falls back to "Chat" during the
     * brief window before the local row is cached.
     */
    val title: StateFlow<String> = when (conversationType) {
        ChatConversationType.GROUP -> groupDao.observeById(conversationId)
            .map { it?.name ?: "Chat" }
        ChatConversationType.DM -> dmDao.observeById(conversationId)
            .map { it?.otherUserDisplayName ?: "Chat" }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000L), "Chat")

    val avatarUrl: StateFlow<String?> = when (conversationType) {
        ChatConversationType.GROUP -> groupDao.observeById(conversationId)
            .map { it?.avatarUrl }
        ChatConversationType.DM -> dmDao.observeById(conversationId)
            .map { it?.otherUserAvatarUrl }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000L), null)

    data class UiState(
        val loading: Boolean = false,
        val loadingMore: Boolean = false,
        val hasMore: Boolean = true,
        val error: String? = null,
        val sending: Boolean = false,
        val draft: String = "",
    )

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    private var lastMarkedReadId: String? = null

    init {
        loadInitial()
    }

    fun onDraftChange(value: String) = _ui.update { it.copy(draft = value, error = null) }

    fun loadInitial() {
        viewModelScope.launch {
            _ui.update { it.copy(loading = true, error = null) }
            val res = repository.loadInitial(conversation)
            _ui.update {
                it.copy(
                    loading = false,
                    error = res.exceptionOrNull()?.message,
                    hasMore = res.getOrDefault(false),
                )
            }
        }
    }

    fun loadMore() {
        val current = _ui.value
        if (current.loadingMore || !current.hasMore) return
        _ui.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            val res = repository.loadMore(conversation)
            _ui.update {
                it.copy(
                    loadingMore = false,
                    hasMore = res.getOrDefault(false),
                    error = res.exceptionOrNull()?.message ?: it.error,
                )
            }
        }
    }

    fun send() {
        val text = _ui.value.draft.trim()
        if (text.isEmpty() || _ui.value.sending) return
        _ui.update { it.copy(sending = true, draft = "", error = null) }
        viewModelScope.launch {
            val res = repository.send(conversation, text)
            _ui.update {
                it.copy(
                    sending = false,
                    error = res.exceptionOrNull()?.message,
                )
            }
        }
    }

    /**
     * Mark everything up to the newest-known message as read. Idempotent:
     * skips the network call when the target id hasn't changed.
     */
    fun markReadIfVisibleTop(newestMessageId: String?) {
        val id = newestMessageId ?: return
        if (id == lastMarkedReadId || id.startsWith("temp:")) return
        lastMarkedReadId = id
        viewModelScope.launch {
            repository.markRead(conversation, id)
        }
    }
}
