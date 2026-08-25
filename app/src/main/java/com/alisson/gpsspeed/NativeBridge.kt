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
    private fun startServiceAction(action:String,foreground:Boolean=false){val intent=Intent(context,LocationTrackingService::class.java).apply{this.action=action};if(foreground&&Build.VERSION.SDK_INT>=Build.VERSION_CODES.O)context.startForegroundService(intent)else context.startService(intent)}
    @JavascriptInterface fun startTracking()=startServiceAction(LocationTrackingService.ACTION_START,true)
    @JavascriptInterface fun pauseTracking()=startServiceAction(LocationTrackingService.ACTION_PAUSE)
    @JavascriptInterface fun resumeTracking()=startServiceAction(LocationTrackingService.ACTION_RESUME,true)
    @JavascriptInterface fun stopTracking()=startServiceAction(LocationTrackingService.ACTION_STOP)
    @JavascriptInterface fun enableAutoTimeline()=startServiceAction(LocationTrackingService.ACTION_ENABLE_AUTO,true)
    @JavascriptInterface fun disableAutoTimeline()=startServiceAction(LocationTrackingService.ACTION_DISABLE_AUTO)
    @JavascriptInterface fun isAutoTimelineEnabled():Boolean=context.getSharedPreferences(LocationTrackingService.PREFS,Context.MODE_PRIVATE).getBoolean(LocationTrackingService.KEY_AUTO_ENABLED,false)
    @JavascriptInterface fun getAutoTimelineTrips():String=context.getSharedPreferences(LocationTrackingService.PREFS,Context.MODE_PRIVATE).getString(LocationTrackingService.KEY_AUTO_TRIPS,"[]")?:"[]"
    @JavascriptInterface fun clearImportedAutoTimelineTrips(){context.getSharedPreferences(LocationTrackingService.PREFS,Context.MODE_PRIVATE).edit().putString(LocationTrackingService.KEY_AUTO_TRIPS,"[]").apply()}

    @JavascriptInterface fun getTrackingSnapshot():String{
        val p=context.getSharedPreferences(LocationTrackingService.PREFS,Context.MODE_PRIVATE)
        val last=p.getString(LocationTrackingService.KEY_LAST_POINT,null)
        return JSONObject().apply{
            put("status",p.getString(LocationTrackingService.KEY_STATUS,"idle"));put("startedAt",p.getLong(LocationTrackingService.KEY_STARTED_AT,0L));put("pausedAt",p.getLong(LocationTrackingService.KEY_PAUSED_AT,0L));put("totalPausedMs",p.getLong(LocationTrackingService.KEY_TOTAL_PAUSED,0L));put("points",JSONArray(p.getString(LocationTrackingService.KEY_POINTS,"[]")));put("autoEnabled",p.getBoolean(LocationTrackingService.KEY_AUTO_ENABLED,false));put("autoActive",p.getBoolean(LocationTrackingService.KEY_AUTO_ACTIVE,false));put("autoProgressMeters",p.getInt(LocationTrackingService.KEY_AUTO_PROGRESS,0));put("satellitesVisible",p.getInt(LocationTrackingService.KEY_SATELLITES_VISIBLE,0));put("satellitesUsed",p.getInt(LocationTrackingService.KEY_SATELLITES_USED,0));if(!last.isNullOrBlank())try{put("lastPoint",JSONObject(last))}catch(_:Exception){}
        }.toString()
    }

    @JavascriptInterface fun clearTrackingSnapshot(){val p=context.getSharedPreferences(LocationTrackingService.PREFS,Context.MODE_PRIVATE),autoEnabled=p.getBoolean(LocationTrackingService.KEY_AUTO_ENABLED,false),autoTrips=p.getString(LocationTrackingService.KEY_AUTO_TRIPS,"[]"),sv=p.getInt(LocationTrackingService.KEY_SATELLITES_VISIBLE,0),su=p.getInt(LocationTrackingService.KEY_SATELLITES_USED,0);p.edit().clear().putBoolean(LocationTrackingService.KEY_AUTO_ENABLED,autoEnabled).putString(LocationTrackingService.KEY_AUTO_TRIPS,autoTrips).putInt(LocationTrackingService.KEY_SATELLITES_VISIBLE,sv).putInt(LocationTrackingService.KEY_SATELLITES_USED,su).apply()}
    @JavascriptInterface fun copyText(label:String,text:String){val clipboard=context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager;clipboard.setPrimaryClip(ClipData.newPlainText(label,text))}
    @JavascriptInterface fun shareText(title:String,text:String,mimeType:String){val send=Intent(Intent.ACTION_SEND).apply{type=if(mimeType.isBlank())"text/plain" else mimeType;putExtra(Intent.EXTRA_SUBJECT,title);putExtra(Intent.EXTRA_TEXT,text);addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)};context.startActivity(Intent.createChooser(send,title).apply{addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)})}
}
