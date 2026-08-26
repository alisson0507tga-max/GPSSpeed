package com.alisson.gpsspeed.ui.screen

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.alisson.gpsspeed.data.local.RouteWithPoints
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.Polyline

@Composable
fun TimelineRouteScreen(
    routeWithPoints: RouteWithPoints,
    modifier: Modifier = Modifier
) {
    val points = routeWithPoints.points.map { LatLng(it.latitude, it.longitude) }

    GoogleMap(
        modifier = modifier.fillMaxSize()
    ) {
        if (points.isNotEmpty()) {
            Marker(
                state = MarkerState(position = points.first()),
                title = "Início"
            )

            if (points.size > 1) {
                Marker(
                    state = MarkerState(position = points.last()),
                    title = "Fim"
                )
            }

            Polyline(
                points = points,
                color = Color(0xFF1A73E8),
                width = 10f
            )
        }
    }
}
