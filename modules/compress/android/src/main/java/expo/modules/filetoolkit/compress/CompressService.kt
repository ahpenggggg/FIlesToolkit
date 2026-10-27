package expo.modules.filetoolkit.compress

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Keeps a compression running while the app is in the background or the screen is off: a foreground
 * service with a progress notification, plus a partial wake lock. The work itself runs in CompressModule.
 */
class CompressService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = build(this, intent?.getStringExtra(EXTRA_TEXT) ?: "Getting ready…", -1)
        val type = if (Build.VERSION.SDK_INT >= 35) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING
        } else {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        }
        startForeground(NOTIFICATION_ID, notification, type)
        if (wakeLock == null) {
            wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FileToolkit:compress")
                .apply { acquire(6 * 60 * 60 * 1000L) }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "compress"
        private const val NOTIFICATION_ID = 4201
        private const val EXTRA_TEXT = "text"

        @Volatile private var active = false

        fun start(ctx: Context, text: String) {
            channel(ctx)
            active = true
            ctx.startForegroundService(Intent(ctx, CompressService::class.java).putExtra(EXTRA_TEXT, text))
        }

        /** Updates the notification; [percent] < 0 shows an indeterminate bar. */
        fun update(ctx: Context, text: String, percent: Int) {
            if (!active) return
            ctx.getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, build(ctx, text, percent))
        }

        fun stop(ctx: Context) {
            active = false
            ctx.stopService(Intent(ctx, CompressService::class.java))
        }

        private fun channel(ctx: Context) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(NotificationChannel(CHANNEL, "Video compression", NotificationManager.IMPORTANCE_LOW))
            }
        }

        private fun build(ctx: Context, text: String, percent: Int): Notification {
            val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let {
                PendingIntent.getActivity(ctx, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            }
            return Notification.Builder(ctx, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle("Compressing videos")
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setProgress(100, percent.coerceAtLeast(0), percent < 0)
                .setContentIntent(open)
                .build()
        }
    }
}
