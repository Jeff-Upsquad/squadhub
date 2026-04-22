package com.squadhub.chat

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.squadhub.chat.data.remote.SocketManager
import com.squadhub.chat.data.repo.ChatRealtimeBridge
import com.squadhub.chat.push.PushTokenSync
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class SquadChatApplication : Application() {

    @Inject lateinit var socketManager: SocketManager
    @Inject lateinit var realtimeBridge: ChatRealtimeBridge
    @Inject lateinit var pushTokenSync: PushTokenSync

    override fun onCreate() {
        super.onCreate()
        registerPushChannel()

        // Socket lifecycle tied to process foreground/background so we don't
        // hold a connection open while the app is in the background (battery,
        // cellular data). Recover on return to foreground.
        ProcessLifecycleOwner.get().lifecycle.addObserver(
            object : DefaultLifecycleObserver {
                override fun onStart(owner: LifecycleOwner) {
                    socketManager.connect()
                }
                override fun onStop(owner: LifecycleOwner) {
                    socketManager.disconnect()
                }
            },
        )

        // Kick off the repository-side subscription once; it keeps running
        // for the process lifetime and upserts any realtime message into Room.
        realtimeBridge.start()

        // Register this device's FCM token with the server on app start + on
        // every sign-in. onNewToken in ChatFirebaseMessagingService catches
        // the on-the-fly rotation case.
        pushTokenSync.start()
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
