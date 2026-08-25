(() => {
  'use strict';
  const STORAGE_KEY='gpsspeed.trips.v1';
  const DB_META_KEY='gpsspeed.db.meta';
  const CURRENT_SCHEMA=2;

  function readAllRaw(){try{const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return[];const data=JSON.parse(raw);return Array.isArray(data)?data:[];}catch(e){console.error('Erro ao ler viagens salvas:',e);return[];}}
  function writeAll(trips){const safe=Array.isArray(trips)?trips:[];localStorage.setItem(STORAGE_KEY,JSON.stringify(safe));localStorage.setItem(DB_META_KEY,JSON.stringify({schemaVersion:CURRENT_SCHEMA,updatedAt:Date.now()}));return safe;}
  function migrateInPlace(){const trips=readAllRaw();let changed=false;const migrated=trips.map(t=>{if(!t||typeof t!=='object')return t;const copy={...t};if(!copy.schemaVersion){copy.schemaVersion=1;changed=true;}if(!Array.isArray(copy.kilometerSplits)){copy.kilometerSplits=[];changed=true;}if(!Number.isFinite(+copy.pointCount)&&Array.isArray(copy.points)){copy.pointCount=copy.points.length;changed=true;}return copy;});if(changed)writeAll(migrated);return migrated;}
  function importNativeAutoTrips(){try{if(!window.AndroidBridge?.getAutoTimelineTrips)return 0;const raw=window.AndroidBridge.getAutoTimelineTrips(),incoming=typeof raw==='string'?JSON.parse(raw):raw;if(!Array.isArray(incoming)||!incoming.length)return 0;const trips=migrateInPlace(),known=new Set(trips.map(t=>t.id));let added=0;incoming.forEach(t=>{if(!t||typeof t!=='object'||!t.id||known.has(t.id))return;trips.unshift({...t,automatic:true,schemaVersion:2});known.add(t.id);added++;});if(added)writeAll(trips.sort((a,b)=>(+b.startedAt||0)-(+a.startedAt||0)));window.AndroidBridge?.clearImportedAutoTimelineTrips?.();return added;}catch(e){console.warn('Não foi possível importar a Linha do Tempo automática:',e);return 0;}}
  function readAll(){importNativeAutoTrips();return migrateInPlace();}
  function createId(){return`trip_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;}
  function saveTrip(trip){if(!trip||typeof trip!=='object')throw new Error('Viagem inválida');const trips=migrateInPlace(),record={id:trip.id||createId(),createdAt:trip.createdAt||Date.now(),schemaVersion:CURRENT_SCHEMA,...trip},index=trips.findIndex(i=>i.id===record.id);if(index>=0)trips[index]=record;else trips.unshift(record);writeAll(trips);return record;}
  function getTrip(id){if(!id)return null;return readAll().find(t=>t.id===id)||null;}
  function deleteTrip(id){if(!id)return false;const trips=readAll(),filtered=trips.filter(t=>t.id!==id),changed=filtered.length!==trips.length;if(changed)writeAll(filtered);return changed;}
  function clearTrips(){localStorage.removeItem(STORAGE_KEY);localStorage.removeItem(DB_META_KEY);}
  function countTrips(){return readAll().length;}
  function getMeta(){try{return JSON.parse(localStorage.getItem(DB_META_KEY)||'{}');}catch(_){return{};}}
  migrateInPlace();
  window.GPSSpeedDB={readAll,writeAll,saveTrip,getTrip,deleteTrip,clearTrips,countTrips,importNativeAutoTrips,getMeta,migrateInPlace};
})();