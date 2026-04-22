package com.squadhub.chat.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.squadhub.chat.data.model.ChatMessage
import com.squadhub.chat.data.model.ChatMessageLocalState
import com.squadhub.chat.data.model.ChatMessageType
import com.squadhub.chat.ui.common.formatMessageTime

@Composable
fun MessageBubble(
    message: ChatMessage,
    fromMe: Boolean,
    showSenderName: Boolean,
) {
    val bubbleShape = if (fromMe) OutgoingShape else IncomingShape
    val bubbleColor = if (fromMe) MaterialTheme.colorScheme.primaryContainer
                      else MaterialTheme.colorScheme.surface
    val textColor = if (fromMe) MaterialTheme.colorScheme.onPrimaryContainer
                    else MaterialTheme.colorScheme.onSurface

    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp),
        horizontalArrangement = if (fromMe) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 300.dp)
                .clip(bubbleShape)
                .background(bubbleColor)
                .padding(horizontal = 10.dp, vertical = 6.dp),
        ) {
            if (showSenderName && !fromMe) {
                Text(
                    text = message.sender?.display_name ?: "Unknown",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary,
                )
                Spacer(Modifier.padding(vertical = 1.dp))
            }

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
                ChatMessageType.IMAGE -> Text(
                    text = "📷 Photo",
                    style = MaterialTheme.typography.bodyLarge,
                    color = textColor,
                )
                ChatMessageType.VIDEO -> Text(
                    text = "🎥 Video",
                    style = MaterialTheme.typography.bodyLarge,
                    color = textColor,
                )
                ChatMessageType.VOICE -> Text(
                    text = "🎙 Voice note",
                    style = MaterialTheme.typography.bodyLarge,
                    color = textColor,
                )
                ChatMessageType.DOCUMENT -> Text(
                    text = "📎 ${message.file_name ?: "Document"}",
                    style = MaterialTheme.typography.bodyLarge,
                    color = textColor,
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = formatMessageTime(message.created_at),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (fromMe) {
                    Spacer(Modifier.padding(horizontal = 2.dp))
                    Text(
                        text = when (message.local_state) {
                            ChatMessageLocalState.SENDING, ChatMessageLocalState.QUEUED -> "⌛"
                            ChatMessageLocalState.FAILED -> "⚠️"
                            else -> "✓"
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
fun DayHeader(label: String) {
    Box(
        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(12.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .padding(horizontal = 12.dp, vertical = 4.dp),
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// Tail-less rounded rectangles; mirrors WhatsApp's modern (non-tailed) bubble style.
private val OutgoingShape = RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp, bottomStart = 14.dp, bottomEnd = 4.dp)
private val IncomingShape = RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp, bottomStart = 4.dp, bottomEnd = 14.dp)

// Shrink-wrap padding helper for paddingValues.
private fun paddingHV(horizontal: Int, vertical: Int) = PaddingValues(horizontal = horizontal.dp, vertical = vertical.dp)
