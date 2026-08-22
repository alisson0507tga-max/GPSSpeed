(() => {
  'use strict';

  const state = {
    currentSpeed: 0,
    maxSpeed: 0,
    speedSamples: [],
    averageSpeed: 0,
    maxSamples: 120
  };

  const elements = {
    currentSpeed: document.getElementById('currentSpeed'),
    maxSpeed: document.getElementById('maxSpeed'),
    avgSpeed: document.getElementById('avgSpeed')
  };

  function sanitizeSpeed(value) {
    const speed = Number(value);
    if (!Number.isFinite(speed) || speed < 0) return 0;
    return speed;
  }

  function formatSpeed(value) {
    return `${Math.round(sanitizeSpeed(value))} km/h`;
  }

  function calculateAverage() {
    if (!state.speedSamples.length) return 0;

    const total = state.speedSamples.reduce((sum, speed) => sum + speed, 0);
    return total / state.speedSamples.length;
  }

  function render() {
    if (elements.currentSpeed) {
      elements.currentSpeed.textContent = Math.round(state.currentSpeed);
    }

    if (elements.maxSpeed) {
      elements.maxSpeed.textContent = formatSpeed(state.maxSpeed);
    }

    if (elements.avgSpeed) {
      elements.avgSpeed.textContent = formatSpeed(state.averageSpeed);
    }
  }

  function updateSpeed(speedKmh, options = {}) {
    const speed = sanitizeSpeed(speedKmh);
    const shouldSample = options.sample !== false;

    state.currentSpeed = speed;

    if (speed > state.maxSpeed) {
      state.maxSpeed = speed;
    }

    if (shouldSample) {
      state.speedSamples.push(speed);

      if (state.speedSamples.length > state.maxSamples) {
        state.speedSamples.shift();
      }

      state.averageSpeed = calculateAverage();
    }

    render();

    window.dispatchEvent(new CustomEvent('gpsspeed:speed-update', {
      detail: {
        currentSpeed: state.currentSpeed,
        maxSpeed: state.maxSpeed,
        averageSpeed: state.averageSpeed
      }
    }));
  }

  function reset() {
    state.currentSpeed = 0;
    state.maxSpeed = 0;
    state.speedSamples = [];
    state.averageSpeed = 0;
    render();
  }

  function getStats() {
    return {
      currentSpeed: state.currentSpeed,
      maxSpeed: state.maxSpeed,
      averageSpeed: state.averageSpeed,
      samples: state.speedSamples.length
    };
  }

  window.GPSSpeedometer = {
    updateSpeed,
    reset,
    getStats
  };

  window.addEventListener('gpsspeed:gps-update', (event) => {
    const speedKmh = event.detail?.speedKmh ?? 0;
    updateSpeed(speedKmh);
  });

  render();
})();
