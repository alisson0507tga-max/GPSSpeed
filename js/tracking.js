(() => {
  'use strict';

  const ACTIVE_KEY = 'gpsspeed.activeTrip.v3';
  const LEGACY_ACTIVE_KEY = 'gpsspeed.activeTrip.v2';
  const KM_METERS = 1000;

  const state = {
    status: 'idle', startedAt: null, pausedAt: null, totalPausedMs: 0, finishedAt: null,
    points: [], distanceMeters: 0, lastAcceptedPoint: null, pendingPoint: null,
    movementConfirmations: 0, unsubscribeGps: null, kilometerSplits: []
  };

  const MAX_ACCURACY_METERS = 70;
  const MAX_JUMP_METERS = 300;
  const STATIONARY_SPEED_KMH = 3;
  const MAX_PLAUSIBLE_SPEED_KMH = 220;
  const REQUIRED_MOVEMENT_CONFIRMATIONS = 2;

  const toRadians = v => v * Math.PI / 180;
  function distanceBetween(a,b){ if(!a||!b)return 0; const r=6371000,lat1=toRadians(+a.latitude),lat2=toRadians(+b.latitude),dLat=toRadians(+b.latitude-+a.latitude),dLon=toRadians(+b.longitude-+a.longitude); const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2; return r*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h)); }
  function isValidPoint(p){ if(!p||(p.type&&p.type!=='position'))return false; if(!Number.isFinite(+p.latitude)||!Number.isFinite(+p.longitude))return false; if(+p.latitude < -90||+p.latitude>90||+p.longitude < -180||+p.longitude>180)return false; const a=+p.accuracy; return !(Number.isFinite(a)&&a>MAX_ACCURACY_METERS); }
  function dynamicMinimumDistance(a,b){ const aa=Number.isFinite(+a?.accuracy)?+a.accuracy:10,ab=Number.isFinite(+b?.accuracy)?+b.accuracy:10; return Math.max(4,Math.min(20,Math.max(aa,ab)*.65)); }
  function segmentSpeedKmh(a,b,d){ const dt=Math.max(1,(+b.timestamp||Date.now())-(+a.timestamp||Date.now())); return d/(dt/1000)*3.6; }

  function updateDistanceUI(){ const el=document.getElementById('distance'); if(el)el.textContent=`${(state.distanceMeters/1000).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})} km`; updateKmUI(); }
  function updateKmUI(){
    const kmEl=document.getElementById('currentKm'); if(!kmEl)return;
    const index=Math.floor(state.distanceMeters/KM_METERS)+1;
    const splitStart=(index-1)*KM_METERS;
    const progress=Math.max(0,state.distanceMeters-splitStart);
    kmEl.textContent=`KM ${index} • ${Math.round(progress)} / 1000 m`;
    const avgEl=document.getElementById('currentKmAvg'),maxEl=document.getElementById('currentKmMax');
    const current=calculateCurrentKilometer();
    if(avgEl)avgEl.textContent=`${Math.round(current.averageSpeed||0)} km/h`;
    if(maxEl)maxEl.textContent=`${Math.round(current.maxSpeed||0)} km/h`;
  }
  function emit(name,detail={}){ window.dispatchEvent(new CustomEvent(name,{detail:{...detail,state:getState()}})); }

  function normalizePoint(point){
    const speed=+point.speedKmh,raw=+point.rawSpeedKmh;
    return { latitude:+point.latitude, longitude:+point.longitude, accuracy:Number.isFinite(+point.accuracy)?+point.accuracy:null,
      altitude:Number.isFinite(+point.altitude)?+point.altitude:null, heading:Number.isFinite(+point.heading)?+point.heading:null,
      speedKmh:Number.isFinite(speed)?Math.max(0,speed):0, rawSpeedKmh:Number.isFinite(raw)?Math.max(0,raw):(Number.isFinite(speed)?Math.max(0,speed):0),
      calculatedSpeedKmh:0, timestamp:Number.isFinite(+point.timestamp)?+point.timestamp:Date.now(), cumulativeDistanceMeters:state.distanceMeters,
      kilometerIndex:Math.floor(state.distanceMeters/KM_METERS)+1 };
  }

  function saveCheckpoint(){ if(state.status==='idle')return; try{ localStorage.setItem(ACTIVE_KEY,JSON.stringify({version:3,status:state.status,startedAt:state.startedAt,pausedAt:state.pausedAt,totalPausedMs:state.totalPausedMs,finishedAt:state.finishedAt,distanceMeters:state.distanceMeters,points:state.points,kilometerSplits:state.kilometerSplits})); }catch(e){console.warn('Checkpoint não pôde ser salvo:',e);} }
  function clearCheckpoint(){ try{localStorage.removeItem(ACTIVE_KEY);localStorage.removeItem(LEGACY_ACTIVE_KEY);}catch(_){} }
  function getCheckpoint(){ try{let raw=localStorage.getItem(ACTIVE_KEY); if(!raw)raw=localStorage.getItem(LEGACY_ACTIVE_KEY); return raw?JSON.parse(raw):null;}catch(_){return null;} }

  function interpolatePoint(a,b,targetDistance){
    const start=+a.cumulativeDistanceMeters||0,end=+b.cumulativeDistanceMeters||start; const span=Math.max(.001,end-start); const f=Math.max(0,Math.min(1,(targetDistance-start)/span));
    const mix=(x,y)=>Number.isFinite(+x)&&Number.isFinite(+y)?+x+(+y-+x)*f:null;
    return {latitude:mix(a.latitude,b.latitude),longitude:mix(a.longitude,b.longitude),accuracy:mix(a.accuracy,b.accuracy),altitude:mix(a.altitude,b.altitude),heading:mix(a.heading,b.heading),speedKmh:mix(a.speedKmh,b.speedKmh)||0,rawSpeedKmh:mix(a.rawSpeedKmh,b.rawSpeedKmh)||0,calculatedSpeedKmh:mix(a.calculatedSpeedKmh,b.calculatedSpeedKmh)||0,timestamp:Math.round(mix(a.timestamp,b.timestamp)||b.timestamp),cumulativeDistanceMeters:targetDistance,kilometerIndex:Math.floor(targetDistance/KM_METERS)+1};
  }

  function calculateSplit(kmNumber,startDistance,endDistance,startPoint,endPoint,points){
    const startAt=+startPoint.timestamp||0,endAt=+endPoint.timestamp||startAt,elapsedMs=Math.max(0,endAt-startAt);
    const speeds=points.map(p=>Math.max(+p.speedKmh||0,+p.calculatedSpeedKmh||0)).filter(Number.isFinite);
    const distance=Math.max(0,endDistance-startDistance); const avg=elapsedMs>0?(distance/(elapsedMs/1000))*3.6:0;
    return { kilometer:kmNumber,startDistanceMeters:startDistance,endDistanceMeters:endDistance,distanceMeters:distance,startedAt:startAt,finishedAt:endAt,elapsedMs,averageSpeed:Number.isFinite(avg)?avg:0,maxSpeed:speeds.length?Math.max(...speeds):0,startPoint:{...startPoint},endPoint:{...endPoint},pointCount:points.length };
  }

  function updateKilometerSplits(previous,current){
    if(!previous||!current)return;
    const oldD=+previous.cumulativeDistanceMeters||0,newD=+current.cumulativeDistanceMeters||oldD;
    let boundary=(state.kilometerSplits.length+1)*KM_METERS;
    while(newD>=boundary){
      const km=state.kilometerSplits.length+1,startD=(km-1)*KM_METERS;
      let startPoint=state.points.find(p=>(+p.cumulativeDistanceMeters||0)>=startD) || state.points[0] || previous;
      if(km>1)startPoint=state.kilometerSplits[km-2].endPoint;
      const endPoint=interpolatePoint(previous,current,boundary);
      const splitPoints=state.points.filter(p=>(+p.cumulativeDistanceMeters||0)>=startD && (+p.cumulativeDistanceMeters||0)<=boundary); splitPoints.push(endPoint);
      const split=calculateSplit(km,startD,boundary,startPoint,endPoint,splitPoints); state.kilometerSplits.push(split); emit('gpsspeed:kilometer-complete',{split}); boundary=(state.kilometerSplits.length+1)*KM_METERS;
    }
  }

  function calculateCurrentKilometer(){
    const km=state.kilometerSplits.length+1,startD=(km-1)*KM_METERS,endD=state.distanceMeters;
    const points=state.points.filter(p=>(+p.cumulativeDistanceMeters||0)>=startD); const start=state.kilometerSplits.length?state.kilometerSplits.at(-1).endPoint:(points[0]||null); const end=points.at(-1)||start;
    if(!start||!end)return {kilometer:km,distanceMeters:0,averageSpeed:0,maxSpeed:0,elapsedMs:0};
    return calculateSplit(km,startD,endD,start,end,points);
  }

  function storePoint(normalized,addDistance=0,options={}){
    const previous=state.lastAcceptedPoint;
    if(addDistance>0)state.distanceMeters+=addDistance;
    normalized.cumulativeDistanceMeters=state.distanceMeters;
    normalized.kilometerIndex=Math.floor(state.distanceMeters/KM_METERS)+1;
    if(previous&&addDistance>0) normalized.calculatedSpeedKmh=segmentSpeedKmh(previous,normalized,addDistance);
    const gpsSpeed=+normalized.speedKmh||0,calc=+normalized.calculatedSpeedKmh||0;
    if(gpsSpeed<=0 && calc>0 && calc<MAX_PLAUSIBLE_SPEED_KMH) normalized.speedKmh=calc;
    state.points.push(normalized); state.lastAcceptedPoint=normalized; state.pendingPoint=null; state.movementConfirmations=0;
    updateKilometerSplits(previous,normalized); updateDistanceUI(); if(options.persist!==false)saveCheckpoint(); if(options.emit!==false)emit('gpsspeed:tracking-point',{point:normalized,currentKilometer:calculateCurrentKilometer()}); return true;
  }

  function acceptPoint(point,options={}){
    if(state.status!=='running'||!isValidPoint(point))return false; const normalized=normalizePoint(point); if(!state.lastAcceptedPoint)return storePoint(normalized,0,options);
    const segment=distanceBetween(state.lastAcceptedPoint,normalized),minD=dynamicMinimumDistance(state.lastAcceptedPoint,normalized),calc=segmentSpeedKmh(state.lastAcceptedPoint,normalized,segment);
    if(segment>MAX_JUMP_METERS||calc>MAX_PLAUSIBLE_SPEED_KMH){state.pendingPoint=null;state.movementConfirmations=0;return false;}
    if(normalized.speedKmh<STATIONARY_SPEED_KMH&&segment<minD*1.8){state.pendingPoint=null;state.movementConfirmations=0;return false;}
    if(segment<minD)return false;
    if(!state.pendingPoint){state.pendingPoint=normalized;state.movementConfirmations=1;return false;}
    const cd=distanceBetween(state.pendingPoint,normalized),cm=dynamicMinimumDistance(state.pendingPoint,normalized);
    if(cd>=cm||normalized.speedKmh>=STATIONARY_SPEED_KMH)state.movementConfirmations++; else{state.pendingPoint=normalized;state.movementConfirmations=1;return false;}
    if(state.movementConfirmations<REQUIRED_MOVEMENT_CONFIRMATIONS){state.pendingPoint=normalized;return false;}
    return storePoint(normalized,segment,options);
  }

  function ensureGpsSubscription(){ if(state.unsubscribeGps||!window.GPSSpeedGPS)return; state.unsubscribeGps=window.GPSSpeedGPS.subscribe(payload=>{if(payload?.type==='position')acceptPoint(payload);}); }
  function start(){ if(state.status==='running')return getState(); if(state.status==='paused')return resume(); Object.assign(state,{status:'running',startedAt:Date.now(),pausedAt:null,totalPausedMs:0,finishedAt:null,points:[],distanceMeters:0,lastAcceptedPoint:null,pendingPoint:null,movementConfirmations:0,kilometerSplits:[]}); updateDistanceUI();ensureGpsSubscription();window.GPSSpeedGPS?.start();saveCheckpoint();emit('gpsspeed:tracking-start');return getState(); }
  function pause(){ if(state.status!=='running')return getState();state.status='paused';state.pausedAt=Date.now();state.pendingPoint=null;state.movementConfirmations=0;saveCheckpoint();emit('gpsspeed:tracking-pause');return getState(); }
  function resume(){ if(state.status!=='paused')return getState();if(state.pausedAt)state.totalPausedMs+=Date.now()-state.pausedAt;state.pausedAt=null;state.status='running';state.pendingPoint=null;state.movementConfirmations=0;saveCheckpoint();emit('gpsspeed:tracking-resume');return getState(); }
  function finish(){ if(!['running','paused'].includes(state.status))return getState();const now=Date.now();if(state.status==='paused'&&state.pausedAt){state.totalPausedMs+=now-state.pausedAt;state.pausedAt=null;}state.status='finished';state.finishedAt=now;saveCheckpoint();const result=getState();emit('gpsspeed:tracking-finish',{trip:result});return result; }
  function reset(){ Object.assign(state,{status:'idle',startedAt:null,pausedAt:null,totalPausedMs:0,finishedAt:null,points:[],distanceMeters:0,lastAcceptedPoint:null,pendingPoint:null,movementConfirmations:0,kilometerSplits:[]});updateDistanceUI();clearCheckpoint();emit('gpsspeed:tracking-reset'); }

  function restoreFromSnapshot(snapshot){
    if(!snapshot||!['running','paused'].includes(snapshot.status))return false; const incoming=Array.isArray(snapshot.points)?snapshot.points:[];
    Object.assign(state,{status:'running',startedAt:+snapshot.startedAt||Date.now(),pausedAt:null,totalPausedMs:+snapshot.totalPausedMs||0,finishedAt:null,points:[],distanceMeters:0,lastAcceptedPoint:null,pendingPoint:null,movementConfirmations:0,kilometerSplits:[]});
    incoming.slice().sort((a,b)=>(+a.timestamp||0)-(+b.timestamp||0)).forEach(p=>acceptPoint({type:'position',...p},{persist:false,emit:false}));
    if(snapshot.status==='paused'){state.status='paused';state.pausedAt=+snapshot.pausedAt||Date.now();}updateDistanceUI();saveCheckpoint();emit('gpsspeed:tracking-restored',{recoveredPoints:incoming.length});return true;
  }
  function restoreCheckpoint(){const cp=getCheckpoint();return cp&&['running','paused'].includes(cp.status)?restoreFromSnapshot(cp):false;}
  function getElapsedMs(){if(!state.startedAt)return 0;const end=state.finishedAt||Date.now();let p=state.totalPausedMs;if(state.status==='paused'&&state.pausedAt)p+=end-state.pausedAt;return Math.max(0,end-state.startedAt-p);}
  function getState(){return {status:state.status,startedAt:state.startedAt,pausedAt:state.pausedAt,finishedAt:state.finishedAt,totalPausedMs:state.totalPausedMs,elapsedMs:getElapsedMs(),distanceMeters:state.distanceMeters,distanceKm:state.distanceMeters/1000,points:state.points.map(p=>({...p})),kilometerSplits:state.kilometerSplits.map(s=>({...s,startPoint:{...s.startPoint},endPoint:{...s.endPoint}})),currentKilometer:{...calculateCurrentKilometer()}};}

  ensureGpsSubscription();updateDistanceUI();
  window.GPSSpeedTracking={start,pause,resume,finish,reset,acceptPoint,getState,getElapsedMs,distanceBetween,saveCheckpoint,clearCheckpoint,getCheckpoint,restoreCheckpoint,restoreFromSnapshot,calculateCurrentKilometer};
})();