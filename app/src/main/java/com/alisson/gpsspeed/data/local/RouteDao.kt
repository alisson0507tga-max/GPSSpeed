package com.alisson.gpsspeed.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Dao
interface RouteDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertRoute(route: RouteEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertPoints(points: List<LocationPointEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertPoint(point: LocationPointEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertKilometerSplits(splits: List<KilometerSplitEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertKilometerSplit(split: KilometerSplitEntity): Long

    @Query("SELECT * FROM routes ORDER BY startedAt DESC")
    fun observeRoutes(): Flow<List<RouteEntity>>

    @Query("SELECT * FROM routes ORDER BY startedAt DESC")
    suspend fun getRoutes(): List<RouteEntity>

    @Query("SELECT * FROM routes WHERE id = :routeId LIMIT 1")
    suspend fun getRoute(routeId: String): RouteEntity?

    @Query("SELECT * FROM location_points WHERE routeId = :routeId ORDER BY timestamp ASC, id ASC")
    fun observePoints(routeId: String): Flow<List<LocationPointEntity>>

    @Query("SELECT * FROM location_points WHERE routeId = :routeId ORDER BY timestamp ASC, id ASC")
    suspend fun getPoints(routeId: String): List<LocationPointEntity>

    @Query("SELECT * FROM kilometer_splits WHERE routeId = :routeId ORDER BY kilometerNumber ASC")
    fun observeKilometerSplits(routeId: String): Flow<List<KilometerSplitEntity>>

    @Query("SELECT * FROM kilometer_splits WHERE routeId = :routeId ORDER BY kilometerNumber ASC")
    suspend fun getKilometerSplits(routeId: String): List<KilometerSplitEntity>

    @Query("DELETE FROM routes WHERE id = :routeId")
    suspend fun deleteRouteById(routeId: String)

    @Query("DELETE FROM routes")
    suspend fun deleteAllRoutes()

    @Query("SELECT COALESCE(SUM(distanceMeters), 0.0) FROM routes")
    fun observeTotalDistanceMeters(): Flow<Double>

    @Query("SELECT COALESCE(SUM(movingMs), 0) FROM routes")
    fun observeTotalMovingMs(): Flow<Long>

    @Query("SELECT COUNT(*) FROM routes")
    fun observeRouteCount(): Flow<Int>

    @Query("SELECT COALESCE(MAX(distanceMeters), 0.0) FROM routes")
    fun observeLongestRouteMeters(): Flow<Double>

    @Query("SELECT COALESCE(MAX(maxSpeedKmh), 0.0) FROM routes")
    fun observeHighestSpeedKmh(): Flow<Double>

    @Query("SELECT COALESCE(SUM(distanceMeters), 0.0) FROM routes WHERE startedAt >= :fromInclusive AND startedAt < :toExclusive")
    fun observeDistanceBetween(fromInclusive: Long, toExclusive: Long): Flow<Double>

    @Transaction
    suspend fun replaceRouteData(
        route: RouteEntity,
        points: List<LocationPointEntity>,
        kilometerSplits: List<KilometerSplitEntity>
    ) {
        upsertRoute(route)
        if (points.isNotEmpty()) upsertPoints(points)
        if (kilometerSplits.isNotEmpty()) upsertKilometerSplits(kilometerSplits)
    }
}
