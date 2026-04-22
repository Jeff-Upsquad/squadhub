package com.squadhub.chat.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/*
 * Matches current WhatsApp (2024-2025) Android design language:
 *  - Top bars are white in light mode, dark navy in dark mode — NOT green.
 *  - Green is reserved for accents: FAB, outgoing bubble, active tab,
 *    unread badge.
 *  - Chat background is cream (#EFEAE2) in light mode.
 *  - Bubble tails draw from primaryContainer for outgoing, surface for
 *    incoming.
 */

private val LightColors = lightColorScheme(
    primary = WaGreen,
    onPrimary = WaSurfaceLight,
    primaryContainer = WaBubbleOutLight,
    onPrimaryContainer = WaOnSurfaceLight,
    secondary = WaGreen,
    onSecondary = WaSurfaceLight,
    tertiary = WaGreenDeep,
    background = WaChatBgLight,
    onBackground = WaOnSurfaceLight,
    surface = WaSurfaceLight,             // top bar, rows, composer
    onSurface = WaOnSurfaceLight,
    surfaceVariant = WaChatBgLight,        // chat area
    onSurfaceVariant = WaMutedLight,       // muted: timestamps, previews
    surfaceContainerHighest = WaComposerBarLight,
    outline = WaOutlineLight,
    outlineVariant = WaOutlineLight,
    error = WaError,
)

private val DarkColors = darkColorScheme(
    primary = WaGreen,
    onPrimary = WaSurfaceLight,
    primaryContainer = WaBubbleOutDark,
    onPrimaryContainer = WaOnSurfaceDark,
    secondary = WaGreen,
    onSecondary = WaSurfaceLight,
    tertiary = WaGreenDeep,
    background = WaChatBgDark,
    onBackground = WaOnSurfaceDark,
    surface = WaSurfaceDark,
    onSurface = WaOnSurfaceDark,
    surfaceVariant = WaChatBgDark,
    onSurfaceVariant = WaMutedDark,
    surfaceContainerHighest = WaComposerBarDark,
    outline = WaOutlineDark,
    outlineVariant = WaOutlineDark,
    error = WaError,
)

@Composable
fun SquadChatTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) DarkColors else LightColors

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colors.surface.toArgb()
            // Light top bar in light mode → dark status bar icons.
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colors,
        typography = AppTypography,
        content = content,
    )
}
