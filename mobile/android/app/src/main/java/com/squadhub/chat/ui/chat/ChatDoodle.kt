package com.squadhub.chat.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Brush
import androidx.compose.material.icons.outlined.Cake
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.CardGiftcard
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Favorite
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.LocalCafe
import androidx.compose.material.icons.outlined.LocalFlorist
import androidx.compose.material.icons.outlined.MenuBook
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Pets
import androidx.compose.material.icons.outlined.Restaurant
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.Umbrella
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

/**
 * WhatsApp's chat wallpaper: cream base overlaid with tiny line-art
 * doodles (homes, phones, hearts, flowers…) in a warm tan ink.
 *
 * Implementation: tile outlined Material icons with a single tan tint at
 * low alpha. Close in feel to WA's hand-drawn doodle, no PNG asset,
 * crisp at any density.
 */
@Composable
fun ChatDoodleBackground(
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val baseColor = MaterialTheme.colorScheme.background

    // 20 outlined glyphs — enough variety that the grid doesn't repeat
    // visibly at a phone-sized viewport.
    val painters: List<Painter> = listOf(
        rememberVectorPainter(Icons.Outlined.Home),
        rememberVectorPainter(Icons.Outlined.Call),
        rememberVectorPainter(Icons.Outlined.Email),
        rememberVectorPainter(Icons.Outlined.Star),
        rememberVectorPainter(Icons.Outlined.Favorite),
        rememberVectorPainter(Icons.Outlined.LocalFlorist),
        rememberVectorPainter(Icons.Outlined.CardGiftcard),
        rememberVectorPainter(Icons.Outlined.MusicNote),
        rememberVectorPainter(Icons.Outlined.LocalCafe),
        rememberVectorPainter(Icons.Outlined.Cake),
        rememberVectorPainter(Icons.Outlined.Lightbulb),
        rememberVectorPainter(Icons.Outlined.Cloud),
        rememberVectorPainter(Icons.Outlined.Schedule),
        rememberVectorPainter(Icons.Outlined.CameraAlt),
        rememberVectorPainter(Icons.Outlined.DirectionsCar),
        rememberVectorPainter(Icons.Outlined.Brush),
        rememberVectorPainter(Icons.Outlined.MenuBook),
        rememberVectorPainter(Icons.Outlined.Restaurant),
        rememberVectorPainter(Icons.Outlined.Umbrella),
        rememberVectorPainter(Icons.Outlined.Pets),
    )

    // Warm doodle ink — a muted tan that sits right on cream without
    // competing with message bubbles.
    val inkTint = Color(0xFF9E927E)
    val tint = remember(inkTint) { ColorFilter.tint(inkTint) }
    val iconAlpha = 0.14f

    val tileDp = 72.dp   // spacing between glyphs
    val iconDp = 26.dp   // glyph size

    val density = LocalDensity.current
    val tilePx = with(density) { tileDp.toPx() }
    val iconPx = with(density) { iconDp.toPx() }
    val iconSize = Size(iconPx, iconPx)

    Box(
        modifier = modifier
            .background(baseColor)
            .drawBehind {
                val cols = (size.width / tilePx).toInt() + 2
                val rows = (size.height / tilePx).toInt() + 2
                val n = painters.size
                for (row in 0 until rows) {
                    // Alternate rows shift by half a tile — the tried-and-true
                    // way to break a visible grid seam.
                    val rowOff = if (row % 2 == 0) 0f else tilePx / 2f
                    for (col in 0 until cols) {
                        // Stable hash drives glyph choice + per-cell jitter
                        // so the layout stays consistent across recompositions
                        // (no flicker) but looks irregular.
                        val hash = (row * 31 + col * 17 + row * col * 7) and 0x7FFFFFFF
                        val painter = painters[hash % n]
                        val jitterX = ((hash shr 3) % 20 - 10).toFloat() * tilePx / 100f
                        val jitterY = ((hash shr 7) % 20 - 10).toFloat() * tilePx / 100f
                        val x = col * tilePx - tilePx + rowOff + jitterX
                        val y = row * tilePx - tilePx / 2f + jitterY
                        translate(left = x, top = y) {
                            with(painter) {
                                draw(size = iconSize, alpha = iconAlpha, colorFilter = tint)
                            }
                        }
                    }
                }
            },
    ) {
        content()
    }
}
