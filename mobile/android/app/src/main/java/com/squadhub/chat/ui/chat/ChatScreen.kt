package com.squadhub.chat.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.EmojiEmotions
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.EmojiEmotions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
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
import coil.compose.AsyncImage
import com.squadhub.chat.data.model.ChatMessage
import com.squadhub.chat.ui.common.formatDayHeader
import java.time.LocalDate
import java.time.ZoneId

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    onBack: () -> Unit,
    viewModel: ChatViewModel = hiltViewModel(),
) {
    val messages by viewModel.messages.collectAsState()
    val ui by viewModel.ui.collectAsState()
    val title by viewModel.title.collectAsState()
    val avatarUrl by viewModel.avatarUrl.collectAsState()

    val listState = rememberLazyListState()

    // Auto-scroll to the newest message when one arrives and the user is near
    // the bottom already (within 3 items). Matches WhatsApp: if you're reading
    // the latest thread, a new message slides in; if you've scrolled up to read
    // history, we don't yank you back.
    LaunchedEffect(messages.lastOrNull()?.id) {
        val newest = messages.lastOrNull()?.id ?: return@LaunchedEffect
        if (listState.firstVisibleItemIndex <= 3) {
            // scrollToItem(0) is instant — no jarring animation when you open
            // a chat via a push-notification deep link and want to land right
            // on the message that triggered it.
            listState.scrollToItem(0)
        }
    }

    // Separate effect so markRead doesn't depend on scroll position changes
    // unrelated to the newest message arriving.
    LaunchedEffect(messages.lastOrNull()?.id, listState.firstVisibleItemIndex) {
        val newest = messages.lastOrNull()?.id
        if (newest != null && listState.firstVisibleItemIndex <= 1) {
            viewModel.markReadIfVisibleTop(newest)
        }
    }

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
            ChatTopBar(title = title, avatarUrl = avatarUrl, onBack = onBack)
        },
        containerColor = MaterialTheme.colorScheme.background,
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
            ChatDoodleBackground(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            ) {
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatTopBar(title: String, avatarUrl: String?, onBack: () -> Unit) {
    TopAppBar(
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                // Small avatar left of the title, WhatsApp-style.
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.surfaceContainerHighest),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = title.firstOrNull()?.uppercase() ?: "?",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (!avatarUrl.isNullOrBlank()) {
                        AsyncImage(
                            model = avatarUrl,
                            contentDescription = null,
                            modifier = Modifier.fillMaxSize().clip(CircleShape),
                        )
                    }
                }
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = "tap for info",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }
            }
        },
        navigationIcon = {
            IconButton(onClick = onBack) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back",
                    tint = MaterialTheme.colorScheme.onSurface,
                )
            }
        },
        actions = {
            IconButton(onClick = { /* video call TBD */ }) {
                Icon(Icons.Filled.Videocam, contentDescription = "Video call")
            }
            IconButton(onClick = { /* voice call TBD */ }) {
                Icon(Icons.Filled.Call, contentDescription = "Voice call")
            }
            IconButton(onClick = { /* overflow TBD */ }) {
                Icon(Icons.Filled.MoreVert, contentDescription = "More")
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.surface,
            titleContentColor = MaterialTheme.colorScheme.onSurface,
            actionIconContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            navigationIconContentColor = MaterialTheme.colorScheme.onSurface,
        ),
    )
}

@Composable
private fun MessageList(
    messages: List<ChatMessage>,
    isGroup: Boolean,
    currentUserId: String?,
    listState: androidx.compose.foundation.lazy.LazyListState,
) {
    val reversed = remember(messages) { messages.reversed() }

    LazyColumn(
        state = listState,
        reverseLayout = true,
        modifier = Modifier.fillMaxSize().padding(vertical = 4.dp),
        verticalArrangement = Arrangement.Top,
    ) {
        reversed.forEachIndexed { idx, msg ->
            val nextNewer = reversed.getOrNull(idx - 1)
            val previousOlder = reversed.getOrNull(idx + 1)
            val fromMe = msg.sender_id != null && msg.sender_id == currentUserId
            val showName = isGroup && !fromMe && !sameSender(msg, nextNewer)

            item(key = msg.id) {
                MessageBubble(message = msg, fromMe = fromMe, showSenderName = showName)
            }
            if (!sameDay(previousOlder, msg)) {
                item(key = "day:${dayKey(msg.created_at)}") {
                    DayHeader(label = formatDayHeader(msg.created_at))
                }
            }
        }
    }
}

private fun sameSender(a: ChatMessage, b: ChatMessage?): Boolean =
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
    // Classic WhatsApp composer: rounded input pill on a slightly-tinted
    // background strip, with a round green send button to the right.
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 6.dp, vertical = 6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(24.dp))
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = 4.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { /* emoji TBD */ }, modifier = Modifier.size(40.dp)) {
                    Icon(
                        Icons.Outlined.EmojiEmotions,
                        contentDescription = "Emoji",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Box(modifier = Modifier.weight(1f).padding(horizontal = 4.dp)) {
                    BasicTextField(
                        value = draft,
                        onValueChange = onChange,
                        textStyle = TextStyle(
                            color = MaterialTheme.colorScheme.onSurface,
                            fontSize = androidx.compose.ui.unit.TextUnit(16f, androidx.compose.ui.unit.TextUnitType.Sp),
                        ),
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
                IconButton(onClick = { /* attach TBD */ }, modifier = Modifier.size(40.dp)) {
                    Icon(
                        Icons.Filled.AttachFile,
                        contentDescription = "Attach",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(onClick = { /* camera TBD */ }, modifier = Modifier.size(40.dp)) {
                    Icon(
                        Icons.Outlined.CameraAlt,
                        contentDescription = "Camera",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            // Voice mic when the draft is empty, send arrow when there's text.
            // Matches current WhatsApp: single right-edge action button that
            // swaps role by composer state.
            val hasText = draft.isNotBlank()
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary),
                contentAlignment = Alignment.Center,
            ) {
                if (sending) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(22.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                } else {
                    IconButton(
                        onClick = {
                            if (hasText) onSend() else { /* voice: Phase 4 */ }
                        },
                    ) {
                        Icon(
                            if (hasText) Icons.AutoMirrored.Filled.Send
                            else Icons.Filled.Mic,
                            contentDescription = if (hasText) "Send" else "Record voice",
                            tint = MaterialTheme.colorScheme.onPrimary,
                        )
                    }
                }
            }
        }
    }
}
