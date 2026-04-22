package com.squadhub.chat.push

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import com.squadhub.chat.MainActivity
import com.squadhub.chat.R

/**
 * Builds and posts chat-message notifications. Called from
 * ChatFirebaseMessagingService when the app is in the background.
 *
 * Deep links to `squadhub-chat://chat?group_id=…` or `?dm=…` so tapping
 * the notification opens the right conversation directly. MainActivity
 * parses the Intent URI and forwards to the Navigation graph.
 */
object NotificationHelper {

    fun postChatMessage(
        context: Context,
        title: String,
        body: String,
        groupId: String?,
        dmConversationId: String?,
        messageId: String?,
    ) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            ?: return

        val deepLinkUri = buildDeepLink(groupId = groupId, dmConversationId = dmConversationId)
        val intent = Intent(Intent.ACTION_VIEW, deepLinkUri).apply {
            setPackage(context.packageName)
            setClass(context, MainActivity::class.java)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            // Unique request code per conversation so multiple pending intents
            // for different chats coexist (otherwise they collapse).
            (groupId ?: dmConversationId ?: messageId ?: "global").hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val channelId = context.getString(R.string.push_channel_id)
        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.sym_action_chat)
            .setContentTitle(title.ifBlank { "New message" })
            .setContentText(body)
            .setAutoCancel(true)
            .setDefaults(NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setContentIntent(pendingIntent)
            .build()

        // Tag the notification by conversation id so multiple messages for the
        // same chat coalesce (latest preview wins).
        val tag = groupId ?: dmConversationId ?: "chat"
        nm.notify(tag, 1, notification)
    }

    private fun buildDeepLink(groupId: String?, dmConversationId: String?): Uri {
        val builder = Uri.Builder()
            .scheme("squadhub-chat")
            .authority("chat")
        if (!groupId.isNullOrBlank()) builder.appendQueryParameter("group_id", groupId)
        if (!dmConversationId.isNullOrBlank()) builder.appendQueryParameter("dm", dmConversationId)
        return builder.build()
    }
}
