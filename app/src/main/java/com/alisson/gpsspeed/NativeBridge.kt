package com.alisson.gpsspeed

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

class NativeBridge(private val context: Context) {

    @JavascriptInterface
    fun startTracking() {
        val intent = Intent(context, LocationTrackingService::class.java).apply { action = LocationTrackingService.ACTION_START }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
        else context.startService(intent)
    }

    @JavascriptInterface
    fun pauseTracking() {
        context.startService(Intent(context, LocationTrackingService::class.java).apply { action = LocationTrackingService.ACTION_PAUSE })
    }

    @JavascriptInterface
    fun resumeTracking() {
        val intent = Intent(context, LocationTrackingService::class.java).apply { action = LocationTrackingService.ACTION_RESUME }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
        else context.startService(intent)
    }

    @JavascriptInterface
    fun stopTracking() {
        context.startService(Intent(context, LocationTrackingService::class.java).apply { action = LocationTrackingService.ACTION_STOP })
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
        context.getSharedPreferences(LocationTrackingService.PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    @JavascriptInterface
    fun copyText(label: String, text: String) {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
    }

    @JavascriptInterface
    fun shareText(title: String, text: String, mimeType: String) {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = if (mimeType.isBlank()) "text/plain" else mimeType
            putExtra(Intent.EXTRA_SUBJECT, title)
            putExtra(Intent.EXTRA_TEXT, text)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(Intent.createChooser(send, title).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) })
    }
}
