package com.squadhub.chat.ui.inbox

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.squadhub.chat.R
import com.squadhub.chat.data.model.ChatDmConversation
import com.squadhub.chat.data.model.ChatGroup

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(
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
                title = { Text(stringResource(R.string.inbox_title)) },
                actions = {
                    IconButton(onClick = viewModel::refresh, enabled = !ui.refreshing) {
                        if (ui.refreshing) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                strokeWidth = 2.dp,
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
                TabRow(selectedTabIndex = selectedTab) {
                    Tab(selected = selectedTab == 0, onClick = { selectedTab = 0 }) {
                        Text(stringResource(R.string.inbox_tab_groups), Modifier.padding(12.dp))
                    }
                    Tab(selected = selectedTab == 1, onClick = { selectedTab = 1 }) {
                        Text(stringResource(R.string.inbox_tab_dms), Modifier.padding(12.dp))
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
                !showDmsTab || selectedTab == 0 -> GroupsList(groups)
                else -> DmsList(dms)
            }
        }
    }
}

@Composable
private fun GroupsList(groups: List<ChatGroup>) {
    if (groups.isEmpty()) {
        EmptyHint(text = stringResource(R.string.inbox_empty_groups))
        return
    }
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        items(groups, key = { it.id }) { g ->
            RowItem(
                title = g.name,
                subtitle = g.description ?: "${g.member_count ?: 0} members",
                unread = g.unread_count ?: 0,
                initials = initials(g.name),
            )
            HorizontalDivider(thickness = 0.5.dp)
        }
    }
}

@Composable
private fun DmsList(dms: List<ChatDmConversation>) {
    if (dms.isEmpty()) {
        EmptyHint(text = stringResource(R.string.inbox_empty_dms))
        return
    }
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        items(dms, key = { it.id }) { d ->
            val name = d.other_user?.display_name ?: "Unknown"
            RowItem(
                title = name,
                subtitle = d.last_message_at ?: "",
                unread = d.unread_count ?: 0,
                initials = initials(name),
            )
            HorizontalDivider(thickness = 0.5.dp)
        }
    }
}

@Composable
private fun RowItem(title: String, subtitle: String, unread: Int, initials: String) {
    Surface {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
            Row(
                title = title,
                subtitle = subtitle,
                unread = unread,
                initials = initials,
            )
        }
    }
}

@Composable
private fun Row(title: String, subtitle: String, unread: Int, initials: String) {
    androidx.compose.foundation.layout.Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(CircleShape)
                .let { m -> m.then(Modifier.height(40.dp)) },
            contentAlignment = Alignment.Center,
        ) {
            Surface(
                modifier = Modifier.fillMaxSize(),
                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.15f),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        initials,
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
        Column(modifier = androidx.compose.ui.Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1)
            if (subtitle.isNotEmpty()) {
                Spacer(Modifier.height(2.dp))
                Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = Color.Gray, maxLines = 1)
            }
        }
        if (unread > 0) {
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primary,
            ) {
                Text(
                    unread.toString(),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                )
            }
        }
    }
}

@Composable
private fun EmptyHint(text: String) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text = text, color = Color.Gray, style = MaterialTheme.typography.bodyLarge)
    }
}

private fun initials(s: String): String = s.split(" ").filter { it.isNotBlank() }
    .take(2).joinToString("") { it.first().uppercase() }.ifEmpty { "?" }
