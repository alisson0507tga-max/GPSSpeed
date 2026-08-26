package com.alisson.gpsspeed.data

import android.content.Context
import com.alisson.gpsspeed.data.local.KilometerSplitEntity
import com.alisson.gpsspeed.data.local.LocationPointEntity
import com.alisson.gpsspeed.data.local.RouteEntity
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.floor

class LegacyTripImporter(context: Context) {

    private val repository = RouteRepository.getInstance(context)

    suspend fun importJson(raw: String): Int {
        if (raw.isBlank()) return 0
        val array = parseTripsArray(raw)
        var imported = 0

        for (index in 0 until array.length()) {
            val trip = array.optJSONObject(index) ?: continue
            val routeId = trip.optString("id").ifBlank {
                "legacy_${trip.optLong("startedAt", System.currentTimeMillis())}_$index"
            }

            val pointsJson = trip.optJSONArray("points") ?: JSONArray()
            val points = buildPoints(routeId, pointsJson)
            val splits = buildSplits(routeId, trip.optJSONArray("kilometerSplits"), points)
            val first = points.firstOrNull()
            val last = points.lastOrNull()

            val startedAt = trip.optLong("startedAt", first?.timestamp ?: System.currentTimeMillis())
            val finishedAt = trip.optLong("finishedAt", 0L).takeIf { it > 0L }
                ?: last?.timestamp
            val elapsedMs = trip.optLong(
                "elapsedMs",
                if (finishedAt != null) (finishedAt - startedAt).coerceAtLeast(0L) else 0L
            )

            val route = RouteEntity(
                id = routeId,
                startedAt = startedAt,
                finishedAt = finishedAt,
                elapsedMs = elapsedMs,
                movingMs = trip.optLong("movingMs", elapsedMs),
                stoppedMs = trip.optLong("stoppedMs", 0L),
                distanceMeters = trip.optDouble(
                    "distanceMeters",
                    last?.accumulatedDistanceMeters ?: trip.optDouble("distanceKm", 0.0) * 1000.0
                ),
                maxSpeedKmh = trip.optDouble("maxSpeed", 0.0),
                averageSpeedKmh = trip.optDouble("averageSpeed", 0.0),
                automatic = trip.optBoolean("automatic", false),
                pointCount = points.size,
                createdAt = trip.optLong("createdAt", startedAt),
                startLatitude = first?.latitude,
                startLongitude = first?.longitude,
                endLatitude = last?.latitude,
                endLongitude = last?.longitude,
                startLabel = trip.optString("startLabel").takeIf { it.isNotBlank() },
                endLabel = trip.optString("endLabel").takeIf { it.isNotBlank() },
                schemaVersion = trip.optInt("schemaVersion", 1)
            )

            repository.saveCompleteRoute(route, points, splits)
            imported++
        }

        return imported
    }

    private fun parseTripsArray(raw: String): JSONArray {
        val trimmed = raw.trim()
        return if (trimmed.startsWith("[")) {
            JSONArray(trimmed)
        } else {
            JSONObject(trimmed).optJSONArray("trips") ?: JSONArray()
        }
    }

