package com.alisson.gpsspeed.data.local

import androidx.room.Embedded
import androidx.room.Relation

data class RouteWithPoints(
    @Embedded val route: RouteEntity,
    @Relation(
        parentColumn = "id",
        entityColumn = "routeId"
    )
    val points: List<LocationPointEntity>
)
