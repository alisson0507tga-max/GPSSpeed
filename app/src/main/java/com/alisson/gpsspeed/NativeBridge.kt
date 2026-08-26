package com.alisson.gpsspeed

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.webkit.JavascriptInterface
import com.alisson.gpsspeed.data.LegacyTripImporter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

class NativeBridge(private val context: Context) {

    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val legacyTripImporter by lazy { LegacyTripImporter(context.applicationContext) }

    private fun startServiceAction(action: String, foreground: Boolean = false) {
        val intent = Intent(context, LocationTrackingService::class.java).apply { this.action = action }
        if (foreground && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }

    @JavascriptInterface fun startTracking() = startServiceAction(LocationTrackingService.ACTION_START, true)
    @JavascriptInterface fun pauseTracking() = startServiceAction(LocationTrackingService.ACTION_PAUSE)
    @JavascriptInterface fun resumeTracking() = startServiceAction(LocationTrackingService.ACTION_RESUME, true)
    @JavascriptInterface fun stopTracking() = startServiceAction(LocationTrackingService.ACTION_STOP)
    @JavascriptInterface fun enableAutoTimeline() = startServiceAction(LocationTrackingService.ACTION_ENABLE_AUTO, true)
    @JavascriptInterface fun disableAutoTimeline() = startServiceAction(LocationTrackingService.ACTION_DISABLE_AUTO)

    @JavascriptInterface
    fun importLegacyTripsToRoom(json: String) {
        if (json.isBlank()) return
        ioScope.launch {
            runCatching { legacyTripImporter.importJson(json) }
        }
    }

    @JavascriptInterface
    fun isAutoTimelineEnabled(): Boolean {
        return context.getSharedPreferences(LocationTrackingService.PREFS, Context.MODE_PRIVATE)
            .getBoolean(LocationTrackingService.KEY_AUTO_ENABLED, false)
    }

    @JavascriptInterface
    fun getAutoTimelineTrips(): String {
        return context.getSharedPreferences(LocationTrackingService.PREFS, Context.MODE_PRIVATE)
            .getString(LocationTrackingService.KEY_AUTO_TRIPS, "[]") ?: "[]"
    }

    @JavascriptInterface
    fun clearImportedAutoTimelineTrips() {
        context.getSharedPreferences(LocationTrackingService.PREFS, Context.MODE_PRIVATE)
            .edit().putString(LocationTrackingService.KEY_AUTO_TRIPS, "[]").apply()
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
            put("autoEnabled", prefs.getBoolean(LocationTrackingService.KEY_AUTO_ENABLED, false))
            put("autoActive", prefs.getBoolean(LocationTrackingService.KEY_AUTO_ACTIVE, false))
            put("autoProgressMeters", prefs.getInt(LocationTrackingService.KEY_AUTO_PROGRESS, 0))
            put("satellitesVisible", prefs.getInt(LocationTrackingService.KEY_SATELLITES_VISIBLE, 0))
            put("satellitesUsed", prefs.getInt(LocationTrackingService.KEY_SATELLITES_USED, 0))
            if (!lastPointRaw.isNullOrBlank()) {
                try { put("lastPoint", JSONObject(lastPointRaw)) } catch (_: Exception) {}
            }
        }.toString()
    }

    @JavascriptInterface
    fun clearTrackingSnapshot() {
        val prefs = context.getSharedPreferences(LocationTrackingService.PREFS, Context.MODE_PRIVATE)
        val autoEnabled = prefs.getBoolean(LocationTrackingService.KEY_AUTO_ENABLED, false)
        val autoTrips = prefs.getString(LocationTrackingService.KEY_AUTO_TRIPS, "[]")
        val satellitesVisible = prefs.getInt(LocationTrackingService.KEY_SATELLITES_VISIBLE, 0)
        val satellitesUsed = prefs.getInt(LocationTrackingService.KEY_SATELLITES_USED, 0)
        prefs.edit().clear()
            .putBoolean(LocationTrackingService.KEY_AUTO_ENABLED, autoEnabled)
            .putString(LocationTrackingService.KEY_AUTO_TRIPS, autoTrips)
            .putInt(LocationTrackingService.KEY_SATELLITES_VISIBLE, satellitesVisible)
            .putInt(LocationTrackingService.KEY_SATELLITES_USED, satellitesUsed)
            .apply()
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
        context.startActivity(
            Intent.createChooser(send, title).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
        )
    }
}
