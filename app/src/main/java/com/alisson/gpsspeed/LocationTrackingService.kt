package com.alisson.gpsspeed

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.GnssStatus
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.*

class LocationTrackingService : Service(), LocationListener {
    companion object {
        const val ACTION_START="com.alisson.gpsspeed.START_TRACKING"
        const val ACTION_PAUSE="com.alisson.gpsspeed.PAUSE_TRACKING"
        const val ACTION_RESUME="com.alisson.gpsspeed.RESUME_TRACKING"
        const val ACTION_STOP="com.alisson.gpsspeed.STOP_TRACKING"
        const val ACTION_ENABLE_AUTO="com.alisson.gpsspeed.ENABLE_AUTO"
        const val ACTION_DISABLE_AUTO="com.alisson.gpsspeed.DISABLE_AUTO"
        const val PREFS="gpsspeed_native_tracking"
        const val KEY_STATUS="status"
        const val KEY_STARTED_AT="startedAt"
        const val KEY_POINTS="points"
        const val KEY_LAST_POINT="lastPoint"
        const val KEY_PAUSED_AT="pausedAt"
        const val KEY_TOTAL_PAUSED="totalPausedMs"
        const val KEY_AUTO_ENABLED="autoEnabled"
        const val KEY_AUTO_ACTIVE="autoActive"
        const val KEY_AUTO_STARTED_AT="autoStartedAt"
        const val KEY_AUTO_POINTS="autoPoints"
        const val KEY_AUTO_TRIPS="autoTrips"
        const val KEY_AUTO_LAST_MOVING_AT="autoLastMovingAt"
        const val KEY_AUTO_PROGRESS="autoProgressMeters"
        const val KEY_SATELLITES_VISIBLE="satellitesVisible"
        const val KEY_SATELLITES_USED="satellitesUsed"
        const val CHANNEL_ID="gpsspeed_tracking"
        const val NOTIFICATION_ID=4107
    }

    private lateinit var locationManager: LocationManager
    private var paused=false
    private var wakeLock:PowerManager.WakeLock?=null
    private var gnssRegistered=false
    private var autoMoveConfirmations=0
    private var lastAutoCandidate:Location?=null
    private val autoCandidatePoints=mutableListOf<Location>()
    private var autoCandidateStartedAt=0L
    private var autoCandidateLastMovingAt=0L
    private val autoStartSpeedKmh=4.0
    private val autoStartDistanceMeters=100.0
    private val autoStopSpeedKmh=2.5
    private val autoStopAfterMs=4*60*1000L
    private val autoCandidateResetAfterMs=90_000L
    private val maxAccuracy=70f

    private val gnssCallback=object:GnssStatus.Callback(){
        override fun onSatelliteStatusChanged(status:GnssStatus){
            var used=0
            for(i in 0 until status.satelliteCount) if(status.usedInFix(i)) used++
            getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit()
                .putInt(KEY_SATELLITES_VISIBLE,status.satelliteCount)
                .putInt(KEY_SATELLITES_USED,used).apply()
        }
    }

    override fun onCreate(){super.onCreate();locationManager=getSystemService(Context.LOCATION_SERVICE) as LocationManager;createNotificationChannel()}
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int{when(intent?.action){ACTION_START->startTracking();ACTION_PAUSE->pauseTracking();ACTION_RESUME->resumeTracking();ACTION_STOP->stopTracking();ACTION_ENABLE_AUTO->enableAutoMode();ACTION_DISABLE_AUTO->disableAutoMode();else->restoreServiceState()};return START_STICKY}

