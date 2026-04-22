package com.squadhub.chat.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.squadhub.chat.data.model.ChatMessage
import com.squadhub.chat.ui.common.formatDayHeader
import java.time.LocalDate
import java.time.ZoneId

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    title: String,
    onBack: () -> Unit,
    viewModel: ChatViewModel = hiltViewModel(),
) {
    val messages by viewModel.messages.collectAsState()
    val ui by viewModel.ui.collectAsState()

    val listState = rememberLazyListState()

    // Mark-as-read debounced: fire whenever the newest message id changes
    // (and the user is within the top-of-reverse-layout, i.e. looking at recent).
    LaunchedEffect(messages.lastOrNull()?.id, listState.firstVisibleItemIndex) {
        val newest = messages.lastOrNull()?.id
        if (newest != null && listState.firstVisibleItemIndex <= 1) {
            viewModel.markReadIfVisibleTop(newest)
        }
    }

    // Pagination: when the user has scrolled near the earliest cached message,
    // fetch another page. Reverse layout means "earliest = last item".
    val shouldLoadMore by remember {
        derivedStateOf {
            val layout = listState.layoutInfo
            val total = layout.totalItemsCount
            val lastVisible = layout.visibleItemsInfo.lastOrNull()?.index ?: 0
            total > 0 && lastVisible >= total - 3
        }
    }
    LaunchedEffect(shouldLoadMore, ui.hasMore) {
        if (shouldLoadMore && ui.hasMore && !ui.loadingMore) viewModel.loadMore()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back",
                            tint = MaterialTheme.colorScheme.onPrimary,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = MaterialTheme.colorScheme.onPrimary,
                ),
            )
        },
        containerColor = MaterialTheme.colorScheme.surfaceVariant,
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (ui.error != null) {
                Text(
                    text = ui.error!!,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
            Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                if (ui.loading && messages.isEmpty()) {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center),
                        color = MaterialTheme.colorScheme.primary,
                    )
                } else if (messages.isEmpty()) {
                    Text(
                        text = "Say something to get the conversation started.",
                        modifier = Modifier.align(Alignment.Center).padding(24.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                } else {
                    MessageList(
                        messages = messages,
                        isGroup = viewModel.isGroup,
                        currentUserId = viewModel.currentUserId,
                        listState = listState,
                    )
                }
                if (ui.loadingMore) {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.TopCenter).padding(8.dp).size(20.dp),
                        strokeWidth = 2.dp,
                    )
                }
            }
            Composer(
                draft = ui.draft,
                sending = ui.sending,
                onChange = viewModel::onDraftChange,
                onSend = viewModel::send,
            )
        }
    }
}

@Composable
private fun MessageList(
    messages: List<ChatMessage>,
    isGroup: Boolean,
    currentUserId: String?,
    listState: androidx.compose.foundation.lazy.LazyListState,
) {
    // The DAO returns messages chronologically ascending. Reverse-layout draws
    // them bottom-up, so we iterate in reverse and emit items as we go.
    val reversed = remember(messages) { messages.reversed() }

    LazyColumn(
        state = listState,
        reverseLayout = true,
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Top,
    ) {
        reversed.forEachIndexed { idx, msg ->
            val nextNewer = reversed.getOrNull(idx - 1)
            val previousOlder = reversed.getOrNull(idx + 1)
            val fromMe = msg.sender_id != null && msg.sender_id == currentUserId
            val showName = isGroup && !fromMe && !samesender(msg, nextNewer)

            item(key = msg.id) {
                MessageBubble(message = msg, fromMe = fromMe, showSenderName = showName)
            }
            // Day header sits between the older message and the newer one.
            if (!sameDay(previousOlder, msg)) {
                item(key = "day:${dayKey(msg.created_at)}") {
                    com.squadhub.chat.ui.chat.DayHeader(
                        label = formatDayHeader(msg.created_at),
                    )
                }
            }
        }
    }
}

private fun samesender(a: ChatMessage, b: ChatMessage?): Boolean =
    b != null && a.sender_id != null && a.sender_id == b.sender_id

private fun sameDay(a: ChatMessage?, b: ChatMessage?): Boolean {
    if (a == null || b == null) return false
    return dayKey(a.created_at) == dayKey(b.created_at)
}

private fun dayKey(iso: String): String = runCatching {
    LocalDate.ofInstant(java.time.Instant.parse(iso), ZoneId.systemDefault()).toString()
}.getOrDefault(iso)

@Composable
private fun Composer(
    draft: String,
    sending: Boolean,
    onChange: (String) -> Unit,
    onSend: () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 2.dp,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
        ) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .background(MaterialTheme.colorScheme.surfaceVariant, CircleShape)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                BasicTextField(
                    value = draft,
                    onValueChange = onChange,
                    textStyle = TextStyle(color = MaterialTheme.colorScheme.onSurface),
                    modifier = Modifier.fillMaxWidth(),
                    decorationBox = { inner ->
                        if (draft.isEmpty()) {
                            Text(
                                "Message",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        inner()
                    },
                )
            }
            Spacer(Modifier.width(8.dp))
            IconButton(
                onClick = onSend,
                enabled = draft.isNotBlank() && !sending,
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(
                        if (draft.isNotBlank() && !sending)
                            MaterialTheme.colorScheme.primary
                        else
                            MaterialTheme.colorScheme.primary.copy(alpha = 0.4f),
                    ),
            ) {
                if (sending) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                } else {
                    Icon(
                        Icons.AutoMirrored.Filled.Send,
                        contentDescription = "Send",
                        tint = MaterialTheme.colorScheme.onPrimary,
                    )
                }
            }
        }
    }
}
