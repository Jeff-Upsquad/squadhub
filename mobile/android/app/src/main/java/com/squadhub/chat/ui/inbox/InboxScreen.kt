package com.squadhub.chat.ui.inbox

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.Create
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
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

/*
 * Matches the post-2024 WhatsApp Android redesign:
 *  - Top bar: white, "Squad Chat" title left, camera + overflow right.
 *  - Inline search pill directly below the top bar.
 *  - Content list (Chats | DMs | Settings depending on the bottom-nav tab).
 *  - NavigationBar at the bottom with outlined icons that fill on select.
 *  - FAB only on the Chats tab.
 *
 * Sources consulted:
 *  - https://design.facebook.com/blog/whatsapp-user-interface-update/
 *  - https://en.androidguias.com/new-design-whatsapp-android/
 */

private enum class InboxTab(
    val label: String,
    val outlined: ImageVector,
    val filled: ImageVector,
) {
    CHATS("Chats", Icons.Outlined.Chat, Icons.AutoMirrored.Filled.Chat),
    DMS("DMs", Icons.Outlined.Forum, Icons.Filled.Forum),
    SETTINGS("Settings", Icons.Outlined.Person, Icons.Filled.Person),
}

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

    val isTeam = viewModel.isTeamApp
    // Tab list depends on variant: clients has Chats + Settings only (no DMs).
    val tabs = remember(isTeam) {
        if (isTeam) listOf(InboxTab.CHATS, InboxTab.DMS, InboxTab.SETTINGS)
        else listOf(InboxTab.CHATS, InboxTab.SETTINGS)
    }
    var currentTab by rememberSaveable { mutableStateOf(InboxTab.CHATS) }
    var searchQuery by rememberSaveable { mutableStateOf("") }
    var menuOpen by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.surface,
        topBar = {
            TopAppBar(
                title = {
                    // WhatsApp renders its own wordmark in brand green at the
                    // top-left, not the theme onSurface color.
                    Text(
                        text = stringResource(R.string.app_name),
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                    actionIconContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
                actions = {
                    IconButton(onClick = { /* camera TBD */ }) {
                        Icon(Icons.Outlined.CameraAlt, contentDescription = "Camera")
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
        bottomBar = {
            val totalUnread = groups.sumOf { it.unread_count ?: 0 } +
                if (isTeam) dms.sumOf { it.unread_count ?: 0 } else 0
            val dmsUnread = if (isTeam) dms.sumOf { it.unread_count ?: 0 } else 0
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                tabs.forEach { tab ->
                    val selected = tab == currentTab
                    val badgeCount = when (tab) {
                        InboxTab.CHATS -> groups.sumOf { it.unread_count ?: 0 }
                        InboxTab.DMS -> dmsUnread
                        InboxTab.SETTINGS -> 0
                    }
                    NavigationBarItem(
                        selected = selected,
                        onClick = { currentTab = tab },
                        icon = {
                            if (badgeCount > 0) {
                                BadgedBox(
                                    badge = {
                                        Badge(
                                            containerColor = androidx.compose.ui.graphics.Color(0xFF25D366),
                                            contentColor = androidx.compose.ui.graphics.Color.White,
                                        ) {
                                            Text(
                                                if (badgeCount > 99) "99+" else badgeCount.toString(),
                                                style = MaterialTheme.typography.labelSmall,
                                            )
                                        }
                                    },
                                ) {
                                    Icon(
                                        if (selected) tab.filled else tab.outlined,
                                        contentDescription = tab.label,
                                    )
                                }
                            } else {
                                Icon(
                                    if (selected) tab.filled else tab.outlined,
                                    contentDescription = tab.label,
                                )
                            }
                        },
                        label = {
                            Text(
                                tab.label,
                                fontWeight = if (selected) FontWeight.SemiBold
                                             else FontWeight.Normal,
                            )
                        },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.onPrimaryContainer,
                            selectedTextColor = MaterialTheme.colorScheme.onSurface,
                            indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                            unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        ),
                    )
                }
                // Silence unused-variable warning on clients flavor where
                // totalUnread would otherwise be dropped — future use: app
                // icon badge / push notification counter.
                @Suppress("UNUSED_EXPRESSION") totalUnread
            }
        },
        floatingActionButton = {
            if (currentTab == InboxTab.CHATS) {
                FloatingActionButton(
                    onClick = { /* new chat: Phase 4 */ },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                    shape = RoundedCornerShape(18.dp),
                ) {
                    Icon(Icons.Outlined.Create, contentDescription = "New chat")
                }
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.surface),
        ) {
            if (currentTab != InboxTab.SETTINGS) {
                SearchPill(
                    query = searchQuery,
                    onQueryChange = { searchQuery = it },
                )
                FilterChipsRow(
                    unreadCount = when (currentTab) {
                        InboxTab.CHATS -> groups.count { (it.unread_count ?: 0) > 0 }
                        InboxTab.DMS -> dms.count { (it.unread_count ?: 0) > 0 }
                        else -> 0
                    },
                    groupsCount = groups.size,
                )
            }

            if (ui.refreshing) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(2.dp)
                        .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.4f)),
                )
            }

            if (ui.error != null && currentTab != InboxTab.SETTINGS) {
                Text(
                    text = ui.error!!,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }

            when (currentTab) {
                InboxTab.CHATS -> GroupsList(
                    groups = groups.filterByQuery(searchQuery) { it.name },
                    onOpenConversation = onOpenConversation,
                )
                InboxTab.DMS -> DmsList(
                    dms = dms.filterByQuery(searchQuery) { it.other_user?.display_name.orEmpty() },
                    onOpenConversation = onOpenConversation,
                )
                InboxTab.SETTINGS -> SettingsTab(
                    onSignOut = viewModel::signOut,
                    onRefresh = viewModel::refresh,
                )
            }
        }
    }
}

