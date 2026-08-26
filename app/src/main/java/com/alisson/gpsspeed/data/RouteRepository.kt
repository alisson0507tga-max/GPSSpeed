package com.alisson.gpsspeed.data

import android.content.Context
import androidx.room.withTransaction
import com.alisson.gpsspeed.data.local.AppDatabase
import com.alisson.gpsspeed.data.local.KilometerSplitEntity
import com.alisson.gpsspeed.data.local.LocationPointEntity
import com.alisson.gpsspeed.data.local.RouteDao
import com.alisson.gpsspeed.data.local.RouteEntity
import kotlinx.coroutines.flow.Flow

class RouteRepository private constructor(
    private val database: AppDatabase,
    private val dao: RouteDao
) {

    fun observeRoutes(): Flow<List<RouteEntity>> = dao.observeRoutes()

    fun observePoints(routeId: String): Flow<List<LocationPointEntity>> = dao.observePoints(routeId)

    fun observeKilometerSplits(routeId: String): Flow<List<KilometerSplitEntity>> =
        dao.observeKilometerSplits(routeId)

    fun observeTotalDistanceMeters(): Flow<Double> = dao.observeTotalDistanceMeters()

    fun observeTotalMovingMs(): Flow<Long> = dao.observeTotalMovingMs()

    fun observeRouteCount(): Flow<Int> = dao.observeRouteCount()

    fun observeLongestRouteMeters(): Flow<Double> = dao.observeLongestRouteMeters()

    fun observeHighestSpeedKmh(): Flow<Double> = dao.observeHighestSpeedKmh()

    fun observeDistanceBetween(fromInclusive: Long, toExclusive: Long): Flow<Double> =
        dao.observeDistanceBetween(fromInclusive, toExclusive)

    suspend fun getRoutes(): List<RouteEntity> = dao.getRoutes()

    suspend fun getRoute(routeId: String): RouteEntity? = dao.getRoute(routeId)

    suspend fun getPoints(routeId: String): List<LocationPointEntity> = dao.getPoints(routeId)

    suspend fun getKilometerSplits(routeId: String): List<KilometerSplitEntity> =
        dao.getKilometerSplits(routeId)

    suspend fun saveRoute(route: RouteEntity) {
        dao.upsertRoute(route)
    }

    suspend fun savePoint(point: LocationPointEntity): Long = dao.upsertPoint(point)

    suspend fun savePoints(points: List<LocationPointEntity>) {
        if (points.isNotEmpty()) dao.upsertPoints(points)
    }

    suspend fun saveKilometerSplit(split: KilometerSplitEntity): Long =
        dao.upsertKilometerSplit(split)

    suspend fun saveKilometerSplits(splits: List<KilometerSplitEntity>) {
        if (splits.isNotEmpty()) dao.upsertKilometerSplits(splits)
    }

    suspend fun saveCompleteRoute(
        route: RouteEntity,
        points: List<LocationPointEntity>,
        splits: List<KilometerSplitEntity>
    ) {
        database.withTransaction {
            dao.upsertRoute(route)
            if (points.isNotEmpty()) dao.upsertPoints(points)
            if (splits.isNotEmpty()) dao.upsertKilometerSplits(splits)
        }
    }

    suspend fun deleteRoute(routeId: String) {
        dao.deleteRouteById(routeId)
    }

    suspend fun deleteAllRoutes() {
        dao.deleteAllRoutes()
    }

    companion object {
        @Volatile
        private var INSTANCE: RouteRepository? = null

        fun getInstance(context: Context): RouteRepository {
            return INSTANCE ?: synchronized(this) {
                val database = AppDatabase.getInstance(context)
                INSTANCE ?: RouteRepository(database, database.routeDao()).also { INSTANCE = it }
            }
        }
    }
}
