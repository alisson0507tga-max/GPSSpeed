(() => {
  'use strict';

  const state = {
    status: 'idle', // idle | running | paused | finished
    startedAt: null,
    pausedAt: null,
    totalPausedMs: 0,
    finishedAt: null,
    points: [],
    distanceMeters: 0,
    lastAcceptedPoint: null,
    unsubscribeGps: null
  };

  const MAX_ACCURACY_METERS = 80;
  const MAX_JUMP_METERS = 500;
  const MIN_POINT_DISTANCE_METERS = 2;

  function toRadians(value) {
    return value * Math.PI / 180;
  }

  function distanceBetween(a, b) {
    if (!a || !b) return 0;

    const earthRadius = 6371000;
    const lat1 = toRadians(a.latitude);
    const lat2 = toRadians(b.latitude);
    const deltaLat = toRadians(b.latitude - a.latitude);
    const deltaLon = toRadians(b.longitude - a.longitude);

    const h = Math.sin(deltaLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    return earthRadius * c;
  }

  function isValidPoint(point) {
    if (!point || point.type !== 'position') return false;
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return false;
    if (point.latitude < -90 || point.latitude > 90) return false;
    if (point.longitude < -180 || point.longitude > 180) return false;

    if (Number.isFinite(point.accuracy) && point.accuracy > MAX_ACCURACY_METERS) {
      return false;
    }

    return true;
  }

  function updateDistanceUI() {
    const el = document.getElementById('distance');
    if (!el) return;

    const km = state.distanceMeters / 1000;
    el.textContent = `${km.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })} km`;
  }

  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, {
      detail: {
        ...detail,
        state: getState()
      }
    }));
  }

  function acceptPoint(point) {
    if (state.status !== 'running') return false;
    if (!isValidPoint(point)) return false;

    const normalized = {
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy: Number.isFinite(point.accuracy) ? point.accuracy : null,
      altitude: Number.isFinite(point.altitude) ? point.altitude : null,
      heading: Number.isFinite(point.heading) ? point.heading : null,
      speedKmh: Number.isFinite(point.speedKmh) ? Math.max(0, point.speedKmh) : 0,
      timestamp: Number.isFinite(point.timestamp) ? point.timestamp : Date.now()
    };

    if (state.lastAcceptedPoint) {
      const segment = distanceBetween(state.lastAcceptedPoint, normalized);

      if (segment > MAX_JUMP_METERS) {
        return false;
      }

      if (segment < MIN_POINT_DISTANCE_METERS) {
        return false;
      }

      state.distanceMeters += segment;
    }

    state.points.push(normalized);
    state.lastAcceptedPoint = normalized;

    updateDistanceUI();
    emit('gpsspeed:tracking-point', { point: normalized });
    return true;
  }

  function ensureGpsSubscription() {
    if (state.unsubscribeGps || !window.GPSSpeedGPS) return;

    state.unsubscribeGps = window.GPSSpeedGPS.subscribe((payload) => {
      if (payload?.type === 'position') {
        acceptPoint(payload);
      }
    });
  }

  function start() {
    if (state.status === 'running') return getState();

    if (state.status === 'paused') {
      return resume();
    }

    state.status = 'running';
    state.startedAt = Date.now();
    state.pausedAt = null;
    state.totalPausedMs = 0;
    state.finishedAt = null;
    state.points = [];
    state.distanceMeters = 0;
    state.lastAcceptedPoint = null;

    updateDistanceUI();
    ensureGpsSubscription();

    if (window.GPSSpeedGPS) {
      window.GPSSpeedGPS.start();
    }

    emit('gpsspeed:tracking-start');
    return getState();
  }

  function pause() {
    if (state.status !== 'running') return getState();

    state.status = 'paused';
    state.pausedAt = Date.now();
    emit('gpsspeed:tracking-pause');
    return getState();
  }

  function resume() {
    if (state.status !== 'paused') return getState();

    if (state.pausedAt) {
      state.totalPausedMs += Date.now() - state.pausedAt;
    }

    state.pausedAt = null;
    state.status = 'running';
    emit('gpsspeed:tracking-resume');
    return getState();
  }

  function finish() {
    if (state.status !== 'running' && state.status !== 'paused') {
      return getState();
    }

    const now = Date.now();

    if (state.status === 'paused' && state.pausedAt) {
      state.totalPausedMs += now - state.pausedAt;
      state.pausedAt = null;
    }

    state.status = 'finished';
    state.finishedAt = now;

    const result = getState();
    emit('gpsspeed:tracking-finish', { trip: result });
    return result;
  }

  function reset() {
    state.status = 'idle';
    state.startedAt = null;
    state.pausedAt = null;
    state.totalPausedMs = 0;
    state.finishedAt = null;
    state.points = [];
    state.distanceMeters = 0;
    state.lastAcceptedPoint = null;
    updateDistanceUI();
    emit('gpsspeed:tracking-reset');
  }

  function getElapsedMs() {
    if (!state.startedAt) return 0;

    const end = state.finishedAt || Date.now();
    let pausedMs = state.totalPausedMs;

    if (state.status === 'paused' && state.pausedAt) {
      pausedMs += end - state.pausedAt;
    }

    return Math.max(0, end - state.startedAt - pausedMs);
  }

  function getState() {
    return {
      status: state.status,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      totalPausedMs: state.totalPausedMs,
      elapsedMs: getElapsedMs(),
      distanceMeters: state.distanceMeters,
      distanceKm: state.distanceMeters / 1000,
      points: state.points.map((point) => ({ ...point }))
    };
  }

  ensureGpsSubscription();
  updateDistanceUI();

  window.GPSSpeedTracking = {
    start,
    pause,
    resume,
    finish,
    reset,
    acceptPoint,
    getState,
    getElapsedMs,
    distanceBetween
  };
})();
