package com.squadhub.chat.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.squadhub.chat.ui.auth.LoginScreen
import com.squadhub.chat.ui.bootstrap.BootstrapViewModel
import com.squadhub.chat.ui.inbox.InboxScreen
import com.squadhub.chat.ui.update.UpdateRequiredScreen

object Routes {
    const val LOGIN = "login"
    const val INBOX = "inbox"
    const val UPDATE = "update"
}

@Composable
fun AppNavigation(
    navController: NavHostController = rememberNavController(),
    bootstrap: BootstrapViewModel = hiltViewModel(),
) {
    val state by bootstrap.state.collectAsState()

    // Route decisions are driven by a single source of truth (BootstrapViewModel)
    // so LoginScreen and UpdateRequiredScreen don't each have to reimplement "am I signed in".
    LaunchedEffect(state) {
        when (state) {
            is BootstrapViewModel.State.NeedsUpdate -> navController.navigateSingleTop(Routes.UPDATE)
            is BootstrapViewModel.State.SignedOut -> navController.navigateSingleTop(Routes.LOGIN)
            is BootstrapViewModel.State.SignedIn -> navController.navigateSingleTop(Routes.INBOX)
            BootstrapViewModel.State.Loading -> Unit
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
            InboxScreen(onSignOut = { bootstrap.refresh() })
        }
        composable(Routes.UPDATE) {
            UpdateRequiredScreen()
        }
    }
}

private fun NavHostController.navigateSingleTop(route: String) {
    if (currentBackStackEntry?.destination?.route == route) return
    navigate(route) {
        popUpTo(graph.startDestinationId) { inclusive = true }
        launchSingleTop = true
    }
}