    private fun restoreServiceState(){val p=getSharedPreferences(PREFS,Context.MODE_PRIVATE);when{p.getBoolean(KEY_AUTO_ENABLED,false)->startAutoMonitoring();p.getString(KEY_STATUS,"idle")=="running"->{paused=false;acquireWakeLock();startForeground(NOTIFICATION_ID,buildNotification("Percurso em andamento"));requestUpdates(1000L)};else->stopSelf()}}
    private fun startTracking(){val p=getSharedPreferences(PREFS,Context.MODE_PRIVATE);val current=p.getString(KEY_STATUS,"idle");if(current=="idle"||current=="finished"||current=="auto-monitoring")p.edit().putString(KEY_STATUS,"running").putLong(KEY_STARTED_AT,System.currentTimeMillis()).putLong(KEY_TOTAL_PAUSED,0L).putString(KEY_POINTS,"[]").remove(KEY_LAST_POINT).remove(KEY_PAUSED_AT).apply() else p.edit().putString(KEY_STATUS,"running").remove(KEY_PAUSED_AT).apply();clearAutoCandidate();paused=false;acquireWakeLock();startForeground(NOTIFICATION_ID,buildNotification("Percurso em andamento"));requestUpdates(1000L)}
    private fun pauseTracking(){paused=true;getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().putString(KEY_STATUS,"paused").putLong(KEY_PAUSED_AT,System.currentTimeMillis()).apply();stopLocationUpdates();releaseWakeLock();startForeground(NOTIFICATION_ID,buildNotification("Percurso pausado"))}
    private fun resumeTracking(){val p=getSharedPreferences(PREFS,Context.MODE_PRIVATE);val at=p.getLong(KEY_PAUSED_AT,0L);var total=p.getLong(KEY_TOTAL_PAUSED,0L);if(at>0)total+=System.currentTimeMillis()-at;p.edit().putString(KEY_STATUS,"running").putLong(KEY_TOTAL_PAUSED,total).remove(KEY_PAUSED_AT).apply();paused=false;acquireWakeLock();startForeground(NOTIFICATION_ID,buildNotification("Percurso em andamento"));requestUpdates(1000L)}
    private fun stopTracking(){val p=getSharedPreferences(PREFS,Context.MODE_PRIVATE);if(p.getString(KEY_STATUS,"idle")=="paused"){val at=p.getLong(KEY_PAUSED_AT,0L);var total=p.getLong(KEY_TOTAL_PAUSED,0L);if(at>0)total+=System.currentTimeMillis()-at;p.edit().putLong(KEY_TOTAL_PAUSED,total).remove(KEY_PAUSED_AT).apply()};p.edit().putString(KEY_STATUS,"finished").apply();releaseWakeLock();if(p.getBoolean(KEY_AUTO_ENABLED,false))startAutoMonitoring() else{stopLocationUpdates();stopForeground(STOP_FOREGROUND_REMOVE);stopSelf()}}
    private fun enableAutoMode(){getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().putBoolean(KEY_AUTO_ENABLED,true).apply();clearAutoCandidate();startAutoMonitoring()}
    private fun disableAutoMode(){val p=getSharedPreferences(PREFS,Context.MODE_PRIVATE);if(p.getBoolean(KEY_AUTO_ACTIVE,false))finishAutoTrip(System.currentTimeMillis());p.edit().putBoolean(KEY_AUTO_ENABLED,false).putBoolean(KEY_AUTO_ACTIVE,false).putInt(KEY_AUTO_PROGRESS,0).apply();clearAutoCandidate();if(p.getString(KEY_STATUS,"idle")=="running")return;stopLocationUpdates();releaseWakeLock();stopForeground(STOP_FOREGROUND_REMOVE);stopSelf()}
    private fun startAutoMonitoring(){val p=getSharedPreferences(PREFS,Context.MODE_PRIVATE);if(!p.getBoolean(KEY_AUTO_ENABLED,false))return;if(p.getString(KEY_STATUS,"idle")!="running"&&p.getString(KEY_STATUS,"idle")!="paused")p.edit().putString(KEY_STATUS,"auto-monitoring").apply();paused=false;releaseWakeLock();startForeground(NOTIFICATION_ID,buildNotification(if(p.getBoolean(KEY_AUTO_ACTIVE,false))"Linha do Tempo: trajeto em andamento" else "Linha do Tempo pronta • inicia após 100 m"));requestUpdates(if(p.getBoolean(KEY_AUTO_ACTIVE,false))2000L else 8000L)}

