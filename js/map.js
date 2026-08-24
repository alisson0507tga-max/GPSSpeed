(() => {
  'use strict';

  const MAP_STYLE_KEY = 'gpsspeed.mapStyle.v1';

  function markerIcon(label, className, heading = null) {
    if (!window.L) return null;
    const rotation = Number.isFinite(Number(heading)) ? ` style="transform:rotate(${Number(heading)}deg)"` : '';
    return L.divIcon({
      className: '',
      html: `<div class="route-marker ${className}"${rotation}>${label}</div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });
  }

  function validPoints(points) {
    return Array.isArray(points)
      ? points.filter((p) => Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude)))
      : [];
  }

  function getSavedStyle() {
    try {
      const value = localStorage.getItem(MAP_STYLE_KEY);
      return ['street', 'satellite', 'hybrid'].includes(value) ? value : 'hybrid';
    } catch (_) {
      return 'hybrid';
    }
  }

  function saveStyle(style) {
    try { localStorage.setItem(MAP_STYLE_KEY, style); } catch (_) {}
  }

  function createBaseLayers() {
    const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      detectRetina: true,
      attribution: '&copy; OpenStreetMap contributors'
    });

    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      detectRetina: false,
      attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics, GIS User Community'
    });

    const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      detectRetina: false,
      attribution: 'Reference &copy; Esri'
    });

    return { street, satellite, labels };
  }

  function installBaseStyle(map, preferredStyle) {
    const layers = createBaseLayers();
    let activeStyle = null;

    function removeAll() {
      Object.values(layers).forEach((layer) => {
        if (map.hasLayer(layer)) map.removeLayer(layer);
      });
    }

    function setStyle(style) {
      const next = ['street', 'satellite', 'hybrid'].includes(style) ? style : 'hybrid';
      if (next === activeStyle) return next;
      removeAll();

      if (next === 'street') {
        layers.street.addTo(map);
      } else if (next === 'satellite') {
        layers.satellite.addTo(map);
      } else {
        layers.satellite.addTo(map);
        layers.labels.addTo(map);
      }

      activeStyle = next;
      saveStyle(next);
      map.fire('gpsspeed:basemapchange', { style: next });
      return next;
    }

    map._gpsspeedSetBaseStyle = setStyle;
    map._gpsspeedGetBaseStyle = () => activeStyle;
    setStyle(preferredStyle || getSavedStyle());
    return { setStyle, getStyle: () => activeStyle };
  }

  function addMapUtilities(map) {
    L.control.scale({ imperial: false, metric: true, position: 'bottomleft' }).addTo(map);
  }

  function addRouteLine(map, latlngs) {
    const outline = L.polyline(latlngs, {
      weight: 10,
      opacity: 0.72,
      color: '#08111f',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    const line = L.polyline(latlngs, {
      weight: 6,
      opacity: 1,
      color: '#22d3ee',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    return { outline, line };
  }

  function renderTripMap(containerId, trip, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    const points = validPoints(trip?.points);
    if (!points.length) {
      container.innerHTML = '<p class="location-card">Este percurso não possui pontos de GPS salvos.</p>';
      return null;
    }

    if (!window.L) {
      container.innerHTML = '<p class="location-card">O mapa precisa de internet para carregar nesta versão.</p>';
      return null;
    }

    container.innerHTML = '';
    const map = L.map(containerId, { zoomControl: true, preferCanvas: true });
    installBaseStyle(map, options.style);
    addMapUtilities(map);

    const latlngs = points.map((p) => [Number(p.latitude), Number(p.longitude)]);
    const route = addRouteLine(map, latlngs);
    const startIcon = markerIcon('A', 'route-marker-start');
    const endIcon = markerIcon('B', 'route-marker-end');

    L.marker(latlngs[0], startIcon ? { icon: startIcon } : undefined)
      .addTo(map)
      .bindPopup('Início do percurso');

    if (latlngs.length > 1) {
      L.marker(latlngs[latlngs.length - 1], endIcon ? { icon: endIcon } : undefined)
        .addTo(map)
        .bindPopup('Fim do percurso');
    }

    if (latlngs.length === 1) map.setView(latlngs[0], 17);
    else map.fitBounds(route.line.getBounds(), { padding: [34, 34], maxZoom: 18 });

    window.setTimeout(() => map.invalidateSize(), 100);
    return map;
  }

  function renderLiveMap(containerId, initialPoints = [], options = {}) {
    const container = document.getElementById(containerId);
    if (!container || !window.L) return null;

    container.innerHTML = '';
    const map = L.map(containerId, { zoomControl: true, preferCanvas: true });
    const base = installBaseStyle(map, options.style);
    addMapUtilities(map);

    const routeOutline = L.polyline([], {
      weight: 10,
      opacity: 0.72,
      color: '#08111f',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);
    const routeLine = L.polyline([], {
      weight: 6,
      opacity: 1,
      color: '#22d3ee',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    let startMarker = null;
    let currentMarker = null;
    let accuracyCircle = null;
    let firstFit = true;
    let followEnabled = options.follow !== false;

    const startIcon = markerIcon('A', 'route-marker-start');

    function update(points, follow = followEnabled) {
      const clean = validPoints(points);
      if (!clean.length) return false;

      const latlngs = clean.map((p) => [Number(p.latitude), Number(p.longitude)]);
      routeOutline.setLatLngs(latlngs);
      routeLine.setLatLngs(latlngs);

      if (clean.length > 1 && !startMarker) {
        startMarker = L.marker(latlngs[0], startIcon ? { icon: startIcon } : undefined)
          .addTo(map)
          .bindPopup('Início do percurso');
      }

      const lastPoint = clean[clean.length - 1];
      const last = latlngs[latlngs.length - 1];
      const heading = Number(lastPoint.heading);
      const currentIcon = markerIcon('➤', 'route-marker-current', heading);

      if (!currentMarker) {
        currentMarker = L.marker(last, currentIcon ? { icon: currentIcon } : undefined)
          .addTo(map)
          .bindPopup('Sua posição');
      } else {
        currentMarker.setLatLng(last);
        if (currentIcon) currentMarker.setIcon(currentIcon);
      }

      const accuracy = Number(lastPoint.accuracy);
      if (Number.isFinite(accuracy) && accuracy > 0) {
        if (!accuracyCircle) {
          accuracyCircle = L.circle(last, {
            radius: accuracy,
            weight: 1,
            opacity: 0.7,
            fillOpacity: 0.08,
            color: '#60a5fa'
          }).addTo(map);
        } else {
          accuracyCircle.setLatLng(last).setRadius(accuracy);
        }
      }

      if (firstFit) {
        firstFit = false;
        if (latlngs.length === 1) map.setView(last, 17);
        else map.fitBounds(routeLine.getBounds(), { padding: [34, 34], maxZoom: 18 });
      } else if (follow) {
        map.panTo(last, { animate: true, duration: 0.35 });
      }

      return true;
    }

    function recenter() {
      const clean = validPoints(initialPoints);
      const current = currentMarker?.getLatLng();
      if (current) map.setView(current, Math.max(map.getZoom(), 17), { animate: true });
      else if (clean.length) map.setView([Number(clean[clean.length - 1].latitude), Number(clean[clean.length - 1].longitude)], 17);
    }

    function setFollow(enabled) {
      followEnabled = !!enabled;
      return followEnabled;
    }

    update(initialPoints, false);
    window.setTimeout(() => map.invalidateSize(), 100);

    return {
      map,
      update,
      recenter,
      setFollow,
      isFollowing: () => followEnabled,
      setBaseStyle: base.setStyle,
      getBaseStyle: base.getStyle,
      destroy() { map.remove(); }
    };
  }

  window.GPSSpeedMap = {
    renderTripMap,
    renderLiveMap,
    getSavedStyle,
    saveStyle
  };
})();
