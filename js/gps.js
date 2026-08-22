(function () {
  'use strict';

  const GPS = {
    watchId: null,
    lastPosition: null,
    listeners: new Set(),

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

      this.watchId = navigator.geolocation.watchPosition(
        (position) => this.handlePosition(position),
        (error) => this.handleError(error),
        {
          enableHighAccuracy: true,
          maximumAge: 1000,
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
      this.setStatus('GPS pausado', 'idle');
    },

    handlePosition(position) {
      const coords = position.coords;
      const speedMps = Number.isFinite(coords.speed) && coords.speed >= 0 ? coords.speed : 0;
      const speedKmh = speedMps * 3.6;

      const data = {
        type: 'position',
        timestamp: position.timestamp || Date.now(),
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
        altitude: Number.isFinite(coords.altitude) ? coords.altitude : null,
        heading: Number.isFinite(coords.heading) ? coords.heading : null,
        speedMps,
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
