(() => {
  'use strict';

  function getTrackingState() {
    return window.GPSSpeedTracking?.getState?.() || null;
  }

  function getSpeedStats() {
    return window.GPSSpeedometer?.getStats?.() || {
      currentSpeed: 0,
      maxSpeed: 0,
      averageSpeed: 0,
      samples: 0
    };
  }

  function calculateMovementTimes(points, elapsedMs) {
    const list = Array.isArray(points) ? points : [];
    let movingMs = 0;
    for (let i = 1; i < list.length; i += 1) {
      const a = list[i - 1];
      const b = list[i];
      const dt = Math.max(0, Math.min(30000, (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0)));
      const speed = Math.max(Number(a.speedKmh) || 0, Number(b.speedKmh) || 0);
      if (speed >= 3) movingMs += dt;
    }
    const total = Math.max(0, Number(elapsedMs) || 0);
    movingMs = Math.min(total, movingMs);
    return { movingMs, stoppedMs: Math.max(0, total - movingMs) };
  }

  function buildTripRecord(trackingState, speedStats) {
    const state = trackingState || getTrackingState();
    const speeds = speedStats || getSpeedStats();
    if (!state) throw new Error('Dados do percurso indisponíveis');

    const points = Array.isArray(state.points) ? state.points : [];
    const startedAt = Number.isFinite(state.startedAt) ? state.startedAt : Date.now();
    const finishedAt = Number.isFinite(state.finishedAt) ? state.finishedAt : Date.now();
    const elapsedMs = Number.isFinite(state.elapsedMs) ? state.elapsedMs : 0;
    const movement = calculateMovementTimes(points, elapsedMs);

    return {
      startedAt,
      finishedAt,
      elapsedMs,
      movingMs: movement.movingMs,
      stoppedMs: movement.stoppedMs,
      distanceMeters: Number.isFinite(state.distanceMeters) ? state.distanceMeters : 0,
      distanceKm: Number.isFinite(state.distanceKm) ? state.distanceKm : 0,
      maxSpeed: Number.isFinite(speeds.maxSpeed) ? speeds.maxSpeed : 0,
      averageSpeed: Number.isFinite(speeds.averageSpeed) ? speeds.averageSpeed : 0,
      finalSpeed: Number.isFinite(speeds.currentSpeed) ? speeds.currentSpeed : 0,
      pointCount: points.length,
      points: points.map((point) => ({ ...point }))
    };
  }

  function saveCurrentTrip() {
    if (!window.GPSSpeedDB) throw new Error('Banco de dados não carregado');
    const trackingState = getTrackingState();
    if (!trackingState || trackingState.status !== 'finished') throw new Error('Finalize o percurso antes de salvar');
    const record = buildTripRecord(trackingState, getSpeedStats());
    const saved = window.GPSSpeedDB.saveTrip(record);
    window.dispatchEvent(new CustomEvent('gpsspeed:trip-saved', { detail: { trip: saved } }));
    return saved;
  }

  function getTrips() { return window.GPSSpeedDB?.readAll?.() || []; }
  function getTrip(id) { return window.GPSSpeedDB?.getTrip?.(id) || null; }

  function deleteTrip(id) {
    const deleted = window.GPSSpeedDB?.deleteTrip?.(id) || false;
    if (deleted) window.dispatchEvent(new CustomEvent('gpsspeed:trip-deleted', { detail: { id } }));
    return deleted;
  }

  function escapeXml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function tripToGpx(trip) {
    if (!trip) throw new Error('Percurso inválido');
    const points = Array.isArray(trip.points) ? trip.points : [];
    const trackPoints = points.map((p) => {
      const ele = Number.isFinite(Number(p.altitude)) ? `<ele>${Number(p.altitude).toFixed(1)}</ele>` : '';
      const time = Number(p.timestamp) ? `<time>${new Date(Number(p.timestamp)).toISOString()}</time>` : '';
      return `<trkpt lat="${Number(p.latitude)}" lon="${Number(p.longitude)}">${ele}${time}</trkpt>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GPSSpeed" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${escapeXml('GPSSpeed ' + new Date(Number(trip.startedAt) || Date.now()).toLocaleString('pt-BR'))}</name></metadata><trk><name>GPSSpeed</name><trkseg>${trackPoints}</trkseg></trk></gpx>`;
  }

  function buildBackup() {
    return JSON.stringify({
      app: 'GPSSpeed',
      version: 1,
      exportedAt: Date.now(),
      trips: getTrips(),
      settings: window.GPSSpeedSettings?.load?.() || null
    });
  }

  function restoreBackup(raw) {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || data.app !== 'GPSSpeed' || !Array.isArray(data.trips)) throw new Error('Backup inválido');
    window.GPSSpeedDB.writeAll(data.trips);
    if (data.settings && window.GPSSpeedSettings?.save) window.GPSSpeedSettings.save(data.settings);
    return data.trips.length;
  }

  window.GPSSpeedTrips = {
    buildTripRecord, saveCurrentTrip, getTrips, getTrip, deleteTrip,
    calculateMovementTimes, tripToGpx, buildBackup, restoreBackup
  };
})();