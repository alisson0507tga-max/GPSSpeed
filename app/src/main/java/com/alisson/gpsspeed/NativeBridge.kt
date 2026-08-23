package com.alisson.gpsspeed

import android.content.Context
import android.content.Intent
import android.os.Build
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

class NativeBridge(private val context: Context) {

    @JavascriptInterface
    fun startTracking() {
        val intent = Intent(context, LocationTrackingService::class.java).apply {
            action = LocationTrackingService.ACTION_START
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
        else context.startService(intent)
    }

    @JavascriptInterface
    fun pauseTracking() {
        val intent = Intent(context, LocationTrackingService::class.java).apply {
            action = LocationTrackingService.ACTION_PAUSE
        }
        context.startService(intent)
    }

    @JavascriptInterface
    fun resumeTracking() {
        val intent = Intent(context, LocationTrackingService::class.java).apply {
            action = LocationTrackingService.ACTION_RESUME
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
        else context.startService(intent)
    }

    @JavascriptInterface
    fun stopTracking() {
        val intent = Intent(context, LocationTrackingService::class.java).apply {
            action = LocationTrackingService.ACTION_STOP
        }
        context.startService(intent)
    }

    @JavascriptInterface
    fun getTrackingSnapshot(): String {
        val prefs = context.getSharedPreferences(LocationTrackingService.PREFS, Context.MODE_PRIVATE)
        val lastPointRaw = prefs.getString(LocationTrackingService.KEY_LAST_POINT, null)
        return JSONObject().apply {
            put("status", prefs.getString(LocationTrackingService.KEY_STATUS, "idle"))
            put("startedAt", prefs.getLong(LocationTrackingService.KEY_STARTED_AT, 0L))
            put("pausedAt", prefs.getLong(LocationTrackingService.KEY_PAUSED_AT, 0L))
            put("totalPausedMs", prefs.getLong(LocationTrackingService.KEY_TOTAL_PAUSED, 0L))
            put("points", JSONArray(prefs.getString(LocationTrackingService.KEY_POINTS, "[]")))
            if (!lastPointRaw.isNullOrBlank()) {
                try { put("lastPoint", JSONObject(lastPointRaw)) } catch (_: Exception) {}
            }
        }.toString()
    }

    @JavascriptInterface
    fun clearTrackingSnapshot() {
        context.getSharedPreferences(LocationTrackingService.PREFS, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply()
    }
}
