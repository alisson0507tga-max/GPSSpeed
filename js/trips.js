(() => {
  'use strict';
  const KM=1000;

  function getTrackingState(){return window.GPSSpeedTracking?.getState?.()||null;}
  function getSpeedStats(){return window.GPSSpeedometer?.getStats?.()||{currentSpeed:0,maxSpeed:0,averageSpeed:0,samples:0};}

  function calculateMovementTimes(points,elapsedMs){const list=Array.isArray(points)?points:[];let movingMs=0;for(let i=1;i<list.length;i++){const a=list[i-1],b=list[i],dt=Math.max(0,Math.min(30000,(+b.timestamp||0)-(+a.timestamp||0))),speed=Math.max(+a.speedKmh||0,+b.speedKmh||0,+a.calculatedSpeedKmh||0,+b.calculatedSpeedKmh||0);if(speed>=3)movingMs+=dt;}const total=Math.max(0,+elapsedMs||0);movingMs=Math.min(total,movingMs);return{movingMs,stoppedMs:Math.max(0,total-movingMs)};}

  function haversine(a,b){if(!a||!b)return 0;const r=6371000,toR=v=>v*Math.PI/180,lat1=toR(+a.latitude),lat2=toR(+b.latitude),dl=toR(+b.longitude-+a.longitude),dp=toR(+b.latitude-+a.latitude),h=Math.sin(dp/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dl/2)**2;return r*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));}

  function normalizeLegacyPoints(points){
    const out=[];let cumulative=0;
    (Array.isArray(points)?points:[]).slice().sort((a,b)=>(+a.timestamp||0)-(+b.timestamp||0)).forEach((raw,i)=>{const p={...raw,latitude:+raw.latitude,longitude:+raw.longitude,timestamp:+raw.timestamp||Date.now()};if(i>0){const prev=out[i-1],seg=haversine(prev,p),dt=Math.max(1,p.timestamp-prev.timestamp),calc=seg/(dt/1000)*3.6;if(seg<=300&&calc<=220)cumulative+=seg;p.calculatedSpeedKmh=Number.isFinite(+p.calculatedSpeedKmh)?+p.calculatedSpeedKmh:calc;}else p.calculatedSpeedKmh=+p.calculatedSpeedKmh||0;p.cumulativeDistanceMeters=Number.isFinite(+p.cumulativeDistanceMeters)?+p.cumulativeDistanceMeters:cumulative;p.kilometerIndex=Math.floor(p.cumulativeDistanceMeters/KM)+1;out.push(p);});return out;
  }

  function interpolate(a,b,target){const s=+a.cumulativeDistanceMeters||0,e=+b.cumulativeDistanceMeters||s,f=Math.max(0,Math.min(1,(target-s)/Math.max(.001,e-s))),mix=(x,y)=>Number.isFinite(+x)&&Number.isFinite(+y)?+x+(+y-+x)*f:null;return{latitude:mix(a.latitude,b.latitude),longitude:mix(a.longitude,b.longitude),timestamp:Math.round(mix(a.timestamp,b.timestamp)||b.timestamp),speedKmh:mix(a.speedKmh,b.speedKmh)||0,calculatedSpeedKmh:mix(a.calculatedSpeedKmh,b.calculatedSpeedKmh)||0,accuracy:mix(a.accuracy,b.accuracy),altitude:mix(a.altitude,b.altitude),heading:mix(a.heading,b.heading),cumulativeDistanceMeters:target,kilometerIndex:Math.floor(target/KM)+1};}

  function buildKilometerSplits(points){
    const pts=normalizeLegacyPoints(points);if(pts.length<2)return[];const splits=[];let boundary=KM;
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1],b=pts[i];
      while((+b.cumulativeDistanceMeters||0)>=boundary){const km=splits.length+1,startD=(km-1)*KM,end=interpolate(a,b,boundary),start=km===1?pts[0]:splits.at(-1).endPoint,inside=pts.filter(p=>(+p.cumulativeDistanceMeters||0)>=startD&&(+p.cumulativeDistanceMeters||0)<=boundary);inside.push(end);const elapsed=Math.max(0,end.timestamp-start.timestamp),speeds=inside.map(p=>Math.max(+p.speedKmh||0,+p.calculatedSpeedKmh||0)).filter(Number.isFinite);splits.push({kilometer:km,startDistanceMeters:startD,endDistanceMeters:boundary,distanceMeters:KM,startedAt:start.timestamp,finishedAt:end.timestamp,elapsedMs:elapsed,averageSpeed:elapsed>0?(KM/(elapsed/1000))*3.6:0,maxSpeed:speeds.length?Math.max(...speeds):0,startPoint:{...start},endPoint:{...end},pointCount:inside.length});boundary+=KM;}
    }
    return splits;
  }

  function enrichTrip(trip){if(!trip||typeof trip!=='object')return trip;const points=normalizeLegacyPoints(trip.points);const splits=Array.isArray(trip.kilometerSplits)&&trip.kilometerSplits.length?trip.kilometerSplits:buildKilometerSplits(points);const distanceMeters=Number.isFinite(+trip.distanceMeters)?+trip.distanceMeters:(points.at(-1)?.cumulativeDistanceMeters||0);return{...trip,points,pointCount:points.length,distanceMeters,distanceKm:Number.isFinite(+trip.distanceKm)?+trip.distanceKm:distanceMeters/1000,kilometerSplits:splits,schemaVersion:2};}

  function buildTripRecord(trackingState,speedStats){const state=trackingState||getTrackingState(),speeds=speedStats||getSpeedStats();if(!state)throw new Error('Dados do percurso indisponíveis');const points=normalizeLegacyPoints(state.points),startedAt=Number.isFinite(state.startedAt)?state.startedAt:Date.now(),finishedAt=Number.isFinite(state.finishedAt)?state.finishedAt:Date.now(),elapsedMs=Number.isFinite(state.elapsedMs)?state.elapsedMs:0,movement=calculateMovementTimes(points,elapsedMs);return{schemaVersion:2,startedAt,finishedAt,elapsedMs,movingMs:movement.movingMs,stoppedMs:movement.stoppedMs,distanceMeters:Number.isFinite(state.distanceMeters)?state.distanceMeters:(points.at(-1)?.cumulativeDistanceMeters||0),distanceKm:Number.isFinite(state.distanceKm)?state.distanceKm:0,maxSpeed:Number.isFinite(speeds.maxSpeed)?speeds.maxSpeed:0,averageSpeed:Number.isFinite(speeds.averageSpeed)?speeds.averageSpeed:0,finalSpeed:Number.isFinite(speeds.currentSpeed)?speeds.currentSpeed:0,pointCount:points.length,points,kilometerSplits:Array.isArray(state.kilometerSplits)&&state.kilometerSplits.length?state.kilometerSplits:buildKilometerSplits(points)};}

  function mirrorTripsToRoom(trips){try{if(!window.AndroidBridge?.importLegacyTripsToRoom)return false;const list=(Array.isArray(trips)?trips:getTrips()).map(enrichTrip);window.AndroidBridge.importLegacyTripsToRoom(JSON.stringify(list));return true;}catch(error){console.warn('Não foi possível espelhar percursos no Room:',error);return false;}}

  function saveCurrentTrip(){if(!window.GPSSpeedDB)throw new Error('Banco de dados não carregado');const state=getTrackingState();if(!state||state.status!=='finished')throw new Error('Finalize o percurso antes de salvar');const saved=window.GPSSpeedDB.saveTrip(buildTripRecord(state,getSpeedStats()));mirrorTripsToRoom([saved]);window.dispatchEvent(new CustomEvent('gpsspeed:trip-saved',{detail:{trip:saved}}));return saved;}
  function getTrips(){return(window.GPSSpeedDB?.readAll?.()||[]).map(enrichTrip);}
  function getTrip(id){return enrichTrip(window.GPSSpeedDB?.getTrip?.(id)||null);}
  function deleteTrip(id){const deleted=window.GPSSpeedDB?.deleteTrip?.(id)||false;if(deleted)window.dispatchEvent(new CustomEvent('gpsspeed:trip-deleted',{detail:{id}}));return deleted;}
  function escapeXml(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
  function tripToGpx(trip){trip=enrichTrip(trip);if(!trip)throw new Error('Percurso inválido');const trackPoints=(trip.points||[]).map(p=>{const ele=Number.isFinite(+p.altitude)?`<ele>${(+p.altitude).toFixed(1)}</ele>`:'',time=+p.timestamp?`<time>${new Date(+p.timestamp).toISOString()}</time>`:'';return`<trkpt lat="${+p.latitude}" lon="${+p.longitude}">${ele}${time}</trkpt>`;}).join('');return`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GPSSpeed" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${escapeXml('GPSSpeed '+new Date(+trip.startedAt||Date.now()).toLocaleString('pt-BR'))}</name></metadata><trk><name>GPSSpeed</name><trkseg>${trackPoints}</trkseg></trk></gpx>`;}
  function buildBackup(){return JSON.stringify({app:'GPSSpeed',version:2,exportedAt:Date.now(),trips:getTrips(),settings:window.GPSSpeedSettings?.load?.()||null});}
  function restoreBackup(raw){const data=typeof raw==='string'?JSON.parse(raw):raw;if(!data||data.app!=='GPSSpeed'||!Array.isArray(data.trips))throw new Error('Backup inválido');const trips=data.trips.map(enrichTrip);window.GPSSpeedDB.writeAll(trips);mirrorTripsToRoom(trips);if(data.settings&&window.GPSSpeedSettings?.save)window.GPSSpeedSettings.save(data.settings);return trips.length;}
  function getStatistics(){const trips=getTrips();const totalDistance=trips.reduce((s,t)=>s+(+t.distanceKm||0),0),totalTime=trips.reduce((s,t)=>s+(+t.movingMs||0),0),longest=trips.reduce((m,t)=>Math.max(m,+t.distanceKm||0),0),maxSpeed=trips.reduce((m,t)=>Math.max(m,+t.maxSpeed||0),0);const weighted=trips.reduce((s,t)=>s+(+t.averageSpeed||0)*(+t.distanceKm||0),0);return{tripCount:trips.length,totalDistanceKm:totalDistance,totalMovingMs:totalTime,longestTripKm:longest,maxSpeed,overallAverageSpeed:totalDistance>0?weighted/totalDistance:0};}

  window.GPSSpeedTrips={buildTripRecord,saveCurrentTrip,getTrips,getTrip,deleteTrip,calculateMovementTimes,buildKilometerSplits,enrichTrip,tripToGpx,buildBackup,restoreBackup,getStatistics,mirrorTripsToRoom};

  window.setTimeout(()=>mirrorTripsToRoom(),1500);
})();
