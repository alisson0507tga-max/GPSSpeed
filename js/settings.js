(() => {
  'use strict';

  const KEY = 'gpsspeed.settings.v1';
  const defaults = {
    speedUnit: 'kmh',
    speedAlertEnabled: false,
    speedAlertLimit: 100,
    darkMode: true
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return { ...defaults, ...(raw ? JSON.parse(raw) : {}) };
    } catch {
      return { ...defaults };
    }
  }

  function save(next) {
    const settings = { ...defaults, ...load(), ...(next || {}) };
    settings.speedAlertLimit = Math.min(300, Math.max(10, Number(settings.speedAlertLimit) || 100));
    localStorage.setItem(KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent('gpsspeed:settings-change', { detail: { settings } }));
    return settings;
  }

  window.GPSSpeedSettings = { load, save, defaults: { ...defaults } };
})();
