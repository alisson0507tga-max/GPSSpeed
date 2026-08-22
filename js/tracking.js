(() => {
  'use strict';

  const ACTIVE_KEY = 'gpsspeed.activeTrip.v2';

  const state = {
    status: 'idle',
    startedAt: null,
    pausedAt: null,
    totalPausedMs: 0,
    finishedAt: null,
    points: [],
    distanceMeters: 0,
    lastAcceptedPoint: null,
    pendingPoint: null,
    movementConfirmations: 0,
    unsubscribeGps: null
  };

  const MAX_ACCURACY_METERS = 70;
  const MAX_JUMP_METERS = 300;
  const STATIONARY_SPEED_KMH = 3;
  const MAX_PLAUSIBLE_SPEED_KMH = 220;
  const REQUIRED_MOVEMENT_CONFIRMATIONS = 2;

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
    if (!point) return false;
    if (point.type && point.type !== 'position') return false;
    if (!Number.isFinite(Number(point.latitude)) || !Number.isFinite(Number(point.longitude))) return false;
    const lat = Number(point.latitude);
    const lon = Number(point.longitude);
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
    const accuracy = Number(point.accuracy);
    if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_METERS) return false;
    return true;
  }

  function dynamicMinimumDistance(a, b) {
    const accuracyA = Number.isFinite(Number(a?.accuracy)) ? Number(a.accuracy) : 10;
    const accuracyB = Number.isFinite(Number(b?.accuracy)) ? Number(b.accuracy) : 10;
    const accuracyNoise = Math.max(accuracyA, accuracyB) * 0.65;
    return Math.max(4, Math.min(20, accuracyNoise));
  }

  function segmentSpeedKmh(a, b, distanceMeters) {
    const deltaMs = Math.max(1, (Number(b.timestamp) || Date.now()) - (Number(a.timestamp) || Date.now()));
    return (distanceMeters / (deltaMs / 1000)) * 3.6;
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
      detail: { ...detail, state: getState() }
    }));
  }

  function normalizePoint(point) {
    const speed = Number(point.speedKmh);
    const rawSpeed = Number(point.rawSpeedKmh);
    return {
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
      accuracy: Number.isFinite(Number(point.accuracy)) ? Number(point.accuracy) : null,
      altitude: Number.isFinite(Number(point.altitude)) ? Number(point.altitude) : null,
      heading: Number.isFinite(Number(point.heading)) ? Number(point.heading) : null,
      speedKmh: Number.isFinite(speed) ? Math.max(0, speed) : 0,
      rawSpeedKmh: Number.isFinite(rawSpeed) ? Math.max(0, rawSpeed) : (Number.isFinite(speed) ? Math.max(0, speed) : 0),
      timestamp: Number.isFinite(Number(point.timestamp)) ? Number(point.timestamp) : Date.now()
    };
  }

  function saveCheckpoint() {
    if (state.status === 'idle') return;
    try {
      localStorage.setItem(ACTIVE_KEY, JSON.stringify({
        status: state.status,
        startedAt: state.startedAt,
        pausedAt: state.pausedAt,
        totalPausedMs: state.totalPausedMs,
        finishedAt: state.finishedAt,
        distanceMeters: state.distanceMeters,
        points: state.points
      }));
    } catch (error) {
      console.warn('Checkpoint do percurso não pôde ser salvo:', error);
    }
  }

  function clearCheckpoint() {
    try { localStorage.removeItem(ACTIVE_KEY); } catch (_) {}
  }

  function getCheckpoint() {
    try {
      const raw = localStorage.getItem(ACTIVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function storePoint(normalized, addDistance = 0, options = {}) {
    if (addDistance > 0) state.distanceMeters += addDistance;
    state.points.push(normalized);
    state.lastAcceptedPoint = normalized;
    state.pendingPoint = null;
    state.movementConfirmations = 0;
    updateDistanceUI();
    if (options.persist !== false) saveCheckpoint();
    if (options.emit !== false) emit('gpsspeed:tracking-point', { point: normalized });
    return true;
  }

  function acceptPoint(point, options = {}) {
    if (state.status !== 'running') return false;
    if (!isValidPoint(point)) return false;

    const normalized = normalizePoint(point);
    if (!state.lastAcceptedPoint) return storePoint(normalized, 0, options);

    const segment = distanceBetween(state.lastAcceptedPoint, normalized);
    const minDistance = dynamicMinimumDistance(state.lastAcceptedPoint, normalized);
    const calculatedSpeed = segmentSpeedKmh(state.lastAcceptedPoint, normalized, segment);

    if (segment > MAX_JUMP_METERS || calculatedSpeed > MAX_PLAUSIBLE_SPEED_KMH) {
      state.pendingPoint = null;
      state.movementConfirmations = 0;
      return false;
    }

    if (normalized.speedKmh < STATIONARY_SPEED_KMH && segment < minDistance * 1.8) {
      state.pendingPoint = null;
      state.movementConfirmations = 0;
      return false;
    }

    if (segment < minDistance) return false;

    if (!state.pendingPoint) {
      state.pendingPoint = normalized;
      state.movementConfirmations = 1;
      return false;
    }

    const confirmationDistance = distanceBetween(state.pendingPoint, normalized);
    const confirmationMin = dynamicMinimumDistance(state.pendingPoint, normalized);

    if (confirmationDistance >= confirmationMin || normalized.speedKmh >= STATIONARY_SPEED_KMH) {
      state.movementConfirmations += 1;
    } else {
      state.pendingPoint = normalized;
      state.movementConfirmations = 1;
      return false;
    }

    if (state.movementConfirmations < REQUIRED_MOVEMENT_CONFIRMATIONS) {
      state.pendingPoint = normalized;
      return false;
    }

    return storePoint(normalized, segment, options);
  }

  function ensureGpsSubscription() {
    if (state.unsubscribeGps || !window.GPSSpeedGPS) return;
    state.unsubscribeGps = window.GPSSpeedGPS.subscribe((payload) => {
      if (payload?.type === 'position') acceptPoint(payload);
    });
  }

  function start() {
    if (state.status === 'running') return getState();
    if (state.status === 'paused') return resume();

    state.status = 'running';
    state.startedAt = Date.now();
    state.pausedAt = null;
    state.totalPausedMs = 0;
    state.finishedAt = null;
    state.points = [];
    state.distanceMeters = 0;
    state.lastAcceptedPoint = null;
    state.pendingPoint = null;
    state.movementConfirmations = 0;

    updateDistanceUI();
    ensureGpsSubscription();
    window.GPSSpeedGPS?.start();
    saveCheckpoint();
    emit('gpsspeed:tracking-start');
    return getState();
  }

  function pause() {
    if (state.status !== 'running') return getState();
    state.status = 'paused';
    state.pausedAt = Date.now();
    state.pendingPoint = null;
    state.movementConfirmations = 0;
    saveCheckpoint();
    emit('gpsspeed:tracking-pause');
    return getState();
  }

  function resume() {
    if (state.status !== 'paused') return getState();
    if (state.pausedAt) state.totalPausedMs += Date.now() - state.pausedAt;
    state.pausedAt = null;
    state.status = 'running';
    state.pendingPoint = null;
    state.movementConfirmations = 0;
    saveCheckpoint();
    emit('gpsspeed:tracking-resume');
    return getState();
  }

  function finish() {
    if (state.status !== 'running' && state.status !== 'paused') return getState();
    const now = Date.now();
    if (state.status === 'paused' && state.pausedAt) {
      state.totalPausedMs += now - state.pausedAt;
      state.pausedAt = null;
    }
    state.status = 'finished';
    state.finishedAt = now;
    state.pendingPoint = null;
    state.movementConfirmations = 0;
    saveCheckpoint();
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
    state.pendingPoint = null;
    state.movementConfirmations = 0;
    updateDistanceUI();
    clearCheckpoint();
    emit('gpsspeed:tracking-reset');
  }

  function restoreFromSnapshot(snapshot) {
    if (!snapshot || !['running', 'paused'].includes(snapshot.status)) return false;
    const incoming = Array.isArray(snapshot.points) ? snapshot.points : [];

    state.status = 'running';
    state.startedAt = Number(snapshot.startedAt) || Date.now();
    state.pausedAt = null;
    state.totalPausedMs = Number(snapshot.totalPausedMs) || 0;
    state.finishedAt = null;
    state.points = [];
    state.distanceMeters = 0;
    state.lastAcceptedPoint = null;
    state.pendingPoint = null;
    state.movementConfirmations = 0;

    incoming
      .slice()
      .sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0))
      .forEach((point) => acceptPoint({ type: 'position', ...point }, { persist: false, emit: false }));

    if (snapshot.status === 'paused') {
      state.status = 'paused';
      state.pausedAt = Number(snapshot.pausedAt) || Date.now();
    }

    updateDistanceUI();
    saveCheckpoint();
    emit('gpsspeed:tracking-restored', { recoveredPoints: incoming.length });
    return true;
  }

  function restoreCheckpoint() {
    const checkpoint = getCheckpoint();
    if (!checkpoint || !['running', 'paused'].includes(checkpoint.status)) return false;
    return restoreFromSnapshot(checkpoint);
  }

  function getElapsedMs() {
    if (!state.startedAt) return 0;
    const end = state.finishedAt || Date.now();
    let pausedMs = state.totalPausedMs;
    if (state.status === 'paused' && state.pausedAt) pausedMs += end - state.pausedAt;
    return Math.max(0, end - state.startedAt - pausedMs);
  }

  function getState() {
    return {
      status: state.status,
      startedAt: state.startedAt,
      pausedAt: state.pausedAt,
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
    distanceBetween,
    saveCheckpoint,
    clearCheckpoint,
    getCheckpoint,
    restoreCheckpoint,
    restoreFromSnapshot
  };
})();
