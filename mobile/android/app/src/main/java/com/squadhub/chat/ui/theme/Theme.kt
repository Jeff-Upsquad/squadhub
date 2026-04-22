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

// Classic WhatsApp green. Dynamic color (Material You) is off on purpose —
// brand consistency across devices trumps per-device tint personalization.
private val LightColors = lightColorScheme(
    primary = WaGreen,
    onPrimary = SurfaceLight,
    primaryContainer = WaLightGreenBubble,
    onPrimaryContainer = OnSurfaceLight,
    secondary = WaTeal,
    onSecondary = SurfaceLight,
    surface = SurfaceLight,
    onSurface = OnSurfaceLight,
    surfaceVariant = WaChatBackground,
    onSurfaceVariant = OnSurfaceMuted,
    outline = OutlineLight,
    error = ErrorColor,
)

private val DarkColors = darkColorScheme(
    primary = WaGreenDark,
    onPrimary = OnSurfaceDark,
    primaryContainer = OutgoingBubbleDark,
    onPrimaryContainer = OnSurfaceDark,
    secondary = WaTeal,
    onSecondary = OnSurfaceDark,
    surface = SurfaceDarkBg,
    onSurface = OnSurfaceDark,
    surfaceVariant = WaChatBackgroundDark,
    onSurfaceVariant = OnSurfaceMutedDark,
    outline = OutlineDark,
    error = ErrorColor,
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
            // Status bar uses dark green in light mode (classic WhatsApp feel) and
            // the app's surface color in dark mode.
            val statusBarColor = if (darkTheme) colors.surface else WaGreenDark
            window.statusBarColor = statusBarColor.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = false
        }
    }

    MaterialTheme(
        colorScheme = colors,
        typography = AppTypography,
        content = content,
    )
}
