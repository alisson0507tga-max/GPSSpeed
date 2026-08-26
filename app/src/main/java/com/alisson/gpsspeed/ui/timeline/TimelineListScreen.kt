package com.alisson.gpsspeed.ui.timeline

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.alisson.gpsspeed.data.local.RouteWithPoints
import com.alisson.gpsspeed.ui.screen.TimelineRouteScreen
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimelineListScreen(
    viewModel: TimelineViewModel,
    modifier: Modifier = Modifier
) {
    val routes by viewModel.routes.collectAsStateWithLifecycle()
    var selected by remember { mutableStateOf<RouteWithPoints?>(null) }

    Box(modifier = modifier.fillMaxSize()) {
        if (routes.isEmpty()) {
            Text(
                text = "Nenhum percurso salvo ainda.",
                modifier = Modifier.padding(24.dp),
                style = MaterialTheme.typography.bodyLarge
            )
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(routes, key = { it.route.id }) { item ->
                    RouteCard(
                        item = item,
                        onOpen = { selected = item },
                        onDelete = { viewModel.deleteRoute(item.route.id) }
                    )
                }
            }
        }
    }

    selected?.let { route ->
        ModalBottomSheet(onDismissRequest = { selected = null }) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 24.dp)
            ) {
                Text(
                    text = "Trajeto",
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp)
                )
                TimelineRouteScreen(
                    routeWithPoints = route,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(520.dp)
                )
            }
        }
    }
}

@Composable
private fun RouteCard(
    item: RouteWithPoints,
    onOpen: () -> Unit,
    onDelete: () -> Unit
) {
    val route = item.route
    val formatter = remember { SimpleDateFormat("dd/MM/yyyy • HH:mm", Locale("pt", "BR")) }
    val durationMinutes = (route.elapsedMs / 60_000.0)
    val distanceKm = route.distanceMeters / 1000.0

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = formatter.format(Date(route.startedAt)),
                style = MaterialTheme.typography.titleMedium
            )
            Spacer(Modifier.height(8.dp))
            Text("Distância: %.2f km".format(Locale("pt", "BR"), distanceKm))
            Text("Duração: %.1f min".format(Locale("pt", "BR"), durationMinutes))
            Text("Máxima: ${route.maxSpeedKmh.roundToInt()} km/h")
            Text("Média: ${route.averageSpeedKmh.roundToInt()} km/h")
            Spacer(Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Button(onClick = onOpen) { Text("Ver trajeto") }
                Button(onClick = onDelete) { Text("Excluir") }
            }
        }
    }
}
