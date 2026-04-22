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
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
    var menuOpen by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.app_name),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                    actionIconContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
                actions = {
                    IconButton(onClick = { /* search: TBD */ }) {
                        Icon(Icons.Filled.CameraAlt, contentDescription = "Camera")
                    }
                    IconButton(onClick = { /* search: TBD */ }) {
                        Icon(Icons.Filled.Search, contentDescription = "Search")
                    }
                    Box {
                        IconButton(onClick = { menuOpen = true }) {
                            Icon(Icons.Filled.MoreVert, contentDescription = "More")
                        }
                        DropdownMenu(
                            expanded = menuOpen,
                            onDismissRequest = { menuOpen = false },
                        ) {
                            DropdownMenuItem(
                                text = { Text("Refresh") },
                                onClick = { menuOpen = false; viewModel.refresh() },
                            )
                            DropdownMenuItem(
                                text = { Text("Sign out") },
                                leadingIcon = {
                                    Icon(
                                        Icons.AutoMirrored.Filled.Logout,
                                        contentDescription = null,
                                    )
                                },
                                onClick = { menuOpen = false; viewModel.signOut() },
                            )
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { /* new chat: Phase 4 */ },
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
                Icon(Icons.Filled.Edit, contentDescription = "New chat")
            }
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (showDmsTab) {
                ScrollableTabRow(
                    selectedTabIndex = selectedTab,
                    containerColor = MaterialTheme.colorScheme.surface,
                    contentColor = MaterialTheme.colorScheme.primary,
                    edgePadding = 12.dp,
                    indicator = { positions ->
                        TabRowDefaults.SecondaryIndicator(
                            Modifier.tabIndicatorOffset(positions[selectedTab]),
                            color = MaterialTheme.colorScheme.primary,
                            height = 3.dp,
                        )
                    },
                    divider = {},
                ) {
                    InboxTab(
                        label = stringResource(R.string.inbox_tab_groups),
                        selected = selectedTab == 0,
                        onClick = { selectedTab = 0 },
                    )
                    InboxTab(
                        label = stringResource(R.string.inbox_tab_dms),
                        selected = selectedTab == 1,
                        onClick = { selectedTab = 1 },
                    )
                }
            }

            if (ui.refreshing) {
                ThinProgressStrip()
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
private fun InboxTab(label: String, selected: Boolean, onClick: () -> Unit) {
    Tab(
        selected = selected,
        onClick = onClick,
        selectedContentColor = MaterialTheme.colorScheme.primary,
        unselectedContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Text(
            label.uppercase(),
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun ThinProgressStrip() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(2.dp)
            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.4f)),
    )
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
    val hasUnread = unread > 0

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Avatar(url = avatarUrl, initials = initials(title))
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (ts.isNotEmpty()) {
                    Spacer(Modifier.width(8.dp))
                    Text(
                        ts,
                        style = MaterialTheme.typography.labelSmall,
                        color = if (hasUnread) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = if (hasUnread) FontWeight.SemiBold else FontWeight.Normal,
                    )
                }
            }
            Spacer(Modifier.height(3.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    preview.ifEmpty { " " },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (hasUnread) {
                    Spacer(Modifier.width(8.dp))
                    UnreadBadge(count = unread)
                }
            }
        }
    }
}

@Composable
private fun Avatar(url: String?, initials: String) {
    val size = 56.dp
    Box(
        modifier = Modifier
            .size(size)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initials,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (!url.isNullOrBlank()) {
            AsyncImage(
                model = url,
                contentDescription = null,
                modifier = Modifier.fillMaxSize().clip(CircleShape),
            )
        }
    }
}

@Composable
private fun UnreadBadge(count: Int) {
    Box(
        modifier = Modifier
            .size(width = if (count > 9) 28.dp else 20.dp, height = 20.dp)
            .clip(CircleShape)
            .background(WaUnreadBadge),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            if (count > 99) "99+" else count.toString(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onPrimary,
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
            modifier = Modifier.padding(24.dp),
        )
    }
}

private fun initials(s: String): String = s.split(" ").filter { it.isNotBlank() }
    .take(2).joinToString("") { it.first().uppercase() }.ifEmpty { "?" }

// --- WhatsApp-style preview ---
// Text: "<Sender>: <content>" for groups; bare content for DMs.
// Non-text types get the canonical WA emoji label.
private fun buildPreview(message: ChatMessage?, groupContext: Boolean): String {
    if (message == null) return ""
    val body = when (message.type) {
        ChatMessageType.TEXT -> message.content.orEmpty()
        ChatMessageType.IMAGE -> "📷 Photo"
        ChatMessageType.VIDEO -> "🎥 Video"
        ChatMessageType.VOICE -> "🎙 Voice message"
        ChatMessageType.DOCUMENT -> "📎 ${message.file_name ?: "Document"}"
        ChatMessageType.SYSTEM -> message.content.orEmpty()
    }
    val senderName = message.sender?.display_name
    return if (groupContext && !senderName.isNullOrBlank() && message.type != ChatMessageType.SYSTEM)
        "$senderName: $body" else body
}

// The unread pill uses the WA green explicitly (not onPrimary from the scheme,
// which would render white on white in our surface-as-top-bar setup).
private val WaUnreadBadge = androidx.compose.ui.graphics.Color(0xFF25D366)
