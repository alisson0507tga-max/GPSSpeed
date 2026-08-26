package com.alisson.gpsspeed.service

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.alisson.gpsspeed.MainActivity
import com.alisson.gpsspeed.data.local.AppDatabase
import com.alisson.gpsspeed.data.local.LocationPointEntity
import com.alisson.gpsspeed.data.local.RouteEntity
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlin.math.max

class LocationTrackerService : Service() {

    companion object {
        const val ACTION_START = "com.alisson.gpsspeed.smart.START"
        const val ACTION_STOP = "com.alisson.gpsspeed.smart.STOP"
        const val ACTION_PAUSE = "com.alisson.gpsspeed.smart.PAUSE"
        const val ACTION_RESUME = "com.alisson.gpsspeed.smart.RESUME"

        const val PREFS = "gpsspeed_smart_tracker"
        const val KEY_MODE = "mode"
        const val KEY_ROUTE_ID = "routeId"
        const val KEY_PROGRESS_METERS = "progressMeters"
        const val KEY_CURRENT_SPEED = "currentSpeedKmh"
        const val KEY_DISTANCE_METERS = "distanceMeters"
        const val KEY_MAX_SPEED = "maxSpeedKmh"
        const val KEY_AVG_SPEED = "avgSpeedKmh"
        const val KEY_STARTED_AT = "startedAt"

        private const val CHANNEL_ID = "gpsspeed_smart_tracking"
        private const val NOTIFICATION_ID = 5107
        private const val START_TRIGGER_METERS = 100.0
        private const val MAX_ACCEPTED_ACCURACY_METERS = 70f
        private const val MAX_PLAUSIBLE_SPEED_KMH = 220.0
    }

    private enum class TrackingMode { STANDBY, HIGH_ACCURACY, PAUSED }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var fusedClient: FusedLocationProviderClient
    private val dao by lazy { AppDatabase.getInstance(applicationContext).routeDao() }

