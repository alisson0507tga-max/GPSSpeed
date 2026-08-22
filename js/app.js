(() => {
  'use strict';

  const startBtn = document.getElementById('startTripBtn');
  const pauseBtn = document.getElementById('pauseTripBtn');
  const finishBtn = document.getElementById('finishTripBtn');
  const elapsedEl = document.getElementById('elapsedTime');

  let timerId = null;
  let lastAlertAt = 0;
  let lastNativeSyncAt = 0;

  function formatElapsed(ms) {
    if (window.GPSSpeedUtils?.formatDuration) return window.GPSSpeedUtils.formatDuration(ms);
    const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((v) => String(v).padStart(2, '0')).join(':');
  }

  function updateTimer() {
    if (!elapsedEl || !window.GPSSpeedTracking) return;
    elapsedEl.textContent = formatElapsed(window.GPSSpeedTracking.getElapsedMs());
  }

  function startTimer() {
    stopTimer();
    updateTimer();
    timerId = window.setInterval(updateTimer, 1000);
  }

  function stopTimer() {
    if (timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  function setButtons(state) {
    if (!startBtn || !pauseBtn || !finishBtn) return;

    if (state === 'running') {
      startBtn.disabled = true;
      startBtn.textContent = 'Percurso em andamento';
      pauseBtn.disabled = false;
      pauseBtn.textContent = 'Pausar';
      finishBtn.disabled = false;
      return;
    }

    if (state === 'paused') {
      startBtn.disabled = true;
      startBtn.textContent = 'Percurso pausado';
      pauseBtn.disabled = false;
      pauseBtn.textContent = 'Continuar';
      finishBtn.disabled = false;
      return;
    }

    startBtn.disabled = false;
    startBtn.textContent = state === 'finished' ? 'Novo percurso' : 'Iniciar percurso';
    pauseBtn.disabled = true;
    pauseBtn.textContent = 'Pausar';
    finishBtn.disabled = true;
  }

  function resetForNewTrip() {
    window.GPSSpeedTracking?.reset();
    window.GPSSpeedometer?.reset();
    try { window.AndroidBridge?.clearTrackingSnapshot?.(); } catch (_) {}
    if (elapsedEl) elapsedEl.textContent = '00:00:00';
  }

  function maybeSpeedAlert(speed) {
    const settings = window.GPSSpeedSettings?.load?.();
    if (!settings?.speedAlertEnabled) return;
    const limit = Number(settings.speedAlertLimit) || 100;
    const now = Date.now();
    if (speed >= limit && now - lastAlertAt > 15000) {
      lastAlertAt = now;
      if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
    }
  }

  function syncNativeSnapshot(force = false) {
    if (!window.GPSSpeedTracking || !window.AndroidBridge?.getTrackingSnapshot) return false;
    const now = Date.now();
    if (!force && now - lastNativeSyncAt < 1500) return false;
    lastNativeSyncAt = now;

    try {
      const raw = window.AndroidBridge.getTrackingSnapshot();
      const snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!snapshot || !['running', 'paused'].includes(snapshot.status)) return false;

      const restored = window.GPSSpeedTracking.restoreFromSnapshot(snapshot);
      if (restored) {
        const points = Array.isArray(snapshot.points) ? snapshot.points : [];
        window.GPSSpeedometer?.reset?.();
        points.forEach((point) => {
          window.GPSSpeedometer?.updateSpeed?.(Number(point.speedKmh) || 0);
        });
        setButtons(snapshot.status);
        if (snapshot.status === 'running') startTimer();
        else {
          stopTimer();
          updateTimer();
        }
      }
      return restored;
    } catch (error) {
      console.warn('Não foi possível sincronizar o rastreamento nativo:', error);
      return false;
    }
  }

  startBtn?.addEventListener('click', () => {
    if (!window.GPSSpeedTracking) return;
    const current = window.GPSSpeedTracking.getState();
    if (current.status === 'finished') resetForNewTrip();
    window.GPSSpeedTracking.start();
    try { window.AndroidBridge?.startTracking?.(); } catch (_) {}
    setButtons('running');
    startTimer();
  });

  pauseBtn?.addEventListener('click', () => {
    if (!window.GPSSpeedTracking) return;
    const current = window.GPSSpeedTracking.getState();
    if (current.status === 'running') {
      window.GPSSpeedTracking.pause();
      try { window.AndroidBridge?.pauseTracking?.(); } catch (_) {}
      setButtons('paused');
      stopTimer();
      updateTimer();
      return;
    }
    if (current.status === 'paused') {
      window.GPSSpeedTracking.resume();
      try { window.AndroidBridge?.resumeTracking?.(); } catch (_) {}
      setButtons('running');
      startTimer();
    }
  });

  finishBtn?.addEventListener('click', () => {
    if (!window.GPSSpeedTracking) return;

    // Traz primeiro os pontos coletados enquanto a tela estava apagada.
    syncNativeSnapshot(true);

    const result = window.GPSSpeedTracking.finish();
    stopTimer();
    updateTimer();
    setButtons('finished');
    window.GPSSpeedGPS?.stop?.();
    try { window.AndroidBridge?.stopTracking?.(); } catch (_) {}

    try {
      const saved = window.GPSSpeedTrips?.saveCurrentTrip?.();
      if (saved) {
        window.GPSSpeedTracking?.clearCheckpoint?.();
        try { window.AndroidBridge?.clearTrackingSnapshot?.(); } catch (_) {}
        window.dispatchEvent(new CustomEvent('gpsspeed:trip-ready-to-save', {
          detail: { trip: saved, speed: window.GPSSpeedometer?.getStats?.() || null }
        }));
      }
    } catch (error) {
      console.error('Não foi possível salvar o percurso:', error);
    }
  });

  window.addEventListener('gpsspeed:speed-update', (event) => {
    maybeSpeedAlert(Number(event.detail?.currentSpeed) || 0);
  });

  window.addEventListener('gpsspeed:tracking-start', () => setButtons('running'));
  window.addEventListener('gpsspeed:tracking-pause', () => setButtons('paused'));
  window.addEventListener('gpsspeed:tracking-resume', () => setButtons('running'));
  window.addEventListener('gpsspeed:tracking-finish', () => setButtons('finished'));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNativeSnapshot(true);
  });
  window.addEventListener('focus', () => syncNativeSnapshot());

  const restoredLocal = window.GPSSpeedTracking?.restoreCheckpoint?.() || false;
  if (restoredLocal) {
    const status = window.GPSSpeedTracking.getState().status;
    setButtons(status);
    if (status === 'running') startTimer();
  } else {
    setButtons(window.GPSSpeedTracking?.getState?.().status || 'idle');
  }

  updateTimer();
  window.setTimeout(() => syncNativeSnapshot(true), 400);
})();
