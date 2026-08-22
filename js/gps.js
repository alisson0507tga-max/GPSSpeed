(function () {
  'use strict';

  const GPS = {
    watchId: null,
    lastPosition: null,
    listeners: new Set(),
    speedHistory: [],
    maxSpeedHistory: 5,

    isSupported() {
      return 'geolocation' in navigator;
    },

    subscribe(listener) {
      if (typeof listener !== 'function') return function () {};
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },

    emit(payload) {
      this.listeners.forEach((listener) => {
        try {
          listener(payload);
        } catch (error) {
          console.error('Erro em listener de GPS:', error);
        }
      });

      if (payload?.type === 'position') {
        window.dispatchEvent(new CustomEvent('gpsspeed:gps-update', {
          detail: payload
        }));
      }
    },

    start() {
      if (!this.isSupported()) {
        this.setStatus('GPS indisponível', 'error');
        this.emit({ type: 'error', code: 'UNSUPPORTED' });
        return false;
      }

      if (this.watchId !== null) return true;

      this.setStatus('Buscando GPS...', 'searching');
      this.speedHistory = [];

      this.watchId = navigator.geolocation.watchPosition(
        (position) => this.handlePosition(position),
        (error) => this.handleError(error),
        {
          enableHighAccuracy: true,
          maximumAge: 500,
          timeout: 15000
        }
      );

      return true;
    },

    stop() {
      if (this.watchId !== null && this.isSupported()) {
        navigator.geolocation.clearWatch(this.watchId);
      }

      this.watchId = null;
      this.speedHistory = [];
      this.setStatus('GPS pausado', 'idle');
    },

    median(values) {
      if (!values.length) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
    },

    filterSpeed(rawSpeedKmh, accuracy) {
      let speed = Number.isFinite(rawSpeedKmh) && rawSpeedKmh >= 0 ? rawSpeedKmh : 0;

      // Zona morta para eliminar o movimento falso típico do GPS parado.
      if (speed < 3) speed = 0;

      // Com precisão ruim, exigimos um sinal de movimento mais forte.
      if (Number.isFinite(accuracy) && accuracy > 35 && speed < 6) speed = 0;
      if (Number.isFinite(accuracy) && accuracy > 60 && speed < 10) speed = 0;

      this.speedHistory.push(speed);
      if (this.speedHistory.length > this.maxSpeedHistory) {
        this.speedHistory.shift();
      }

      const filtered = this.median(this.speedHistory);
      return filtered < 3 ? 0 : filtered;
    },

    handlePosition(position) {
      const coords = position.coords;
      const rawSpeedMps = Number.isFinite(coords.speed) && coords.speed >= 0 ? coords.speed : 0;
      const rawSpeedKmh = rawSpeedMps * 3.6;
      const accuracy = Number.isFinite(coords.accuracy) ? coords.accuracy : null;
      const speedKmh = this.filterSpeed(rawSpeedKmh, accuracy);

      const data = {
        type: 'position',
        timestamp: position.timestamp || Date.now(),
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy,
        altitude: Number.isFinite(coords.altitude) ? coords.altitude : null,
        heading: Number.isFinite(coords.heading) ? coords.heading : null,
        rawSpeedKmh,
        speedMps: speedKmh / 3.6,
        speedKmh
      };

      this.lastPosition = data;
      this.updateUI(data);
      this.emit(data);
    },

    handleError(error) {
      let message = 'Erro no GPS';
      let code = 'UNKNOWN';

      if (error) {
        if (error.code === 1) {
          message = 'Permissão de GPS negada';
          code = 'PERMISSION_DENIED';
        } else if (error.code === 2) {
          message = 'Sinal de GPS indisponível';
          code = 'POSITION_UNAVAILABLE';
        } else if (error.code === 3) {
          message = 'GPS demorou para responder';
          code = 'TIMEOUT';
        }
      }

      this.setStatus(message, 'error');
      this.emit({ type: 'error', code, error });
    },

    updateUI(data) {
      const accuracyEl = document.getElementById('gpsAccuracy');
      const latitudeEl = document.getElementById('latitude');
      const longitudeEl = document.getElementById('longitude');

      if (accuracyEl) {
        accuracyEl.textContent = data.accuracy === null
          ? 'Precisão: -- m'
          : `Precisão: ${Math.round(data.accuracy)} m`;
      }

      if (latitudeEl) latitudeEl.textContent = data.latitude.toFixed(6);
      if (longitudeEl) longitudeEl.textContent = data.longitude.toFixed(6);

      this.setStatus('GPS conectado', 'connected');
    },

    setStatus(text, state) {
      const statusEl = document.getElementById('gpsStatus');
      if (!statusEl) return;

      statusEl.dataset.state = state || 'idle';
      statusEl.innerHTML = '<span class="gps-dot"></span>' + text;
    }
  };

  window.GPSSpeedGPS = GPS;
})();
