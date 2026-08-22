package com.alisson.gpsspeed

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

class LocationTrackingService : Service(), LocationListener {

    companion object {
        const val ACTION_START = "com.alisson.gpsspeed.START_TRACKING"
        const val ACTION_PAUSE = "com.alisson.gpsspeed.PAUSE_TRACKING"
        const val ACTION_RESUME = "com.alisson.gpsspeed.RESUME_TRACKING"
        const val ACTION_STOP = "com.alisson.gpsspeed.STOP_TRACKING"
        const val PREFS = "gpsspeed_native_tracking"
        const val KEY_STATUS = "status"
        const val KEY_STARTED_AT = "startedAt"
        const val KEY_POINTS = "points"
        const val KEY_PAUSED_AT = "pausedAt"
        const val KEY_TOTAL_PAUSED = "totalPausedMs"
        const val CHANNEL_ID = "gpsspeed_tracking"
        const val NOTIFICATION_ID = 4107
    }

    private lateinit var locationManager: LocationManager
    private var paused = false

    override fun onCreate() {
        super.onCreate()
        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PAUSE -> pauseTracking()
            ACTION_RESUME -> resumeTracking()
            ACTION_STOP -> stopTracking()
            else -> startTracking()
        }
        return START_STICKY
    }

    private fun startTracking() {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getString(KEY_STATUS, "idle") == "idle" || prefs.getString(KEY_STATUS, "idle") == "finished") {
            prefs.edit()
                .putString(KEY_STATUS, "running")
                .putLong(KEY_STARTED_AT, System.currentTimeMillis())
                .putLong(KEY_TOTAL_PAUSED, 0L)
                .putString(KEY_POINTS, "[]")
                .remove(KEY_PAUSED_AT)
                .apply()
        } else {
            prefs.edit().putString(KEY_STATUS, "running").remove(KEY_PAUSED_AT).apply()
        }
        paused = false
        startForeground(NOTIFICATION_ID, buildNotification("Percurso em andamento"))
        requestUpdates()
    }

    private fun pauseTracking() {
        paused = true
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit()
            .putString(KEY_STATUS, "paused")
            .putLong(KEY_PAUSED_AT, System.currentTimeMillis())
            .apply()
        stopLocationUpdates()
        startForeground(NOTIFICATION_ID, buildNotification("Percurso pausado"))
    }

    private fun resumeTracking() {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val pausedAt = prefs.getLong(KEY_PAUSED_AT, 0L)
        var totalPaused = prefs.getLong(KEY_TOTAL_PAUSED, 0L)
        if (pausedAt > 0L) totalPaused += System.currentTimeMillis() - pausedAt
        prefs.edit()
            .putString(KEY_STATUS, "running")
            .putLong(KEY_TOTAL_PAUSED, totalPaused)
            .remove(KEY_PAUSED_AT)
            .apply()
        paused = false
        startForeground(NOTIFICATION_ID, buildNotification("Percurso em andamento"))
        requestUpdates()
    }

    private fun stopTracking() {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val status = prefs.getString(KEY_STATUS, "idle")
        if (status == "paused") {
            val pausedAt = prefs.getLong(KEY_PAUSED_AT, 0L)
            var totalPaused = prefs.getLong(KEY_TOTAL_PAUSED, 0L)
            if (pausedAt > 0L) totalPaused += System.currentTimeMillis() - pausedAt
            prefs.edit().putLong(KEY_TOTAL_PAUSED, totalPaused).remove(KEY_PAUSED_AT).apply()
        }
        prefs.edit().putString(KEY_STATUS, "finished").apply()
        stopLocationUpdates()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun requestUpdates() {
        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fine && !coarse) return

        try {
            locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this)
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 2000L, 0f, this)
            }
        } catch (_: Exception) {
        }
    }

    private fun stopLocationUpdates() {
        try { locationManager.removeUpdates(this) } catch (_: Exception) {}
    }

    override fun onLocationChanged(location: Location) {
        if (paused) return
        if (location.accuracy > 70f) return

        val point = JSONObject().apply {
            put("type", "position")
            put("timestamp", location.time.takeIf { it > 0 } ?: System.currentTimeMillis())
            put("latitude", location.latitude)
            put("longitude", location.longitude)
            put("accuracy", location.accuracy.toDouble())
            put("altitude", if (location.hasAltitude()) location.altitude else JSONObject.NULL)
            put("heading", if (location.hasBearing()) location.bearing.toDouble() else JSONObject.NULL)
            put("speedKmh", if (location.hasSpeed()) location.speed * 3.6 else 0.0)
        }

        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val array = try { JSONArray(prefs.getString(KEY_POINTS, "[]")) } catch (_: Exception) { JSONArray() }
        array.put(point)
        if (array.length() > 12000) {
            val trimmed = JSONArray()
            for (i in array.length() - 10000 until array.length()) trimmed.put(array.get(i))
            prefs.edit().putString(KEY_POINTS, trimmed.toString()).apply()
        } else {
            prefs.edit().putString(KEY_POINTS, array.toString()).apply()
        }
    }

    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}
    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Rastreamento de percurso",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Mantém o GPS ativo durante um percurso"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String) = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_menu_mylocation)
        .setContentTitle("GPSSpeed")
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(
            PendingIntent.getActivity(
                this,
                0,
                Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        )
        .build()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopLocationUpdates()
        super.onDestroy()
    }
}