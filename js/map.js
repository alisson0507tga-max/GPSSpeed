(() => {
  'use strict';

  function markerIcon(label, className) {
    if (!window.L) return null;
    return L.divIcon({
      className: '',
      html: `<div class="route-marker ${className}">${label}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });
  }

  function validPoints(points) {
    return Array.isArray(points)
      ? points.filter((p) => Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude)))
      : [];
  }

  function addTiles(map) {
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
  }

  function renderTripMap(containerId, trip) {
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
    const map = L.map(containerId, { zoomControl: true });
    addTiles(map);

    const latlngs = points.map((p) => [Number(p.latitude), Number(p.longitude)]);
    const line = L.polyline(latlngs, { weight: 6, opacity: 0.9 }).addTo(map);
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

    if (latlngs.length === 1) map.setView(latlngs[0], 16);
    else map.fitBounds(line.getBounds(), { padding: [28, 28] });

    return map;
  }

  function renderLiveMap(containerId, initialPoints = []) {
    const container = document.getElementById(containerId);
    if (!container || !window.L) return null;

    container.innerHTML = '';
    const map = L.map(containerId, { zoomControl: true });
    addTiles(map);

    const line = L.polyline([], { weight: 6, opacity: 0.95 }).addTo(map);
    let startMarker = null;
    let currentMarker = null;
    let firstFit = true;

    const startIcon = markerIcon('A', 'route-marker-start');
    const currentIcon = markerIcon('●', 'route-marker-current');

    function update(points, follow = true) {
      const clean = validPoints(points);
      if (!clean.length) return false;

      const latlngs = clean.map((p) => [Number(p.latitude), Number(p.longitude)]);
      line.setLatLngs(latlngs);

      if (!startMarker) {
        startMarker = L.marker(latlngs[0], startIcon ? { icon: startIcon } : undefined)
          .addTo(map)
          .bindPopup('Início do percurso');
      }

      const last = latlngs[latlngs.length - 1];
      if (!currentMarker) {
        currentMarker = L.marker(last, currentIcon ? { icon: currentIcon } : undefined)
          .addTo(map)
          .bindPopup('Posição atual');
      } else {
        currentMarker.setLatLng(last);
      }

      if (firstFit) {
        firstFit = false;
        if (latlngs.length === 1) map.setView(last, 17);
        else map.fitBounds(line.getBounds(), { padding: [28, 28] });
      } else if (follow) {
        map.panTo(last, { animate: true, duration: 0.4 });
      }

      return true;
    }

    update(initialPoints, false);

    return {
      map,
      update,
      destroy() { map.remove(); }
    };
  }

  window.GPSSpeedMap = { renderTripMap, renderLiveMap };
})();
