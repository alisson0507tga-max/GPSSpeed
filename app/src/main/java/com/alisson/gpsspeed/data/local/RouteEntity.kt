package com.alisson.gpsspeed.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "routes")
data class RouteEntity(
    @PrimaryKey
    val id: String,
    val startedAt: Long,
    val finishedAt: Long?,
    val elapsedMs: Long,
    val movingMs: Long,
    val stoppedMs: Long,
    val distanceMeters: Double,
    val maxSpeedKmh: Double,
    val averageSpeedKmh: Double,
    val automatic: Boolean,
    val pointCount: Int,
    val createdAt: Long,
    val startLatitude: Double?,
    val startLongitude: Double?,
    val endLatitude: Double?,
    val endLongitude: Double?,
    val startLabel: String? = null,
    val endLabel: String? = null,
    val schemaVersion: Int = 1
)