    private var mode = TrackingMode.STANDBY
    private var routeId: String? = null
    private var routeStartedAt = 0L
    private var firstCandidate: Location? = null
    private var lastCandidate: Location? = null
    private var lastRecorded: Location? = null
    private val candidateBuffer = mutableListOf<Location>()
    private var confirmedProgressMeters = 0.0
    private var distanceMeters = 0.0
    private var maxSpeedKmh = 0.0
    private var weightedSpeedSum = 0.0
    private var speedWeightSeconds = 0.0
    private var pointCount = 0

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            result.locations.forEach(::handleLocation)
        }
    }

    override fun onCreate() {
        super.onCreate()
        fusedClient = LocationServices.getFusedLocationProviderClient(this)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopTrackingAndSelf()
            ACTION_PAUSE -> pauseTracking()
            ACTION_RESUME -> resumeTracking()
            ACTION_START, null -> startStandby()
            else -> startStandby()
        }
        return START_STICKY
    }

    private fun startStandby() {
        if (!hasLocationPermission()) return
        mode = TrackingMode.STANDBY
        resetCandidateState()
        persistState()
        startForeground(NOTIFICATION_ID, buildNotification("Linha do Tempo pronta • 0/100 m"))
        requestBalancedUpdates()
    }

    private fun pauseTracking() {
        mode = TrackingMode.PAUSED
        removeUpdates()
        persistState()
        startForeground(NOTIFICATION_ID, buildNotification("Rastreamento pausado"))
    }

    private fun resumeTracking() {
        if (routeId != null) {
            mode = TrackingMode.HIGH_ACCURACY
            requestHighAccuracyUpdates()
            startForeground(NOTIFICATION_ID, buildNotification("Percurso retomado"))
        } else {
            startStandby()
        }
        persistState()
    }

    private fun requestBalancedUpdates() {
        if (!hasLocationPermission()) return
        removeUpdates()
        val request = LocationRequest.Builder(
            Priority.PRIORITY_BALANCED_POWER_ACCURACY,
            10_000L
        )
            .setMinUpdateIntervalMillis(7_500L)
            .setMaxUpdateDelayMillis(20_000L)
            .build()
        try {
            fusedClient.requestLocationUpdates(request, callback, mainLooper)
        } catch (_: SecurityException) {}
    }

    private fun requestHighAccuracyUpdates() {
        if (!hasLocationPermission()) return
        removeUpdates()
        val request = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            1_000L
        )
            .setMinUpdateIntervalMillis(750L)
            .setMinUpdateDistanceMeters(2f)
            .setWaitForAccurateLocation(false)
            .build()
        try {
            fusedClient.requestLocationUpdates(request, callback, mainLooper)
        } catch (_: SecurityException) {}
    }

    private fun handleLocation(location: Location) {
        if (mode == TrackingMode.PAUSED) return
        if (!isUsable(location)) return

        when (mode) {
            TrackingMode.STANDBY -> handleStandbyLocation(location)
            TrackingMode.HIGH_ACCURACY -> handleActiveLocation(location)
            TrackingMode.PAUSED -> Unit
        }
    }

    private fun handleStandbyLocation(location: Location) {
        if (firstCandidate == null) {
            firstCandidate = Location(location)
            lastCandidate = Location(location)
            candidateBuffer.clear()
            candidateBuffer += Location(location)
            confirmedProgressMeters = 0.0
            persistState()
            return
        }

        val previous = lastCandidate ?: firstCandidate ?: return
        val step = previous.distanceTo(location).toDouble()
        val accuracyGate = max(8.0, max(previous.accuracy, location.accuracy).toDouble() * 0.65)
        val speedKmh = reliableSpeedKmh(previous, location)

        val movementLooksReal =
            step >= accuracyGate || speedKmh >= 4.0

        if (movementLooksReal && step < 250.0 && speedKmh <= MAX_PLAUSIBLE_SPEED_KMH) {
            confirmedProgressMeters += step
            val lastBuffered = candidateBuffer.lastOrNull()
            if (lastBuffered == null || lastBuffered.distanceTo(location) >= 5f) {
                candidateBuffer += Location(location)
                if (candidateBuffer.size > 80) candidateBuffer.removeAt(0)
            }
        }

        lastCandidate = Location(location)
        persistState()
        updateNotification("Linha do Tempo pronta • ${confirmedProgressMeters.toInt().coerceIn(0, 99)}/100 m")

        if (confirmedProgressMeters >= START_TRIGGER_METERS && candidateBuffer.size >= 2) {
            beginRouteFromBuffer(location)
        }
    }

    private fun beginRouteFromBuffer(current: Location) {
        val startedAt = candidateBuffer.firstOrNull()?.time?.takeIf { it > 0 } ?: System.currentTimeMillis()
        val newRouteId = "route_${startedAt}_${System.currentTimeMillis()}"
        routeId = newRouteId
        routeStartedAt = startedAt
        distanceMeters = 0.0
        maxSpeedKmh = 0.0
        weightedSpeedSum = 0.0
        speedWeightSeconds = 0.0
        pointCount = 0
        lastRecorded = null

        serviceScope.launch {
            dao.upsertRoute(
                RouteEntity(
                    id = newRouteId,
                    startedAt = startedAt,
                    finishedAt = null,
                    elapsedMs = 0L,
                    movingMs = 0L,
                    stoppedMs = 0L,
                    distanceMeters = 0.0,
                    maxSpeedKmh = 0.0,
                    averageSpeedKmh = 0.0,
                    automatic = true,
                    pointCount = 0,
                    createdAt = System.currentTimeMillis(),
                    startLatitude = candidateBuffer.firstOrNull()?.latitude,
                    startLongitude = candidateBuffer.firstOrNull()?.longitude,
                    endLatitude = null,
                    endLongitude = null,
                    schemaVersion = 2
                )
            )

            candidateBuffer.forEach { buffered ->
                recordPoint(newRouteId, buffered)
            }
            if (candidateBuffer.lastOrNull()?.time != current.time) {
                recordPoint(newRouteId, current)
            }
        }

        mode = TrackingMode.HIGH_ACCURACY
        resetCandidateState(keepProgress = true)
        persistState()
        startForeground(NOTIFICATION_ID, buildNotification("● GRAVANDO PERCURSO"))
        requestHighAccuracyUpdates()
    }

    private fun handleActiveLocation(location: Location) {
        val id = routeId ?: return
        serviceScope.launch {
            recordPoint(id, location)
        }
    }

    private suspend fun recordPoint(id: String, location: Location) {
        val previous = lastRecorded
        val step = previous?.distanceTo(location)?.toDouble() ?: 0.0
        val dtSeconds = previous?.let {
            ((location.time - it.time).coerceAtLeast(1L) / 1000.0)
        } ?: 0.0
        val calculatedSpeed = if (dtSeconds > 0) step / dtSeconds * 3.6 else 0.0
        val gpsSpeed = if (location.hasSpeed()) location.speed * 3.6 else 0.0
        val chosenSpeed = when {
            gpsSpeed in 0.0..MAX_PLAUSIBLE_SPEED_KMH && location.accuracy <= 30f -> gpsSpeed
            calculatedSpeed in 0.0..MAX_PLAUSIBLE_SPEED_KMH -> calculatedSpeed
            else -> 0.0
        }

        if (previous != null) {
            if (step > 300.0 || calculatedSpeed > MAX_PLAUSIBLE_SPEED_KMH) return
            val noiseGate = max(3.0, max(previous.accuracy, location.accuracy).toDouble() * 0.45)
            if (step < noiseGate && chosenSpeed < 3.0) return
            distanceMeters += step
        }

        maxSpeedKmh = max(maxSpeedKmh, chosenSpeed)
        if (dtSeconds > 0 && chosenSpeed >= 3.0) {
            weightedSpeedSum += chosenSpeed * dtSeconds
            speedWeightSeconds += dtSeconds
        }
        pointCount += 1
        val average = if (speedWeightSeconds > 0) weightedSpeedSum / speedWeightSeconds else 0.0
        val timestamp = location.time.takeIf { it > 0 } ?: System.currentTimeMillis()

        dao.upsertPoint(
            LocationPointEntity(
                routeId = id,
                latitude = location.latitude,
                longitude = location.longitude,
                timestamp = timestamp,
                speedKmh = chosenSpeed,
                calculatedSpeedKmh = calculatedSpeed,
                accuracyMeters = location.accuracy,
                altitudeMeters = if (location.hasAltitude()) location.altitude else null,
                bearingDegrees = if (location.hasBearing()) location.bearing else null,
                accumulatedDistanceMeters = distanceMeters,
                kilometerNumber = (distanceMeters / 1000.0).toInt() + 1,
                source = "fused"
            )
        )

        val elapsed = (timestamp - routeStartedAt).coerceAtLeast(0L)
        dao.upsertRoute(
            RouteEntity(
                id = id,
                startedAt = routeStartedAt,
                finishedAt = null,
                elapsedMs = elapsed,
                movingMs = elapsed,
                stoppedMs = 0L,
                distanceMeters = distanceMeters,
                maxSpeedKmh = maxSpeedKmh,
                averageSpeedKmh = average,
                automatic = true,
                pointCount = pointCount,
                createdAt = routeStartedAt,
                startLatitude = null,
                startLongitude = null,
                endLatitude = location.latitude,
                endLongitude = location.longitude,
                schemaVersion = 2
            )
        )

        lastRecorded = Location(location)
        persistState(currentSpeed = chosenSpeed, averageSpeed = average)
        updateNotification("● GRAVANDO • ${chosenSpeed.toInt()} km/h • %.2f km".format(distanceMeters / 1000.0))
    }

    private fun reliableSpeedKmh(previous: Location, current: Location): Double {
        val gps = if (current.hasSpeed()) current.speed * 3.6 else 0.0
        val dt = ((current.time - previous.time).coerceAtLeast(1L) / 1000.0)
        val calculated = previous.distanceTo(current) / dt * 3.6
        return if (gps in 0.0..MAX_PLAUSIBLE_SPEED_KMH && current.accuracy <= 35f) gps else calculated
    }

    private fun isUsable(location: Location): Boolean {
        if (location.accuracy <= 0f || location.accuracy > MAX_ACCEPTED_ACCURACY_METERS) return false
        if (location.latitude !in -90.0..90.0 || location.longitude !in -180.0..180.0) return false
        return true
    }

    private fun resetCandidateState(keepProgress: Boolean = false) {
        firstCandidate = null
        lastCandidate = null
        candidateBuffer.clear()
        if (!keepProgress) confirmedProgressMeters = 0.0
    }

    private fun stopTrackingAndSelf() {
        val id = routeId
        val finishedAt = System.currentTimeMillis()
        if (id != null) {
            serviceScope.launch {
                val current = dao.getRoute(id)
                if (current != null) {
                    dao.upsertRoute(
                        current.copy(
                            finishedAt = finishedAt,
                            elapsedMs = (finishedAt - current.startedAt).coerceAtLeast(0L),
                            distanceMeters = distanceMeters,
                            maxSpeedKmh = maxSpeedKmh,
                            averageSpeedKmh = if (speedWeightSeconds > 0) weightedSpeedSum / speedWeightSeconds else 0.0,
                            pointCount = pointCount,
                            endLatitude = lastRecorded?.latitude,
                            endLongitude = lastRecorded?.longitude
                        )
                    )
                }
            }
        }
        removeUpdates()
        routeId = null
        mode = TrackingMode.STANDBY
        persistState()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun hasLocationPermission(): Boolean {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }

    private fun removeUpdates() {
        try { fusedClient.removeLocationUpdates(callback) } catch (_: Exception) {}
    }

    private fun persistState(currentSpeed: Double = 0.0, averageSpeed: Double = 0.0) {
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_MODE, mode.name)
            .putString(KEY_ROUTE_ID, routeId)
            .putInt(KEY_PROGRESS_METERS, confirmedProgressMeters.toInt().coerceAtLeast(0))
            .putFloat(KEY_CURRENT_SPEED, currentSpeed.toFloat())
            .putFloat(KEY_DISTANCE_METERS, distanceMeters.toFloat())
            .putFloat(KEY_MAX_SPEED, maxSpeedKmh.toFloat())
            .putFloat(KEY_AVG_SPEED, averageSpeed.toFloat())
            .putLong(KEY_STARTED_AT, routeStartedAt)
            .apply()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "GPS inteligente",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Linha do Tempo e rastreamento inteligente do GPSSpeed"
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

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }

    override fun onDestroy() {
        removeUpdates()
        serviceScope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
