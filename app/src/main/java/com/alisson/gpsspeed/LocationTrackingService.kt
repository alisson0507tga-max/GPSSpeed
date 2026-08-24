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
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.*

class LocationTrackingService : Service(), LocationListener {

    companion object {
        const val ACTION_START = "com.alisson.gpsspeed.START_TRACKING"
        const val ACTION_PAUSE = "com.alisson.gpsspeed.PAUSE_TRACKING"
        const val ACTION_RESUME = "com.alisson.gpsspeed.RESUME_TRACKING"
        const val ACTION_STOP = "com.alisson.gpsspeed.STOP_TRACKING"
        const val ACTION_ENABLE_AUTO = "com.alisson.gpsspeed.ENABLE_AUTO"
        const val ACTION_DISABLE_AUTO = "com.alisson.gpsspeed.DISABLE_AUTO"

        const val PREFS = "gpsspeed_native_tracking"
        const val KEY_STATUS = "status"
        const val KEY_STARTED_AT = "startedAt"
        const val KEY_POINTS = "points"
        const val KEY_LAST_POINT = "lastPoint"
        const val KEY_PAUSED_AT = "pausedAt"
        const val KEY_TOTAL_PAUSED = "totalPausedMs"

        const val KEY_AUTO_ENABLED = "autoEnabled"
        const val KEY_AUTO_ACTIVE = "autoActive"
        const val KEY_AUTO_STARTED_AT = "autoStartedAt"
        const val KEY_AUTO_POINTS = "autoPoints"
        const val KEY_AUTO_TRIPS = "autoTrips"
        const val KEY_AUTO_LAST_MOVING_AT = "autoLastMovingAt"

        const val CHANNEL_ID = "gpsspeed_tracking"
        const val NOTIFICATION_ID = 4107
    }

    private lateinit var locationManager: LocationManager
    private var paused = false
    private var wakeLock: PowerManager.WakeLock? = null
    private var autoMoveConfirmations = 0
    private var lastAutoCandidate: Location? = null

    private val autoStartSpeedKmh = 4.0
    private val autoStopSpeedKmh = 2.5
    private val autoStopAfterMs = 2 * 60 * 1000L
    private val maxAccuracy = 70f

