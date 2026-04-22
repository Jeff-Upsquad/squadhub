package com.squadhub.chat.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * WhatsApp's chat wallpaper: cream base with tiny colorful doodle glyphs
 * spread across it at very low opacity. This composable approximates it
 * using a tiled grid of emoji text glyphs — fast, no PNG asset, close
 * enough at a glance.
 */
@Composable
fun ChatDoodleBackground(
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val baseColor = MaterialTheme.colorScheme.background
    val density = LocalDensity.current
    val textMeasurer = rememberTextMeasurer()

    // Themed set of glyphs — homes, food, nature, travel — mirrors the
    // variety in WhatsApp's doodle.
    val glyphs = remember {
        listOf(
            "🏠", "📞", "✉️", "⭐", "🌸", "🎁", "🎵", "🍕",
            "🚗", "🎨", "📚", "☕", "🎲", "🌙", "🌊", "🍎",
            "⚡", "🎯", "🦋", "🌵", "🔔", "🧩", "🎂", "🌈",
        )
    }

    val tileDp = 88.dp
    val glyphSp = 22.sp
    val glyphAlpha = 0.10f

    val tilePx = with(density) { tileDp.toPx() }
    val glyphPx = with(density) { glyphSp.toPx() }

    // Pre-measure each glyph once so draw phase is cheap.
    val measured = remember(glyphs, glyphPx) {
        glyphs.map { g ->
            textMeasurer.measure(
                AnnotatedString(g),
                style = TextStyle(fontSize = glyphSp),
            )
        }
    }

    Box(
        modifier = modifier
            .background(baseColor)
            .drawBehind {
                drawDoodles(
                    tilePx = tilePx,
                    measured = measured,
                    alpha = glyphAlpha,
                )
            },
    ) {
        content()
    }
}

private fun DrawScope.drawDoodles(
    tilePx: Float,
    measured: List<androidx.compose.ui.text.TextLayoutResult>,
    alpha: Float,
) {
    if (measured.isEmpty()) return
    val cols = (size.width / tilePx).toInt() + 2
    val rows = (size.height / tilePx).toInt() + 2
    for (row in 0 until rows) {
        val rowOffset = if (row % 2 == 0) 0f else tilePx / 2f
        for (col in 0 until cols) {
            // Deterministic shuffle so the pattern looks irregular, not
            // like a checkerboard. Simple hash on (row, col).
            val hash = (row * 31 + col * 17 + row * col * 7) and 0x7FFFFFFF
            val idx = hash % measured.size
            val layout = measured[idx]
            val x = col * tilePx - tilePx + rowOffset
            val y = row * tilePx - tilePx / 2f
            // Small per-cell jitter — +/- a quarter tile — so the grid isn't
            // obvious. Derived from the same hash so it's stable across
            // redraws (no flicker on recomposition).
            val jitterX = ((hash shr 3) % 20 - 10).toFloat() * tilePx / 100f
            val jitterY = ((hash shr 7) % 20 - 10).toFloat() * tilePx / 100f
            drawText(
                textLayoutResult = layout,
                topLeft = Offset(x + jitterX, y + jitterY),
                alpha = alpha,
                color = Color.Unspecified,
            )
        }
    }
}
