(() => {
  'use strict';

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
  }

  function formatDistanceKm(km) {
    const value = Number.isFinite(Number(km)) ? Number(km) : 0;
    return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
  }

  function formatSpeed(value) {
    const speed = Math.max(0, Number(value) || 0);
    return `${Math.round(speed)} km/h`;
  }

  function formatDateTime(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value)) return '--';
    return new Date(value).toLocaleString('pt-BR');
  }

  function getQueryParam(name) {
    return new URLSearchParams(location.search).get(name);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  window.GPSSpeedUtils = {
    formatDuration,
    formatDistanceKm,
    formatSpeed,
    formatDateTime,
    getQueryParam,
    escapeHtml
  };
})();