    override fun onCreate() {
        super.onCreate()
        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startTracking()
            ACTION_PAUSE -> pauseTracking()
            ACTION_RESUME -> resumeTracking()
            ACTION_STOP -> stopTracking()
            ACTION_ENABLE_AUTO -> enableAutoMode()
            ACTION_DISABLE_AUTO -> disableAutoMode()
            else -> restoreServiceState()
        }
        return START_STICKY
    }

    private fun restoreServiceState() {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        when {
            prefs.getBoolean(KEY_AUTO_ENABLED, false) -> startAutoMonitoring()
            prefs.getString(KEY_STATUS, "idle") == "running" -> {
                paused = false
                acquireWakeLock()
                startForeground(NOTIFICATION_ID, buildNotification("Percurso em andamento"))
                requestUpdates(1000L)
            }
            else -> stopSelf()
        }
    }

    private fun startTracking() {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val current = prefs.getString(KEY_STATUS, "idle")
        if (current == "idle" || current == "finished" || current == "auto-monitoring") {
            prefs.edit()
                .putString(KEY_STATUS, "running")
                .putLong(KEY_STARTED_AT, System.currentTimeMillis())
                .putLong(KEY_TOTAL_PAUSED, 0L)
                .putString(KEY_POINTS, "[]")
                .remove(KEY_LAST_POINT)
                .remove(KEY_PAUSED_AT)
                .apply()
        } else {
            prefs.edit().putString(KEY_STATUS, "running").remove(KEY_PAUSED_AT).apply()
        }
        paused = false
        acquireWakeLock()
        startForeground(NOTIFICATION_ID, buildNotification("Percurso em andamento"))
        requestUpdates(1000L)
    }

    private fun pauseTracking() {
        paused = true
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_STATUS, "paused").putLong(KEY_PAUSED_AT, System.currentTimeMillis()).apply()
        stopLocationUpdates()
        releaseWakeLock()
        startForeground(NOTIFICATION_ID, buildNotification("Percurso pausado"))
    }

    private fun resumeTracking() {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val pausedAt = prefs.getLong(KEY_PAUSED_AT, 0L)
        var totalPaused = prefs.getLong(KEY_TOTAL_PAUSED, 0L)
        if (pausedAt > 0L) totalPaused += System.currentTimeMillis() - pausedAt
        prefs.edit().putString(KEY_STATUS, "running").putLong(KEY_TOTAL_PAUSED, totalPaused).remove(KEY_PAUSED_AT).apply()
        paused = false
        acquireWakeLock()
        startForeground(NOTIFICATION_ID, buildNotification("Percurso em andamento"))
        requestUpdates(1000L)
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
        releaseWakeLock()
        if (prefs.getBoolean(KEY_AUTO_ENABLED, false)) startAutoMonitoring() else {
            stopLocationUpdates()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun enableAutoMode() {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_AUTO_ENABLED, true).apply()
        startAutoMonitoring()
    }

    private fun disableAutoMode() {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getBoolean(KEY_AUTO_ACTIVE, false)) finishAutoTrip(System.currentTimeMillis())
        prefs.edit().putBoolean(KEY_AUTO_ENABLED, false).putBoolean(KEY_AUTO_ACTIVE, false).apply()
        if (prefs.getString(KEY_STATUS, "idle") == "running") return
        stopLocationUpdates()
        releaseWakeLock()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startAutoMonitoring() {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(KEY_AUTO_ENABLED, false)) return
        if (prefs.getString(KEY_STATUS, "idle") != "running" && prefs.getString(KEY_STATUS, "idle") != "paused") {
            prefs.edit().putString(KEY_STATUS, "auto-monitoring").apply()
        }
        paused = false
        releaseWakeLock()
        startForeground(NOTIFICATION_ID, buildNotification(if (prefs.getBoolean(KEY_AUTO_ACTIVE, false)) "Linha do Tempo: trajeto em andamento" else "Linha do Tempo automática ativa"))
        requestUpdates(4000L)
    }

    private fun requestUpdates(intervalMs: Long) {
        val fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fine && !coarse) return
        stopLocationUpdates()
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, intervalMs, 0f, this)
            } else if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, max(intervalMs, 5000L), 0f, this)
            }
        } catch (_: Exception) {}
    }

    private fun stopLocationUpdates() {
        try { locationManager.removeUpdates(this) } catch (_: Exception) {}
    }

    override fun onLocationChanged(location: Location) {
        if (paused || location.accuracy <= 0f || location.accuracy > maxAccuracy) return

        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val manualRunning = prefs.getString(KEY_STATUS, "idle") == "running"
        if (manualRunning) recordManualPoint(location)
        if (prefs.getBoolean(KEY_AUTO_ENABLED, false) && !manualRunning) processAutoLocation(location)
    }

    private fun locationToJson(location: Location): JSONObject {
        val speedKmh = if (location.hasSpeed()) max(0.0, location.speed * 3.6) else 0.0
        return JSONObject().apply {
            put("type", "position")
            put("timestamp", location.time.takeIf { it > 0 } ?: System.currentTimeMillis())
            put("latitude", location.latitude)
            put("longitude", location.longitude)
            put("accuracy", location.accuracy.toDouble())
            put("altitude", if (location.hasAltitude()) location.altitude else JSONObject.NULL)
            put("heading", if (location.hasBearing()) location.bearing.toDouble() else JSONObject.NULL)
            put("speedKmh", speedKmh)
        }
    }

    private fun recordManualPoint(location: Location) {
        val point = locationToJson(location)
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val array = safeArray(prefs.getString(KEY_POINTS, "[]"))
        array.put(point)
        val editor = prefs.edit().putString(KEY_LAST_POINT, point.toString())
        editor.putString(KEY_POINTS, trimArray(array, 10000).toString()).apply()
        updateNotification(location, "Percurso")
    }

    private fun processAutoLocation(location: Location) {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val speedKmh = if (location.hasSpeed()) max(0.0, location.speed * 3.6) else 0.0
        val active = prefs.getBoolean(KEY_AUTO_ACTIVE, false)
        val now = System.currentTimeMillis()

        if (!active) {
            val movedByPosition = lastAutoCandidate?.let { distanceMeters(it.latitude, it.longitude, location.latitude, location.longitude) >= max(10.0, location.accuracy.toDouble()) } ?: false
            if (speedKmh >= autoStartSpeedKmh || movedByPosition) autoMoveConfirmations++ else autoMoveConfirmations = 0
            lastAutoCandidate = Location(location)

            if (autoMoveConfirmations >= 3) {
                autoMoveConfirmations = 0
                val first = locationToJson(location)
                prefs.edit()
                    .putBoolean(KEY_AUTO_ACTIVE, true)
                    .putLong(KEY_AUTO_STARTED_AT, now)
                    .putLong(KEY_AUTO_LAST_MOVING_AT, now)
                    .putString(KEY_AUTO_POINTS, JSONArray().put(first).toString())
                    .putString(KEY_STATUS, "auto-monitoring")
                    .putString(KEY_LAST_POINT, first.toString())
                    .apply()
                startForeground(NOTIFICATION_ID, buildNotification("Linha do Tempo: trajeto iniciado"))
                requestUpdates(2000L)
            } else {
                updateNotification(location, "Linha do Tempo pronta")
            }
            return
        }

        val point = locationToJson(location)
        val points = safeArray(prefs.getString(KEY_AUTO_POINTS, "[]"))
        val last = if (points.length() > 0) points.optJSONObject(points.length() - 1) else null
        val shouldAdd = last == null || distanceMeters(
            last.optDouble("latitude"), last.optDouble("longitude"), location.latitude, location.longitude
        ) >= max(4.0, location.accuracy * 0.45)

        if (shouldAdd) points.put(point)
        if (speedKmh >= autoStopSpeedKmh) prefs.edit().putLong(KEY_AUTO_LAST_MOVING_AT, now).apply()
        prefs.edit().putString(KEY_AUTO_POINTS, trimArray(points, 12000).toString()).putString(KEY_LAST_POINT, point.toString()).apply()
        updateNotification(location, "Linha do Tempo")

        val lastMovingAt = prefs.getLong(KEY_AUTO_LAST_MOVING_AT, now)
        if (speedKmh < autoStopSpeedKmh && now - lastMovingAt >= autoStopAfterMs) {
            finishAutoTrip(lastMovingAt)
            requestUpdates(4000L)
        }
    }

    private fun finishAutoTrip(finishedAt: Long) {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val points = safeArray(prefs.getString(KEY_AUTO_POINTS, "[]"))
        val startedAt = prefs.getLong(KEY_AUTO_STARTED_AT, finishedAt)
        if (points.length() >= 2) {
            var distance = 0.0
            var maxSpeed = 0.0
            var speedSum = 0.0
            var speedSamples = 0
            for (i in 0 until points.length()) {
                val p = points.optJSONObject(i) ?: continue
                val speed = p.optDouble("speedKmh", 0.0).coerceAtLeast(0.0)
                maxSpeed = max(maxSpeed, speed)
                if (speed >= autoStopSpeedKmh) { speedSum += speed; speedSamples++ }
                if (i > 0) {
                    val prev = points.optJSONObject(i - 1) ?: continue
                    val seg = distanceMeters(prev.optDouble("latitude"), prev.optDouble("longitude"), p.optDouble("latitude"), p.optDouble("longitude"))
                    if (seg in 0.0..300.0) distance += seg
                }
            }
            if (distance >= 20.0 || finishedAt - startedAt >= 60_000L) {
                val elapsed = max(0L, finishedAt - startedAt)
                val trip = JSONObject().apply {
                    put("id", "auto_${startedAt}_${finishedAt}")
                    put("createdAt", System.currentTimeMillis())
                    put("startedAt", startedAt)
                    put("finishedAt", finishedAt)
                    put("elapsedMs", elapsed)
                    put("movingMs", elapsed)
                    put("stoppedMs", 0)
                    put("distanceMeters", distance)
                    put("distanceKm", distance / 1000.0)
                    put("maxSpeed", maxSpeed)
                    put("averageSpeed", if (speedSamples > 0) speedSum / speedSamples else 0.0)
                    put("finalSpeed", 0.0)
                    put("pointCount", points.length())
                    put("points", points)
                    put("automatic", true)
                }
                val trips = safeArray(prefs.getString(KEY_AUTO_TRIPS, "[]"))
                trips.put(trip)
                prefs.edit().putString(KEY_AUTO_TRIPS, trimArray(trips, 500).toString()).apply()
            }
        }

        prefs.edit()
            .putBoolean(KEY_AUTO_ACTIVE, false)
            .remove(KEY_AUTO_STARTED_AT)
            .remove(KEY_AUTO_LAST_MOVING_AT)
            .putString(KEY_AUTO_POINTS, "[]")
            .putString(KEY_STATUS, "auto-monitoring")
            .apply()
        startForeground(NOTIFICATION_ID, buildNotification("Linha do Tempo automática ativa"))
    }

    private fun updateNotification(location: Location, prefix: String) {
        val kmh = if (location.hasSpeed()) (location.speed * 3.6).toInt().coerceAtLeast(0) else 0
        val accuracy = location.accuracy.toInt().coerceAtLeast(0)
        getSystemService(NotificationManager::class.java).notify(
            NOTIFICATION_ID,
            buildNotification("$prefix • $kmh km/h • precisão $accuracy m")
        )
    }

    private fun safeArray(raw: String?): JSONArray = try { JSONArray(raw ?: "[]") } catch (_: Exception) { JSONArray() }

    private fun trimArray(array: JSONArray, maxItems: Int): JSONArray {
        if (array.length() <= maxItems) return array
        val out = JSONArray()
        for (i in array.length() - maxItems until array.length()) out.put(array.get(i))
        return out
    }

    private fun distanceMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6371000.0
        val p1 = Math.toRadians(lat1)
        val p2 = Math.toRadians(lat2)
        val dp = Math.toRadians(lat2 - lat1)
        val dl = Math.toRadians(lon2 - lon1)
        val a = sin(dp / 2).pow(2) + cos(p1) * cos(p2) * sin(dl / 2).pow(2)
        return r * 2 * atan2(sqrt(a), sqrt(1 - a))
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GPSSpeed:Tracking").apply {
            setReferenceCounted(false)
            acquire(6 * 60 * 60 * 1000L)
        }
    }

    private fun releaseWakeLock() {
        try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) {}
        wakeLock = null
    }

    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}
    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Rastreamento de percurso", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Mantém o GPS ativo durante percursos e Linha do Tempo automática"
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
        .setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        .build()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopLocationUpdates()
        releaseWakeLock()
        super.onDestroy()
    }
}