    private fun registerGnss(){if(gnssRegistered||Build.VERSION.SDK_INT<Build.VERSION_CODES.N)return;if(ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED)return;try{locationManager.registerGnssStatusCallback(gnssCallback);gnssRegistered=true}catch(_:Exception){}}
    private fun unregisterGnss(){if(!gnssRegistered||Build.VERSION.SDK_INT<Build.VERSION_CODES.N)return;try{locationManager.unregisterGnssStatusCallback(gnssCallback)}catch(_:Exception){};gnssRegistered=false}
    private fun requestUpdates(intervalMs:Long){val fine=ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED,coarse=ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;if(!fine&&!coarse)return;stopLocationUpdates();registerGnss();try{if(locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER))locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER,intervalMs,0f,this) else if(locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,max(intervalMs,5000L),0f,this)}catch(_:Exception){}}
    private fun stopLocationUpdates(){try{locationManager.removeUpdates(this)}catch(_:Exception){}}

    override fun onLocationChanged(location:Location){if(paused||location.accuracy<=0f||location.accuracy>maxAccuracy)return;val p=getSharedPreferences(PREFS,Context.MODE_PRIVATE),manual=p.getString(KEY_STATUS,"idle")=="running";if(manual)recordManualPoint(location);if(p.getBoolean(KEY_AUTO_ENABLED,false)&&!manual)processAutoLocation(location)}
    private fun locationToJson(l:Location):JSONObject{val speed=if(l.hasSpeed())max(0.0,l.speed*3.6)else 0.0;return JSONObject().apply{put("type","position");put("timestamp",l.time.takeIf{it>0}?:System.currentTimeMillis());put("latitude",l.latitude);put("longitude",l.longitude);put("accuracy",l.accuracy.toDouble());put("altitude",if(l.hasAltitude())l.altitude else JSONObject.NULL);put("heading",if(l.hasBearing())l.bearing.toDouble() else JSONObject.NULL);put("speedKmh",speed);put("satellitesVisible",getSharedPreferences(PREFS,Context.MODE_PRIVATE).getInt(KEY_SATELLITES_VISIBLE,0));put("satellitesUsed",getSharedPreferences(PREFS,Context.MODE_PRIVATE).getInt(KEY_SATELLITES_USED,0))}}
    private fun recordManualPoint(l:Location){val point=locationToJson(l),p=getSharedPreferences(PREFS,Context.MODE_PRIVATE),arr=safeArray(p.getString(KEY_POINTS,"[]"));arr.put(point);p.edit().putString(KEY_LAST_POINT,point.toString()).putString(KEY_POINTS,trimArray(arr,10000).toString()).apply();updateNotification(l,"Percurso")}

    private fun processAutoLocation(l:Location){val p=getSharedPreferences(PREFS,Context.MODE_PRIVATE),speed=if(l.hasSpeed())max(0.0,l.speed*3.6)else 0.0,active=p.getBoolean(KEY_AUTO_ACTIVE,false),now=System.currentTimeMillis();if(!active){val previous=lastAutoCandidate,step=previous?.let{distanceMeters(it.latitude,it.longitude,l.latitude,l.longitude)}?:0.0,gate=max(10.0,l.accuracy.toDouble()),moving=speed>=autoStartSpeedKmh||step>=gate;if(moving){autoMoveConfirmations++;autoCandidateLastMovingAt=now;if(autoCandidatePoints.isEmpty()){previous?.let{autoCandidatePoints.add(Location(it))};if(autoCandidatePoints.isEmpty())autoCandidatePoints.add(Location(l));autoCandidateStartedAt=autoCandidatePoints.first().time.takeIf{it>0}?:now};val last=autoCandidatePoints.lastOrNull();if(last==null||distanceMeters(last.latitude,last.longitude,l.latitude,l.longitude)>=max(5.0,l.accuracy*.4)){autoCandidatePoints.add(Location(l));if(autoCandidatePoints.size>180)autoCandidatePoints.removeAt(0)};if(autoMoveConfirmations==1)requestUpdates(2500L)}else if(autoCandidatePoints.isNotEmpty()&&now-autoCandidateLastMovingAt>=autoCandidateResetAfterMs){clearAutoCandidate();requestUpdates(8000L)};lastAutoCandidate=Location(l);val start=autoCandidatePoints.firstOrNull(),displacement=start?.let{distanceMeters(it.latitude,it.longitude,l.latitude,l.longitude)}?:0.0;p.edit().putInt(KEY_AUTO_PROGRESS,displacement.toInt().coerceIn(0,100)).apply();if(autoMoveConfirmations>=2&&displacement>=autoStartDistanceMeters){val buffered=JSONArray();autoCandidatePoints.forEach{buffered.put(locationToJson(it))};val cur=locationToJson(l);val lastJson=if(buffered.length()>0)buffered.optJSONObject(buffered.length()-1)else null;if(lastJson==null||lastJson.optLong("timestamp")!=cur.optLong("timestamp"))buffered.put(cur);val started=autoCandidateStartedAt.takeIf{it>0}?:now;p.edit().putBoolean(KEY_AUTO_ACTIVE,true).putLong(KEY_AUTO_STARTED_AT,started).putLong(KEY_AUTO_LAST_MOVING_AT,now).putString(KEY_AUTO_POINTS,buffered.toString()).putString(KEY_STATUS,"auto-monitoring").putString(KEY_LAST_POINT,cur.toString()).putInt(KEY_AUTO_PROGRESS,100).apply();clearAutoCandidate();acquireWakeLock();startForeground(NOTIFICATION_ID,buildNotification("Linha do Tempo: trajeto iniciado após 100 m"));requestUpdates(2000L)}else updateNotification(l,"Linha do Tempo pronta • ${displacement.toInt().coerceIn(0,99)}/100 m");return}
        val point=locationToJson(l),points=safeArray(p.getString(KEY_AUTO_POINTS,"[]")),last=if(points.length()>0)points.optJSONObject(points.length()-1)else null,shouldAdd=last==null||distanceMeters(last.optDouble("latitude"),last.optDouble("longitude"),l.latitude,l.longitude)>=max(4.0,l.accuracy*.45);if(shouldAdd)points.put(point);if(speed>=autoStopSpeedKmh)p.edit().putLong(KEY_AUTO_LAST_MOVING_AT,now).apply();p.edit().putString(KEY_AUTO_POINTS,trimArray(points,12000).toString()).putString(KEY_LAST_POINT,point.toString()).apply();updateNotification(l,"Linha do Tempo");val lastMoving=p.getLong(KEY_AUTO_LAST_MOVING_AT,now);if(speed<autoStopSpeedKmh&&now-lastMoving>=autoStopAfterMs){finishAutoTrip(lastMoving);releaseWakeLock();requestUpdates(8000L)}}

    private fun clearAutoCandidate(){autoMoveConfirmations=0;lastAutoCandidate=null;autoCandidatePoints.clear();autoCandidateStartedAt=0;autoCandidateLastMovingAt=0;getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().putInt(KEY_AUTO_PROGRESS,0).apply()}
    private fun finishAutoTrip(finishedAt:Long){val p=getSharedPreferences(PREFS,Context.MODE_PRIVATE),points=safeArray(p.getString(KEY_AUTO_POINTS,"[]")),started=p.getLong(KEY_AUTO_STARTED_AT,finishedAt);if(points.length()>=2){var distance=0.0;var maxSpeed=0.0;var sum=0.0;var samples=0;for(i in 0 until points.length()){val q=points.optJSONObject(i)?:continue,valSpeed=q.optDouble("speedKmh",0.0).coerceAtLeast(0.0);maxSpeed=max(maxSpeed,valSpeed);if(valSpeed>=autoStopSpeedKmh){sum+=valSpeed;samples++};if(i>0){val prev=points.optJSONObject(i-1)?:continue;val seg=distanceMeters(prev.optDouble("latitude"),prev.optDouble("longitude"),q.optDouble("latitude"),q.optDouble("longitude"));if(seg in 0.0..300.0)distance+=seg}};if(distance>=20.0||finishedAt-started>=60_000L){val elapsed=max(0L,finishedAt-started),trip=JSONObject().apply{put("id","auto_${started}_${finishedAt}");put("createdAt",System.currentTimeMillis());put("startedAt",started);put("finishedAt",finishedAt);put("elapsedMs",elapsed);put("movingMs",elapsed);put("stoppedMs",0);put("distanceMeters",distance);put("distanceKm",distance/1000.0);put("maxSpeed",maxSpeed);put("averageSpeed",if(samples>0)sum/samples else 0.0);put("finalSpeed",0.0);put("pointCount",points.length());put("points",points);put("automatic",true);put("schemaVersion",2)};val trips=safeArray(p.getString(KEY_AUTO_TRIPS,"[]"));trips.put(trip);p.edit().putString(KEY_AUTO_TRIPS,trimArray(trips,500).toString()).apply()}};p.edit().putBoolean(KEY_AUTO_ACTIVE,false).remove(KEY_AUTO_STARTED_AT).remove(KEY_AUTO_LAST_MOVING_AT).putString(KEY_AUTO_POINTS,"[]").putString(KEY_STATUS,"auto-monitoring").putInt(KEY_AUTO_PROGRESS,0).apply();clearAutoCandidate();startForeground(NOTIFICATION_ID,buildNotification("Linha do Tempo pronta • inicia após 100 m"))}

    private fun updateNotification(l:Location,prefix:String){val kmh=if(l.hasSpeed())(l.speed*3.6).toInt().coerceAtLeast(0)else 0,acc=l.accuracy.toInt().coerceAtLeast(0),used=getSharedPreferences(PREFS,Context.MODE_PRIVATE).getInt(KEY_SATELLITES_USED,0);getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID,buildNotification("$prefix • $kmh km/h • GPS ${acc} m${if(used>0)" • $used sat" else ""}"))}
    private fun safeArray(raw:String?):JSONArray=try{JSONArray(raw?:"[]")}catch(_:Exception){JSONArray()}
    private fun trimArray(a:JSONArray,maxItems:Int):JSONArray{if(a.length()<=maxItems)return a;val out=JSONArray();for(i in a.length()-maxItems until a.length())out.put(a.get(i));return out}
    private fun distanceMeters(lat1:Double,lon1:Double,lat2:Double,lon2:Double):Double{val r=6371000.0,p1=Math.toRadians(lat1),p2=Math.toRadians(lat2),dp=Math.toRadians(lat2-lat1),dl=Math.toRadians(lon2-lon1),a=sin(dp/2).pow(2)+cos(p1)*cos(p2)*sin(dl/2).pow(2);return r*2*atan2(sqrt(a),sqrt(1-a))}
    private fun acquireWakeLock(){if(wakeLock?.isHeld==true)return;val pm=getSystemService(Context.POWER_SERVICE) as PowerManager;wakeLock=pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"GPSSpeed:Tracking").apply{setReferenceCounted(false);acquire(6*60*60*1000L)}}
    private fun releaseWakeLock(){try{if(wakeLock?.isHeld==true)wakeLock?.release()}catch(_:Exception){};wakeLock=null}
    override fun onProviderEnabled(provider:String){};override fun onProviderDisabled(provider:String){};@Deprecated("Deprecated in Java") override fun onStatusChanged(provider:String?,status:Int,extras:Bundle?){}
    private fun createNotificationChannel(){if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.O)getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL_ID,"Rastreamento de percurso",NotificationManager.IMPORTANCE_LOW).apply{description="Mantém o GPS ativo durante percursos e Linha do Tempo automática"})}
    private fun buildNotification(text:String)=NotificationCompat.Builder(this,CHANNEL_ID).setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("GPSSpeed").setContentText(text).setOngoing(true).setOnlyAlertOnce(true).setContentIntent(PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)).build()
    override fun onBind(intent:Intent?):IBinder?=null
    override fun onDestroy(){stopLocationUpdates();unregisterGnss();releaseWakeLock();super.onDestroy()}
}
