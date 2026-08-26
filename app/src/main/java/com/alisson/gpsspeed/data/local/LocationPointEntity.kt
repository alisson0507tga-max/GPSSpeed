package com.alisson.gpsspeed.data.local

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "location_points",
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
        Index(value = ["routeId", "timestamp"]),
        Index(value = ["routeId", "kilometerNumber"])
    ]
)
data class LocationPointEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val routeId: String,
    val latitude: Double,
    val longitude: Double,
    val timestamp: Long,
    val speedKmh: Double,
    val calculatedSpeedKmh: Double?,
    val accuracyMeters: Float?,
    val altitudeMeters: Double?,
    val bearingDegrees: Float?,
    val accumulatedDistanceMeters: Double,
    val kilometerNumber: Int,
    val satellitesVisible: Int? = null,
    val satellitesUsed: Int? = null,
    val source: String? = null
)
