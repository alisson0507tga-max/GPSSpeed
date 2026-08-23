(() => {
  'use strict';

  const MOVING_SPEED_KMH = 3;
  const MAX_SEGMENT_GAP_MS = 30000;

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

  function summarizeTrip(trip) {
    const points = Array.isArray(trip?.points) ? trip.points
      .filter((p) => Number.isFinite(Number(p?.timestamp)))
      .slice()
      .sort((a, b) => Number(a.timestamp) - Number(b.timestamp)) : [];

    let movingMs = 0;
    let stoppedMs = 0;
    let maxPointSpeed = 0;
    let weightedSpeedSum = 0;
    let weightedSpeedMs = 0;

    for (let i = 0; i < points.length; i += 1) {
      const speed = Math.max(0, Number(points[i]?.speedKmh) || 0);
      if (speed > maxPointSpeed) maxPointSpeed = speed;
      if (i === 0) continue;

      const previous = points[i - 1];
      const delta = Math.max(0, Math.min(MAX_SEGMENT_GAP_MS,
        Number(points[i].timestamp) - Number(previous.timestamp)));
      if (!delta) continue;

      if (speed >= MOVING_SPEED_KMH) {
        movingMs += delta;
        weightedSpeedSum += speed * delta;
        weightedSpeedMs += delta;
      } else {
        stoppedMs += delta;
      }
    }

    const elapsedMs = Number(trip?.elapsedMs) || 0;
    const accounted = movingMs + stoppedMs;
    if (elapsedMs > accounted) stoppedMs += elapsedMs - accounted;

    const distanceKm = Number(trip?.distanceKm) || 0;
    const calculatedAverage = movingMs > 0
      ? distanceKm / (movingMs / 3600000)
      : 0;

    const pointAverage = weightedSpeedMs > 0
      ? weightedSpeedSum / weightedSpeedMs
      : 0;

    return {
      ...trip,
      pointCount: points.length,
      movingMs,
      stoppedMs,
      maxSpeed: Math.max(Number(trip?.maxSpeed) || 0, maxPointSpeed),
      averageSpeed: Number(trip?.averageSpeed) > 0
        ? Number(trip.averageSpeed)
        : (calculatedAverage > 0 ? calculatedAverage : pointAverage),
      startPoint: points[0] || null,
      endPoint: points[points.length - 1] || null
    };
  }

  function buildTripRecord(trackingState, speedStats) {
    const state = trackingState || getTrackingState();
    const speeds = speedStats || getSpeedStats();

    if (!state) throw new Error('Dados do percurso indisponíveis');

    const points = Array.isArray(state.points) ? state.points : [];
    const startedAt = Number.isFinite(state.startedAt) ? state.startedAt : Date.now();
    const finishedAt = Number.isFinite(state.finishedAt) ? state.finishedAt : Date.now();

    const record = {
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

    const summary = summarizeTrip(record);
    record.movingMs = summary.movingMs;
    record.stoppedMs = summary.stoppedMs;
    record.maxSpeed = summary.maxSpeed;
    record.averageSpeed = summary.averageSpeed;
    return record;
  }

  function saveCurrentTrip() {
    if (!window.GPSSpeedDB) throw new Error('Banco de dados não carregado');

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
    return (window.GPSSpeedDB?.readAll?.() || []).map(summarizeTrip);
  }

  function getTrip(id) {
    const trip = window.GPSSpeedDB?.getTrip?.(id) || null;
    return trip ? summarizeTrip(trip) : null;
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
    summarizeTrip,
    saveCurrentTrip,
    getTrips,
    getTrip,
    deleteTrip
  };
})();
