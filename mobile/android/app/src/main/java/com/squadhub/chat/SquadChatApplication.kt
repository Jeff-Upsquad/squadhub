package com.squadhub.chat

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class SquadChatApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        registerPushChannel()
    }

    private fun registerPushChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java) ?: return
        val id = getString(R.string.push_channel_id)
        if (nm.getNotificationChannel(id) == null) {
            val channel = NotificationChannel(
                id,
                getString(R.string.push_channel_name),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Chat messages"
            }
            nm.createNotificationChannel(channel)
        }
    }
}