    private fun buildPoints(routeId: String, array: JSONArray): List<LocationPointEntity> {
        val result = ArrayList<LocationPointEntity>(array.length())
        for (index in 0 until array.length()) {
            val point = array.optJSONObject(index) ?: continue
            val latitude = point.optDouble("latitude", Double.NaN)
            val longitude = point.optDouble("longitude", Double.NaN)
            if (!latitude.isFinite() || !longitude.isFinite()) continue

            val accumulated = point.optDouble("cumulativeDistanceMeters", 0.0).coerceAtLeast(0.0)
            val kilometer = point.optInt(
                "kilometerIndex",
                floor(accumulated / 1000.0).toInt() + 1
            ).coerceAtLeast(1)

            result += LocationPointEntity(
                routeId = routeId,
                latitude = latitude,
                longitude = longitude,
                timestamp = point.optLong("timestamp", System.currentTimeMillis()),
                speedKmh = point.optDouble("speedKmh", 0.0).coerceAtLeast(0.0),
                calculatedSpeedKmh = point.optNullableDouble("calculatedSpeedKmh"),
                accuracyMeters = point.optNullableDouble("accuracy")?.toFloat(),
                altitudeMeters = point.optNullableDouble("altitude"),
                bearingDegrees = point.optNullableDouble("heading")?.toFloat(),
                accumulatedDistanceMeters = accumulated,
                kilometerNumber = kilometer,
                satellitesVisible = point.optNullableInt("satellitesVisible"),
                satellitesUsed = point.optNullableInt("satellitesUsed"),
                source = point.optString("source").takeIf { it.isNotBlank() }
            )
        }
        return result.sortedBy { it.timestamp }
    }

    private fun buildSplits(
        routeId: String,
        array: JSONArray?,
        points: List<LocationPointEntity>
    ): List<KilometerSplitEntity> {
        if (array == null) return emptyList()
        val result = mutableListOf<KilometerSplitEntity>()

        for (index in 0 until array.length()) {
            val split = array.optJSONObject(index) ?: continue
            val km = split.optInt("kilometer", index + 1).coerceAtLeast(1)
            val startPoint = split.optJSONObject("startPoint")
            val endPoint = split.optJSONObject("endPoint")
                ?: points.firstOrNull { it.kilometerNumber > km }?.let {
                    JSONObject().apply {
                        put("latitude", it.latitude)
                        put("longitude", it.longitude)
                    }
                }

            val fallbackStart = points.firstOrNull { it.kilometerNumber == km }
            val fallbackEnd = points.lastOrNull { it.kilometerNumber == km }
            val startLat = startPoint?.optDouble("latitude", Double.NaN)
                ?.takeIf { it.isFinite() } ?: fallbackStart?.latitude ?: continue
            val startLon = startPoint.optDoubleOrNull("longitude") ?: fallbackStart?.longitude ?: continue
            val endLat = endPoint?.optDouble("latitude", Double.NaN)
                ?.takeIf { it.isFinite() } ?: fallbackEnd?.latitude ?: continue
            val endLon = endPoint.optDoubleOrNull("longitude") ?: fallbackEnd?.longitude ?: continue

            val startedAt = split.optLong("startedAt", fallbackStart?.timestamp ?: 0L)
            val finishedAt = split.optLong("finishedAt", fallbackEnd?.timestamp ?: startedAt)

            result += KilometerSplitEntity(
                routeId = routeId,
                kilometerNumber = km,
                startedAt = startedAt,
                finishedAt = finishedAt,
                durationMs = split.optLong("elapsedMs", (finishedAt - startedAt).coerceAtLeast(0L)),
                averageSpeedKmh = split.optDouble("averageSpeed", 0.0),
                maxSpeedKmh = split.optDouble("maxSpeed", 0.0),
                startLatitude = startLat,
                startLongitude = startLon,
                endLatitude = endLat,
                endLongitude = endLon,
                startDistanceMeters = split.optDouble("startDistanceMeters", (km - 1) * 1000.0),
                endDistanceMeters = split.optDouble("endDistanceMeters", km * 1000.0)
            )
        }

        return result
    }

    private fun JSONObject.optNullableDouble(key: String): Double? {
        if (!has(key) || isNull(key)) return null
        return optDouble(key, Double.NaN).takeIf { it.isFinite() }
    }

    private fun JSONObject.optNullableInt(key: String): Int? {
        if (!has(key) || isNull(key)) return null
        return optInt(key)
    }

    private fun JSONObject?.optDoubleOrNull(key: String): Double? {
        if (this == null || !has(key) || isNull(key)) return null
        return optDouble(key, Double.NaN).takeIf { it.isFinite() }
    }
}
