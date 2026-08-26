package com.alisson.gpsspeed.ui.screen

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material.icons.filled.Navigation
import androidx.compose.material3.Card
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapType
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import kotlin.math.roundToInt

@Composable
fun SpeedometerMapScreen(
    currentLocation: LatLng?,
    routePoints: List<LatLng>,
    currentSpeedKmh: Double,
    maxSpeedKmh: Double,
    averageSpeedKmh: Double,
    distanceMeters: Double,
    bearingDegrees: Float?,
    recording: Boolean,
    modifier: Modifier = Modifier
) {
    var mapType by remember { mutableStateOf(MapType.NORMAL) }
    var headingUp by remember { mutableStateOf(false) }
    val cameraState = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(currentLocation ?: LatLng(-15.0, -55.0), 15f)
    }

    LaunchedEffect(currentLocation, headingUp, bearingDegrees) {
        val target = currentLocation ?: return@LaunchedEffect
        val bearing = if (headingUp) bearingDegrees ?: 0f else 0f
        cameraState.animate(
            CameraUpdateFactory.newCameraPosition(
                CameraPosition.Builder()
                    .target(target)
                    .zoom(cameraState.position.zoom.coerceAtLeast(16f))
                    .bearing(bearing)
                    .tilt(if (headingUp) 45f else 0f)
                    .build()
            ),
            700
        )
    }

    Box(modifier = modifier.fillMaxSize()) {
        GoogleMap(
            modifier = Modifier.fillMaxSize(),
            cameraPositionState = cameraState,
            properties = MapProperties(
                mapType = mapType,
                isMyLocationEnabled = currentLocation != null
            ),
            uiSettings = MapUiSettings(
                zoomControlsEnabled = false,
                compassEnabled = true,
                myLocationButtonEnabled = false,
                rotationGesturesEnabled = true,
                tiltGesturesEnabled = true,
                zoomGesturesEnabled = true,
                scrollGesturesEnabled = true
            )
        ) {
            if (routePoints.size >= 2) {
                Polyline(
                    points = routePoints,
                    color = Color(0xFF1A73E8),
                    width = 11f
                )
            }
        }

        Card(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(16.dp)
                .fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 14.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = currentSpeedKmh.roundToInt().toString(),
                    fontSize = 64.sp,
                    style = MaterialTheme.typography.displayLarge
                )
                Text("km/h", style = MaterialTheme.typography.titleMedium)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    Text("Média ${averageSpeedKmh.roundToInt()} km/h")
                    Text("Máx. ${maxSpeedKmh.roundToInt()} km/h")
                }
                Text("Distância %.2f km".format(distanceMeters / 1000.0))
                if (recording) Text("● GRAVANDO PERCURSO")
            }
        }

        Column(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            FloatingActionButton(onClick = {
                val target = currentLocation ?: return@FloatingActionButton
                cameraState.move(CameraUpdateFactory.newLatLngZoom(target, 17f))
            }) {
                androidx.compose.material3.Icon(Icons.Default.MyLocation, contentDescription = "Centralizar")
            }

            FloatingActionButton(onClick = { headingUp = !headingUp }) {
                androidx.compose.material3.Icon(Icons.Default.Navigation, contentDescription = "Orientação")
            }

            FloatingActionButton(onClick = {
                mapType = if (mapType == MapType.NORMAL) MapType.SATELLITE else MapType.NORMAL
            }) {
                androidx.compose.material3.Icon(Icons.Default.Layers, contentDescription = "Camadas")
            }
        }
    }
}
