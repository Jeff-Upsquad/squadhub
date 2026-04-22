package com.squadhub.chat

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.squadhub.chat.ui.AppNavigation
import com.squadhub.chat.ui.theme.SquadChatTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    // Deep-link target parsed from the launching / re-delivered Intent.
    // AppNavigation collects this and consumes exactly once.
    private val _pendingChatLink = MutableStateFlow<ChatDeepLink?>(null)
    val pendingChatLink: StateFlow<ChatDeepLink?> = _pendingChatLink.asStateFlow()

    private val requestNotificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* user's choice; we don't need to react here */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        _pendingChatLink.value = parseDeepLink(intent)
        askForNotificationsIfNeeded()

        setContent {
            AppRoot(
                pendingChatLink = pendingChatLink,
                onChatLinkConsumed = { _pendingChatLink.update { null } },
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        parseDeepLink(intent)?.let { link -> _pendingChatLink.value = link }
    }

    private fun askForNotificationsIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun parseDeepLink(intent: Intent?): ChatDeepLink? {
        val data = intent?.data ?: return null
        if (data.scheme != "squadhub-chat") return null
        if (data.host != "chat") return null
        val groupId = data.getQueryParameter("group_id")
        val dmId = data.getQueryParameter("dm")
        return when {
            !groupId.isNullOrBlank() -> ChatDeepLink.Group(groupId)
            !dmId.isNullOrBlank() -> ChatDeepLink.Dm(dmId)
            else -> null
        }
    }
}

/** Describes a chat to open, parsed from a squadhub-chat://chat?group_id|dm=… URI. */
sealed interface ChatDeepLink {
    data class Group(val id: String) : ChatDeepLink
    data class Dm(val id: String) : ChatDeepLink
}

@Composable
private fun AppRoot(
    pendingChatLink: StateFlow<ChatDeepLink?>,
    onChatLinkConsumed: () -> Unit,
) {
    val link by pendingChatLink.collectAsState()
    SquadChatTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            AppNavigation(
                pendingChatLink = link,
                onChatLinkConsumed = onChatLinkConsumed,
            )
        }
    }
}
