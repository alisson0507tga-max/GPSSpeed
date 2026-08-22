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

  function buildTripRecord(trackingState, speedStats) {
    const state = trackingState || getTrackingState();
    const speeds = speedStats || getSpeedStats();

    if (!state) {
      throw new Error('Dados do percurso indisponíveis');
    }

    const points = Array.isArray(state.points) ? state.points : [];
    const startedAt = Number.isFinite(state.startedAt) ? state.startedAt : Date.now();
    const finishedAt = Number.isFinite(state.finishedAt) ? state.finishedAt : Date.now();

    return {
      startedAt,
      finishedAt,
      elapsedMs: Number.isFinite(state.elapsedMs) ? state.elapsedMs : 0,
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
    if (!window.GPSSpeedDB) {
      throw new Error('Banco de dados não carregado');
    }

    const trackingState = getTrackingState();

    if (!trackingState || trackingState.status !== 'finished') {
      throw new Error('Finalize o percurso antes de salvar');
    }

    const record = buildTripRecord(trackingState, getSpeedStats());
    const saved = window.GPSSpeedDB.saveTrip(record);

    window.dispatchEvent(new CustomEvent('gpsspeed:trip-saved', {
      detail: { trip: saved }
    }));

    return saved;
  }

  function getTrips() {
    return window.GPSSpeedDB?.readAll?.() || [];
  }

  function getTrip(id) {
    return window.GPSSpeedDB?.getTrip?.(id) || null;
  }

  function deleteTrip(id) {
    const deleted = window.GPSSpeedDB?.deleteTrip?.(id) || false;

    if (deleted) {
      window.dispatchEvent(new CustomEvent('gpsspeed:trip-deleted', {
        detail: { id }
      }));
    }

    return deleted;
  }

  window.GPSSpeedTrips = {
    buildTripRecord,
    saveCurrentTrip,
    getTrips,
    getTrip,
    deleteTrip
  };
})();
