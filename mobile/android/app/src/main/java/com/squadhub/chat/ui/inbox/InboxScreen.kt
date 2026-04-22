package com.squadhub.chat.ui.inbox

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import com.squadhub.chat.R
import com.squadhub.chat.data.model.ChatConversationType
import com.squadhub.chat.data.model.ChatDmConversation
import com.squadhub.chat.data.model.ChatGroup
import com.squadhub.chat.data.model.ChatMessage
import com.squadhub.chat.data.model.ChatMessageType
import com.squadhub.chat.ui.common.formatInboxTimestamp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(
    onOpenConversation: (ChatConversationType, String) -> Unit,
    onSignOut: () -> Unit,
    viewModel: InboxViewModel = hiltViewModel(),
) {
    val groups by viewModel.groups.collectAsState()
    val dms by viewModel.dms.collectAsState()
    val ui by viewModel.ui.collectAsState()

    LaunchedEffect(ui.signedOut) {
        if (ui.signedOut) onSignOut()
    }

    var selectedTab by rememberSaveable { mutableIntStateOf(0) }
    val showDmsTab = viewModel.isTeamApp

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        stringResource(R.string.inbox_title),
                        color = MaterialTheme.colorScheme.onPrimary,
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = MaterialTheme.colorScheme.onPrimary,
                    actionIconContentColor = MaterialTheme.colorScheme.onPrimary,
                ),
                actions = {
                    IconButton(onClick = viewModel::refresh, enabled = !ui.refreshing) {
                        if (ui.refreshing) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onPrimary,
                            )
                        } else {
                            Icon(Icons.Filled.Refresh, contentDescription = "Refresh")
                        }
                    }
                    IconButton(onClick = viewModel::signOut) {
                        Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "Sign out")
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (showDmsTab) {
                TabRow(
                    selectedTabIndex = selectedTab,
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ) {
                    Tab(selected = selectedTab == 0, onClick = { selectedTab = 0 }) {
                        Text(
                            stringResource(R.string.inbox_tab_groups),
                            Modifier.padding(12.dp),
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                    Tab(selected = selectedTab == 1, onClick = { selectedTab = 1 }) {
                        Text(
                            stringResource(R.string.inbox_tab_dms),
                            Modifier.padding(12.dp),
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }

            if (ui.error != null) {
                Text(
                    text = ui.error!!,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }

            when {
                !showDmsTab || selectedTab == 0 -> GroupsList(groups, onOpenConversation)
                else -> DmsList(dms, onOpenConversation)
            }
        }
    }
}

@Composable
private fun GroupsList(
    groups: List<ChatGroup>,
    onOpenConversation: (ChatConversationType, String) -> Unit,
) {
    if (groups.isEmpty()) {
        EmptyHint(text = stringResource(R.string.inbox_empty_groups))
        return
    }
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        items(groups, key = { it.id }) { g ->
            ConversationRow(
                title = g.name,
                avatarUrl = g.avatar_url,
                lastMessage = g.last_message,
                groupContext = true,
                timestamp = g.last_message?.created_at ?: g.updated_at,
                unread = g.unread_count ?: 0,
                onClick = { onOpenConversation(ChatConversationType.GROUP, g.id) },
            )
            HorizontalDivider(
                thickness = 0.5.dp,
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(start = 84.dp),
            )
        }
    }
}

@Composable
private fun DmsList(
    dms: List<ChatDmConversation>,
    onOpenConversation: (ChatConversationType, String) -> Unit,
) {
    if (dms.isEmpty()) {
        EmptyHint(text = stringResource(R.string.inbox_empty_dms))
        return
    }
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        items(dms, key = { it.id }) { d ->
            val name = d.other_user?.display_name ?: "Unknown"
            ConversationRow(
                title = name,
                avatarUrl = d.other_user?.avatar_url,
                lastMessage = d.last_message,
                groupContext = false,
                timestamp = d.last_message_at,
                unread = d.unread_count ?: 0,
                onClick = { onOpenConversation(ChatConversationType.DM, d.id) },
            )
            HorizontalDivider(
                thickness = 0.5.dp,
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(start = 84.dp),
            )
        }
    }
}

@Composable
private fun ConversationRow(
    title: String,
    avatarUrl: String?,
    lastMessage: ChatMessage?,
    groupContext: Boolean,
    timestamp: String?,
    unread: Int,
    onClick: () -> Unit,
) {
    val preview = buildPreview(lastMessage, groupContext)
    val ts = formatInboxTimestamp(timestamp)

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Avatar(url = avatarUrl, initials = initials(title))
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (ts.isNotEmpty()) {
                    Spacer(Modifier.width(8.dp))
                    Text(
                        ts,
                        style = MaterialTheme.typography.bodySmall,
                        color = if (unread > 0) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    preview.ifEmpty { " " },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (unread > 0) {
                    Spacer(Modifier.width(8.dp))
                    UnreadBadge(count = unread)
                }
            }
        }
    }
}

@Composable
private fun Avatar(url: String?, initials: String) {
    val size = 52.dp
    Box(
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.15f)),
        contentAlignment = Alignment.Center,
    ) {
        if (!url.isNullOrBlank()) {
            AsyncImage(
                model = url,
                contentDescription = null,
                modifier = Modifier.fillMaxSize().clip(CircleShape),
            )
        }
        // Fallback initials render underneath the AsyncImage; if the image loads
        // successfully it fully covers them.
        Text(
            initials,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

@Composable
private fun UnreadBadge(count: Int) {
    Box(
        modifier = Modifier
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.secondary)
            .padding(horizontal = 8.dp, vertical = 2.dp),
    ) {
        Text(
            if (count > 99) "99+" else count.toString(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSecondary,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun EmptyHint(text: String) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(
            text = text,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyLarge,
        )
    }
}

private fun initials(s: String): String = s.split(" ").filter { it.isNotBlank() }
    .take(2).joinToString("") { it.first().uppercase() }.ifEmpty { "?" }

/**
 * WhatsApp-style one-line preview.
 *  - Text: "<Sender>: <content>" for groups; bare content for DMs; "You: ..." when sender is me.
 *    (We can't reliably identify "me" without the current userId here, so we
 *     just use the sender's display_name; DMs show bare content, which is the
 *     canonical WhatsApp DM behavior since there are only two parties.)
 *  - Non-text: 📷 Photo / 🎥 Video / 📎 <file_name> / 🎙 Voice note.
 */
private fun buildPreview(message: ChatMessage?, groupContext: Boolean): String {
    if (message == null) return ""
    val body = when (message.type) {
        ChatMessageType.TEXT -> message.content.orEmpty()
        ChatMessageType.IMAGE -> "📷 Photo"
        ChatMessageType.VIDEO -> "🎥 Video"
        ChatMessageType.VOICE -> "🎙 Voice note"
        ChatMessageType.DOCUMENT -> "📎 ${message.file_name ?: "Document"}"
        ChatMessageType.SYSTEM -> message.content.orEmpty()
    }
    val senderName = message.sender?.display_name
    return if (groupContext && !senderName.isNullOrBlank() && message.type != ChatMessageType.SYSTEM)
        "$senderName: $body" else body
}
