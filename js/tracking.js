(() => {
  'use strict';

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
    if (!point || point.type !== 'position') return false;
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return false;
    if (point.latitude < -90 || point.latitude > 90) return false;
    if (point.longitude < -180 || point.longitude > 180) return false;

    if (Number.isFinite(point.accuracy) && point.accuracy > MAX_ACCURACY_METERS) {
      return false;
    }

    return true;
  }

  function dynamicMinimumDistance(a, b) {
    const accuracyA = Number.isFinite(a?.accuracy) ? a.accuracy : 10;
    const accuracyB = Number.isFinite(b?.accuracy) ? b.accuracy : 10;
    const accuracyNoise = Math.max(accuracyA, accuracyB) * 0.65;
    return Math.max(4, Math.min(20, accuracyNoise));
  }

  function segmentSpeedKmh(a, b, distanceMeters) {
    const deltaMs = Math.max(1, (b.timestamp || Date.now()) - (a.timestamp || Date.now()));
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
      detail: {
        ...detail,
        state: getState()
      }
    }));
  }

  function normalizePoint(point) {
    return {
      latitude: point.latitude,
      longitude: point.longitude,
      accuracy: Number.isFinite(point.accuracy) ? point.accuracy : null,
      altitude: Number.isFinite(point.altitude) ? point.altitude : null,
      heading: Number.isFinite(point.heading) ? point.heading : null,
      speedKmh: Number.isFinite(point.speedKmh) ? Math.max(0, point.speedKmh) : 0,
      rawSpeedKmh: Number.isFinite(point.rawSpeedKmh) ? Math.max(0, point.rawSpeedKmh) : 0,
      timestamp: Number.isFinite(point.timestamp) ? point.timestamp : Date.now()
    };
  }

  function storePoint(normalized, addDistance = 0) {
    if (addDistance > 0) state.distanceMeters += addDistance;
    state.points.push(normalized);
    state.lastAcceptedPoint = normalized;
    state.pendingPoint = null;
    state.movementConfirmations = 0;
    updateDistanceUI();
    emit('gpsspeed:tracking-point', { point: normalized });
    return true;
  }

  function acceptPoint(point) {
    if (state.status !== 'running') return false;
    if (!isValidPoint(point)) return false;

    const normalized = normalizePoint(point);

    // O primeiro ponto vira apenas referência; não soma distância.
    if (!state.lastAcceptedPoint) {
      return storePoint(normalized, 0);
    }

    const segment = distanceBetween(state.lastAcceptedPoint, normalized);
    const minDistance = dynamicMinimumDistance(state.lastAcceptedPoint, normalized);
    const calculatedSpeed = segmentSpeedKmh(state.lastAcceptedPoint, normalized, segment);

    // Saltos ou velocidades fisicamente implausíveis são ruído.
    if (segment > MAX_JUMP_METERS || calculatedSpeed > MAX_PLAUSIBLE_SPEED_KMH) {
      state.pendingPoint = null;
      state.movementConfirmations = 0;
      return false;
    }

    // Se o GPS diz que estamos parados, só aceitamos deslocamento muito acima do ruído esperado.
    if (normalized.speedKmh < STATIONARY_SPEED_KMH && segment < minDistance * 1.8) {
      state.pendingPoint = null;
      state.movementConfirmations = 0;
      return false;
    }

    // Qualquer deslocamento menor que a margem de precisão é descartado.
    if (segment < minDistance) {
      return false;
    }

    // Confirma movimento em mais de uma leitura antes de começar a somar.
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

    return storePoint(normalized, segment);
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

    emit('gpsspeed:tracking-start');
    return getState();
  }

  function pause() {
    if (state.status !== 'running') return getState();
    state.status = 'paused';
    state.pausedAt = Date.now();
    state.pendingPoint = null;
    state.movementConfirmations = 0;
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
