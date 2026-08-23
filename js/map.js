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

  function renderTripMap(containerId, trip) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    const points = Array.isArray(trip?.points)
      ? trip.points.filter((p) => Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude)))
      : [];

    if (!points.length) {
      container.innerHTML = '<p class="location-card">Este percurso não possui pontos de GPS salvos.</p>';
      return null;
    }

    if (!window.L) {
      container.innerHTML = '<p class="location-card">O mapa precisa de internet para carregar nesta versão.</p>';
      return null;
    }

    const map = L.map(containerId, { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

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

  window.GPSSpeedMap = { renderTripMap };
})();
