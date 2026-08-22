(() => {
  'use strict';

  function renderTripMap(containerId, trip) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    const points = Array.isArray(trip?.points) ? trip.points.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) : [];
    if (!points.length) {
      container.innerHTML = '<p class="location-card">Este percurso não possui pontos de GPS salvos.</p>';
      return null;
    }

    if (!window.L) {
      container.innerHTML = '<p class="location-card">O mapa precisa de internet para carregar nesta versão.</p>';
      return null;
    }

    const map = L.map(containerId);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    const latlngs = points.map((p) => [p.latitude, p.longitude]);
    const line = L.polyline(latlngs, { weight: 5 }).addTo(map);
    L.marker(latlngs[0]).addTo(map).bindPopup('Início');
    if (latlngs.length > 1) L.marker(latlngs[latlngs.length - 1]).addTo(map).bindPopup('Fim');
    map.fitBounds(line.getBounds(), { padding: [24, 24] });
    return map;
  }

  window.GPSSpeedMap = { renderTripMap };
})();
