package com.squadhub.chat.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.squadhub.chat.data.model.ChatMessage
import com.squadhub.chat.data.model.ChatMessageLocalState
import com.squadhub.chat.data.model.ChatMessageType
import com.squadhub.chat.ui.common.formatMessageTime

/*
 * WhatsApp bubble:
 *  - Rounded rectangle (~8 dp radius) with a small triangular "tail" pointing
 *    up-right on outgoing and up-left on incoming messages.
 *  - Outgoing: light green #D9FDD3 (dark: #005C4B).
 *  - Incoming: white (dark: #1F2C34).
 *  - Timestamp + optional double-check ticks sit at the bottom-right of the
 *    bubble on outgoing, bottom of the content on incoming.
 */
@Composable
fun MessageBubble(
    message: ChatMessage,
    fromMe: Boolean,
    showSenderName: Boolean,
) {
    val bubbleColor = if (fromMe)
        MaterialTheme.colorScheme.primaryContainer
    else
        MaterialTheme.colorScheme.surface
    val textColor = if (fromMe)
        MaterialTheme.colorScheme.onPrimaryContainer
    else
        MaterialTheme.colorScheme.onSurface

    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 1.dp),
        horizontalArrangement = if (fromMe) Arrangement.End else Arrangement.Start,
    ) {
        // The tail extends 6dp past the bubble edge, so we wrap the bubble in a
        // container that reserves that space on the matching side.
        val tailSide = if (fromMe) TailSide.RIGHT else TailSide.LEFT
        BubbleWithTail(
            bubbleColor = bubbleColor,
            tailSide = tailSide,
            modifier = Modifier.widthIn(max = 320.dp),
        ) {
            Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)) {
                if (showSenderName && !fromMe) {
                    Text(
                        text = message.sender?.display_name ?: "Unknown",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = senderNameColor(message.sender?.id),
                    )
                    Spacer(Modifier.padding(vertical = 1.dp))
                }

                BubbleContent(message, textColor)

                Row(
                    modifier = Modifier.padding(top = 2.dp).align(Alignment.End),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = formatMessageTime(message.created_at),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (fromMe) {
                        Spacer(Modifier.padding(horizontal = 2.dp))
                        StatusTicks(message.local_state)
                    }
                }
            }
        }
    }
}

@Composable
private fun BubbleContent(message: ChatMessage, textColor: Color) {
    when (message.type) {
        ChatMessageType.TEXT -> Text(
            text = message.content.orEmpty(),
            style = MaterialTheme.typography.bodyLarge,
            color = textColor,
        )
        ChatMessageType.SYSTEM -> Text(
            text = message.content.orEmpty(),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        ChatMessageType.IMAGE -> Text("📷 Photo", style = MaterialTheme.typography.bodyLarge, color = textColor)
        ChatMessageType.VIDEO -> Text("🎥 Video", style = MaterialTheme.typography.bodyLarge, color = textColor)
        ChatMessageType.VOICE -> Text("🎙 Voice message", style = MaterialTheme.typography.bodyLarge, color = textColor)
        ChatMessageType.DOCUMENT -> Text(
            "📎 ${message.file_name ?: "Document"}",
            style = MaterialTheme.typography.bodyLarge,
            color = textColor,
        )
    }
}

@Composable
private fun StatusTicks(state: ChatMessageLocalState?) {
    // Phase 2: we only know "pending" vs "server-ack'd". Read receipts
    // are Phase 3 (needs the /chat/receipts delivered/read rollup).
    val glyph = when (state) {
        ChatMessageLocalState.SENDING, ChatMessageLocalState.QUEUED -> "🕓"
        ChatMessageLocalState.FAILED -> "⚠️"
        else -> "✓"
    }
    Text(
        text = glyph,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
fun DayHeader(label: String) {
    Box(
        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(14.dp))
                .background(Color(0xFFE1F3FB)),  // WA uses a pale blue for date pills
        ) {
            Text(
                text = label.uppercase(),
                style = MaterialTheme.typography.labelMedium,
                color = Color(0xFF54656F),
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
            )
        }
    }
}

// --- Bubble + tail -----------------------------------------------------------

private enum class TailSide { LEFT, RIGHT }

/**
 * Renders a rectangle bubble of the given color, with a small triangular tail
 * drawn in the top corner on the indicated side. The tail is painted as part
 * of the same drawBehind, so the bubble content doesn't shift.
 */
@Composable
private fun BubbleWithTail(
    bubbleColor: Color,
    tailSide: TailSide,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val cornerRadius = 10.dp
    val tailSize = 8.dp
    val shape = when (tailSide) {
        TailSide.LEFT -> RoundedCornerShape(
            topStart = 0.dp, topEnd = cornerRadius, bottomEnd = cornerRadius, bottomStart = cornerRadius,
        )
        TailSide.RIGHT -> RoundedCornerShape(
            topStart = cornerRadius, topEnd = 0.dp, bottomEnd = cornerRadius, bottomStart = cornerRadius,
        )
    }

    val density = androidx.compose.ui.platform.LocalDensity.current
    val tailPx = with(density) { tailSize.toPx() }

    Box(
        modifier = modifier
            .drawBehind {
                val path = Path().apply {
                    when (tailSide) {
                        TailSide.LEFT -> {
                            moveTo(0f, 0f)
                            lineTo(-tailPx, 0f)
                            lineTo(0f, tailPx)
                            close()
                        }
                        TailSide.RIGHT -> {
                            moveTo(size.width, 0f)
                            lineTo(size.width + tailPx, 0f)
                            lineTo(size.width, tailPx)
                            close()
                        }
                    }
                }
                drawPath(path = path, color = bubbleColor)
            }
            .clip(shape)
            .background(bubbleColor),
    ) {
        content()
    }
}

/**
 * Give each sender in a group a stable color for their name label (WhatsApp
 * does the same; makes long group threads readable at a glance).
 */
@Composable
private fun senderNameColor(userId: String?): Color {
    val palette = senderPalette
    val idx = (userId?.hashCode()?.let { Math.floorMod(it, palette.size) }) ?: 0
    return palette[idx]
}

private val senderPalette = listOf(
    Color(0xFFE17076),
    Color(0xFF7BC862),
    Color(0xFF65AADD),
    Color(0xFFA695E7),
    Color(0xFFEE7AAE),
    Color(0xFFFAA774),
    Color(0xFF6EC9CB),
)

