(() => {
  'use strict';

  const startBtn = document.getElementById('startTripBtn');
  const pauseBtn = document.getElementById('pauseTripBtn');
  const finishBtn = document.getElementById('finishTripBtn');
  const elapsedEl = document.getElementById('elapsedTime');

  let timerId = null;

  function formatElapsed(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return [hours, minutes, seconds]
      .map((value) => String(value).padStart(2, '0'))
      .join(':');
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
    if (elapsedEl) elapsedEl.textContent = '00:00:00';
  }

  startBtn?.addEventListener('click', () => {
    if (!window.GPSSpeedTracking) return;

    const current = window.GPSSpeedTracking.getState();
    if (current.status === 'finished') {
      resetForNewTrip();
    }

    window.GPSSpeedTracking.start();
    setButtons('running');
    startTimer();
  });

  pauseBtn?.addEventListener('click', () => {
    if (!window.GPSSpeedTracking) return;

    const current = window.GPSSpeedTracking.getState();

    if (current.status === 'running') {
      window.GPSSpeedTracking.pause();
      setButtons('paused');
      updateTimer();
      return;
    }

    if (current.status === 'paused') {
      window.GPSSpeedTracking.resume();
      setButtons('running');
      startTimer();
    }
  });

  finishBtn?.addEventListener('click', () => {
    if (!window.GPSSpeedTracking) return;

    const result = window.GPSSpeedTracking.finish();
    stopTimer();
    updateTimer();
    setButtons('finished');

    window.dispatchEvent(new CustomEvent('gpsspeed:trip-ready-to-save', {
      detail: {
        trip: result,
        speed: window.GPSSpeedometer?.getStats?.() || null
      }
    }));
  });

  window.addEventListener('gpsspeed:tracking-start', () => setButtons('running'));
  window.addEventListener('gpsspeed:tracking-pause', () => setButtons('paused'));
  window.addEventListener('gpsspeed:tracking-resume', () => setButtons('running'));
  window.addEventListener('gpsspeed:tracking-finish', () => setButtons('finished'));

  setButtons(window.GPSSpeedTracking?.getState?.().status || 'idle');
  updateTimer();
})();
