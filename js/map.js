(() => {
  'use strict';

  const MAP_STYLE_KEY = 'gpsspeed.mapStyle.v1';

  function markerIcon(label, className, heading = null) {
    if (!window.L) return null;
    const rotation = Number.isFinite(Number(heading)) ? ` style="transform:rotate(${Number(heading)}deg)"` : '';
    return L.divIcon({ className:'', html:`<div class="route-marker ${className}"${rotation}>${label}</div>`, iconSize:[38,38], iconAnchor:[19,19] });
  }

  function validPoints(points) {
    return Array.isArray(points) ? points.filter(p => Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude))) : [];
  }

  function getSavedStyle(){ try { const v=localStorage.getItem(MAP_STYLE_KEY); return ['street','satellite','hybrid'].includes(v)?v:'hybrid'; } catch(_){ return 'hybrid'; } }
  function saveStyle(style){ try{ localStorage.setItem(MAP_STYLE_KEY,style); }catch(_){} }

  function createBaseLayers(){
    const street=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,detectRetina:true,attribution:'&copy; OpenStreetMap contributors'});
    const satellite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles &copy; Esri, Maxar, Earthstar Geographics, GIS User Community'});
    const labels=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Reference &copy; Esri'});
    return {street,satellite,labels};
  }

  function installBaseStyle(map,preferredStyle){
    const layers=createBaseLayers(); let activeStyle=null;
    function setStyle(style){
      const next=['street','satellite','hybrid'].includes(style)?style:'hybrid';
      if(next===activeStyle)return next;
      Object.values(layers).forEach(l=>{if(map.hasLayer(l))map.removeLayer(l);});
      if(next==='street')layers.street.addTo(map); else {layers.satellite.addTo(map); if(next==='hybrid')layers.labels.addTo(map);}
      activeStyle=next; saveStyle(next); return next;
    }
    map._gpsspeedSetBaseStyle=setStyle; map._gpsspeedGetBaseStyle=()=>activeStyle; setStyle(preferredStyle||getSavedStyle());
    return {setStyle,getStyle:()=>activeStyle};
  }

  function addMapUtilities(map){ L.control.scale({imperial:false,metric:true,position:'bottomleft'}).addTo(map); }

  function addRouteLine(map,latlngs){
    const outline=L.polyline(latlngs,{weight:10,opacity:.72,color:'#08111f',lineCap:'round',lineJoin:'round'}).addTo(map);
    const line=L.polyline(latlngs,{weight:6,opacity:1,color:'#22d3ee',lineCap:'round',lineJoin:'round'}).addTo(map);
    return {outline,line};
  }

  function installRotation(map, container){
    let bearing=0, dragging=false, startX=0, startBearing=0;
    function apply(){ container.style.setProperty('--map-bearing',`${bearing}deg`); const pane=container.querySelector('.leaflet-map-pane'); if(pane){pane.style.transformOrigin='50% 50%'; pane.style.rotate=`${bearing}deg`;} }
    function setBearing(value){ bearing=((Number(value)||0)%360+360)%360; apply(); return bearing; }
    function reset(){ return setBearing(0); }
    container.addEventListener('pointerdown',e=>{ if(!e.isPrimary || e.pointerType==='mouse' && e.button!==0)return; if(!e.target.closest('.leaflet-container'))return; if(e.target.closest('.leaflet-control'))return; if(e.pointerType==='touch' && e.width<20)return; dragging=true; startX=e.clientX; startBearing=bearing; });
    container.addEventListener('pointermove',e=>{ if(!dragging)return; const dx=e.clientX-startX; if(Math.abs(dx)>8)setBearing(startBearing+dx*.65); });
    const stop=()=>{dragging=false;}; container.addEventListener('pointerup',stop); container.addEventListener('pointercancel',stop);
    return {setBearing,getBearing:()=>bearing,rotateBy:d=>setBearing(bearing+d),reset};
  }

  function routePopup(point,index,total){
    const speed=Number(point.speedKmh); const accuracy=Number(point.accuracy); const time=Number(point.timestamp);
    return `<strong>Ponto ${index+1}/${total}</strong><br>${Number.isFinite(speed)?speed.toFixed(1)+' km/h':'Velocidade --'}${Number.isFinite(accuracy)?'<br>Precisão '+Math.round(accuracy)+' m':''}${time?'<br>'+new Date(time).toLocaleTimeString('pt-BR'):''}`;
  }

  function addDetailPoints(map,points){
    if(points.length<2)return;
    const step=Math.max(1,Math.ceil(points.length/40));
    for(let i=0;i<points.length;i+=step){ const p=points[i]; L.circleMarker([+p.latitude,+p.longitude],{radius:4,weight:1,opacity:.85,fillOpacity:.7}).addTo(map).bindPopup(routePopup(p,i,points.length)); }
  }

  function renderTripMap(containerId,trip,options={}){
    const container=document.getElementById(containerId); if(!container)return null;
    const points=validPoints(trip?.points); if(!points.length){container.innerHTML='<p class="location-card">Este percurso não possui pontos de GPS salvos.</p>';return null;}
    if(!window.L){container.innerHTML='<p class="location-card">O mapa precisa de internet para carregar nesta versão.</p>';return null;}
    container.innerHTML=''; const map=L.map(containerId,{zoomControl:true,preferCanvas:true}); const base=installBaseStyle(map,options.style); addMapUtilities(map); const rotation=installRotation(map,container);
    const latlngs=points.map(p=>[+p.latitude,+p.longitude]); const route=addRouteLine(map,latlngs);
    L.marker(latlngs[0],{icon:markerIcon('A','route-marker-start')}).addTo(map).bindPopup('Início do percurso');
    if(latlngs.length>1)L.marker(latlngs.at(-1),{icon:markerIcon('B','route-marker-end')}).addTo(map).bindPopup('Fim do percurso');
    addDetailPoints(map,points);
    if(latlngs.length===1)map.setView(latlngs[0],17); else map.fitBounds(route.line.getBounds(),{padding:[34,34],maxZoom:18});
    setTimeout(()=>map.invalidateSize(),100);
    map._gpsspeedRotation=rotation; map._gpsspeedBase=base;
    return map;
  }

  function renderLiveMap(containerId,initialPoints=[],options={}){
    const container=document.getElementById(containerId); if(!container||!window.L)return null;
    container.innerHTML=''; const map=L.map(containerId,{zoomControl:true,preferCanvas:true}); const base=installBaseStyle(map,options.style); addMapUtilities(map); const rotation=installRotation(map,container);
    const routeOutline=L.polyline([],{weight:10,opacity:.72,color:'#08111f',lineCap:'round',lineJoin:'round'}).addTo(map);
    const routeLine=L.polyline([],{weight:6,opacity:1,color:'#22d3ee',lineCap:'round',lineJoin:'round'}).addTo(map);
    let startMarker=null,currentMarker=null,accuracyCircle=null,firstFit=true,followEnabled=options.follow!==false;
    function update(points,follow=followEnabled){
      const clean=validPoints(points); if(!clean.length)return false; const latlngs=clean.map(p=>[+p.latitude,+p.longitude]); routeOutline.setLatLngs(latlngs); routeLine.setLatLngs(latlngs);
      if(clean.length>1&&!startMarker)startMarker=L.marker(latlngs[0],{icon:markerIcon('A','route-marker-start')}).addTo(map).bindPopup('Início do percurso');
      const p=clean.at(-1),last=latlngs.at(-1),icon=markerIcon('➤','route-marker-current',Number(p.heading));
      if(!currentMarker)currentMarker=L.marker(last,{icon}).addTo(map).bindPopup('Sua posição'); else {currentMarker.setLatLng(last);currentMarker.setIcon(icon);}
      const acc=Number(p.accuracy); if(Number.isFinite(acc)&&acc>0){if(!accuracyCircle)accuracyCircle=L.circle(last,{radius:acc,weight:1,opacity:.7,fillOpacity:.08,color:'#60a5fa'}).addTo(map);else accuracyCircle.setLatLng(last).setRadius(acc);}
      if(firstFit){firstFit=false;if(latlngs.length===1)map.setView(last,17);else map.fitBounds(routeLine.getBounds(),{padding:[34,34],maxZoom:18});}else if(follow)map.panTo(last,{animate:true,duration:.35}); return true;
    }
    function recenter(){const c=currentMarker?.getLatLng();if(c)map.setView(c,Math.max(map.getZoom(),17),{animate:true});}
    function setFollow(v){followEnabled=!!v;return followEnabled;}
    update(initialPoints,false); setTimeout(()=>map.invalidateSize(),100);
    return {map,update,recenter,setFollow,isFollowing:()=>followEnabled,setBaseStyle:base.setStyle,getBaseStyle:base.getStyle,setBearing:rotation.setBearing,getBearing:rotation.getBearing,rotateBy:rotation.rotateBy,resetBearing:rotation.reset,destroy(){map.remove();}};
  }

  window.GPSSpeedMap={renderTripMap,renderLiveMap,getSavedStyle,saveStyle};
})();