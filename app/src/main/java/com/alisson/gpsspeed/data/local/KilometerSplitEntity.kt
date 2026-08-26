package com.alisson.gpsspeed.data.local

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "kilometer_splits",
    foreignKeys = [
        ForeignKey(
            entity = RouteEntity::class,
            parentColumns = ["id"],
            childColumns = ["routeId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index(value = ["routeId"]),
        Index(value = ["routeId", "kilometerNumber"], unique = true)
    ]
)
data class KilometerSplitEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val routeId: String,
    val kilometerNumber: Int,
    val startedAt: Long,
    val finishedAt: Long,
    val durationMs: Long,
    val averageSpeedKmh: Double,
    val maxSpeedKmh: Double,
    val startLatitude: Double,
    val startLongitude: Double,
    val endLatitude: Double,
    val endLongitude: Double,
    val startDistanceMeters: Double,
    val endDistanceMeters: Double
)