@Composable
private fun SearchPill(query: String, onQueryChange: (String) -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
        shape = RoundedCornerShape(26.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
        ) {
            Icon(
                Icons.Filled.Search,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(22.dp),
            )
            Spacer(Modifier.width(12.dp))
            androidx.compose.foundation.text.BasicTextField(
                value = query,
                onValueChange = onQueryChange,
                textStyle = androidx.compose.ui.text.TextStyle(
                    color = MaterialTheme.colorScheme.onSurface,
                    fontSize = androidx.compose.ui.unit.TextUnit(16f, androidx.compose.ui.unit.TextUnitType.Sp),
                ),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                decorationBox = { inner ->
                    if (query.isEmpty()) {
                        Text(
                            "Ask Meta AI or Search",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyLarge,
                        )
                    }
                    inner()
                },
            )
        }
    }
}

@Composable
private fun FilterChipsRow(unreadCount: Int, groupsCount: Int) {
    var selected by remember { mutableStateOf("All") }
    val chips = buildList {
        add("All" to null)
        if (unreadCount > 0) add("Unread" to unreadCount)
        add("Favourites" to null)
        if (groupsCount > 0) add("Groups" to groupsCount)
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        chips.forEach { (label, count) ->
            FilterChipPill(
                label = label,
                count = count,
                selected = selected == label,
                onClick = { selected = label },
            )
        }
    }
}

@Composable
private fun FilterChipPill(label: String, count: Int?, selected: Boolean, onClick: () -> Unit) {
    val bg = if (selected) MaterialTheme.colorScheme.primaryContainer
             else MaterialTheme.colorScheme.surface
    val border = if (selected) BorderStroke(1.dp, MaterialTheme.colorScheme.primary)
                 else BorderStroke(1.dp, MaterialTheme.colorScheme.outline)
    val labelColor = if (selected) MaterialTheme.colorScheme.onPrimaryContainer
                     else MaterialTheme.colorScheme.onSurface
    Surface(
        color = bg,
        border = border,
        shape = CircleShape,
        modifier = Modifier.clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                label,
                style = MaterialTheme.typography.labelLarge,
                color = labelColor,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            )
            if (count != null) {
                Spacer(Modifier.width(6.dp))
                Text(
                    count.toString(),
                    style = MaterialTheme.typography.labelLarge,
                    color = labelColor,
                )
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
            .background(MaterialTheme.colorScheme.surfaceContainerHighest),
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
            .background(androidx.compose.ui.graphics.Color(0xFF25D366)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            if (count > 99) "99+" else count.toString(),
            style = MaterialTheme.typography.labelSmall,
            color = androidx.compose.ui.graphics.Color.White,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun SettingsTab(onSignOut: () -> Unit, onRefresh: () -> Unit) {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text(
            "Settings",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.height(24.dp))
        SettingsRow(
            icon = Icons.Filled.Search,
            label = "Refresh",
            onClick = onRefresh,
        )
        SettingsRow(
            icon = Icons.AutoMirrored.Filled.Logout,
            label = "Sign out",
            onClick = onSignOut,
        )
    }
}

@Composable
private fun SettingsRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp),
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.width(16.dp))
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
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

private fun <T> List<T>.filterByQuery(query: String, selector: (T) -> String): List<T> {
    if (query.isBlank()) return this
    val q = query.trim().lowercase()
    return filter { selector(it).lowercase().contains(q) }
}
