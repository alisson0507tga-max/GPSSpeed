package com.alisson.gpsspeed.ui.timeline

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.alisson.gpsspeed.data.local.AppDatabase
import com.alisson.gpsspeed.data.local.RouteWithPoints
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class TimelineViewModel(application: Application) : AndroidViewModel(application) {
    private val dao = AppDatabase.getInstance(application).routeDao()

    val routes: StateFlow<List<RouteWithPoints>> = dao.observeRoutesWithPoints()
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = emptyList()
        )

    fun deleteRoute(routeId: String) {
        viewModelScope.launch {
            dao.deleteRouteById(routeId)
        }
    }
}
