package com.squadhub.chat.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.squadhub.chat.ChatDeepLink
import com.squadhub.chat.data.model.ChatConversationType
import com.squadhub.chat.ui.auth.LoginScreen
import com.squadhub.chat.ui.bootstrap.BootstrapViewModel
import com.squadhub.chat.ui.chat.ChatScreen
import com.squadhub.chat.ui.inbox.InboxScreen
import com.squadhub.chat.ui.update.UpdateRequiredScreen

object Routes {
    const val LOGIN = "login"
    const val INBOX = "inbox"
    const val UPDATE = "update"
    // chat/{type}/{id} — type = "group" | "dm", id = conversation id
    const val CHAT = "chat/{type}/{id}"
    fun chat(type: ChatConversationType, id: String) = "chat/${type.wireValue}/$id"
}

@Composable
fun AppNavigation(
    pendingChatLink: ChatDeepLink? = null,
    onChatLinkConsumed: () -> Unit = {},
    navController: NavHostController = rememberNavController(),
    bootstrap: BootstrapViewModel = hiltViewModel(),
) {
    val state by bootstrap.state.collectAsState()

    // Deep link from a tapped FCM notification: once we're signed-in, route
    // to the right chat and clear the link so rotation doesn't re-trigger.
    LaunchedEffect(pendingChatLink, state) {
        val link = pendingChatLink ?: return@LaunchedEffect
        if (state is BootstrapViewModel.State.SignedIn) {
            val route = when (link) {
                is ChatDeepLink.Group -> Routes.chat(ChatConversationType.GROUP, link.id)
                is ChatDeepLink.Dm -> Routes.chat(ChatConversationType.DM, link.id)
            }
            navController.navigate(route) { launchSingleTop = true }
            onChatLinkConsumed()
        }
    }

    // Auth/update gate — only resets the back stack when state flips between
    // sign-in/out/update-required. Navigation inside the signed-in area (Inbox
    // → Chat → back) is left alone.
    LaunchedEffect(state) {
        val targetRoot = when (state) {
            is BootstrapViewModel.State.NeedsUpdate -> Routes.UPDATE
            is BootstrapViewModel.State.SignedOut -> Routes.LOGIN
            is BootstrapViewModel.State.SignedIn -> Routes.INBOX
            BootstrapViewModel.State.Loading -> null
        } ?: return@LaunchedEffect

        val current = navController.currentBackStackEntry?.destination?.route
        if (current != targetRoot) {
            navController.navigate(targetRoot) {
                popUpTo(navController.graph.startDestinationId) { inclusive = true }
                launchSingleTop = true
            }
        }
    }

    NavHost(
        navController = navController,
        startDestination = Routes.LOGIN,
    ) {
        composable(Routes.LOGIN) {
            LoginScreen(onSignedIn = { bootstrap.refresh() })
        }
        composable(Routes.INBOX) {
            InboxScreen(
                onOpenConversation = { type, id ->
                    navController.navigate(Routes.chat(type, id))
                },
                onSignOut = { bootstrap.refresh() },
            )
        }
        composable(
            route = Routes.CHAT,
            arguments = listOf(
                navArgument("type") { type = NavType.StringType },
                navArgument("id") { type = NavType.StringType },
            ),
        ) {
            // Title + avatar hydrate from ChatViewModel via GroupDao/DmDao flows.
            ChatScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.UPDATE) {
            UpdateRequiredScreen()
        }
    }
}
