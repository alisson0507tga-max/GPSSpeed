(() => {
  'use strict';

  const STORAGE_KEY = 'gpsspeed.trips.v1';

  function readAllRaw() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Erro ao ler viagens salvas:', error);
      return [];
    }
  }

  function writeAll(trips) {
    const safeTrips = Array.isArray(trips) ? trips : [];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safeTrips));
    return safeTrips;
  }

  function importNativeAutoTrips() {
    try {
      if (!window.AndroidBridge?.getAutoTimelineTrips) return 0;
      const raw = window.AndroidBridge.getAutoTimelineTrips();
      const incoming = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(incoming) || !incoming.length) return 0;

      const trips = readAllRaw();
      const known = new Set(trips.map((trip) => trip.id));
      let added = 0;
      incoming.forEach((trip) => {
        if (!trip || typeof trip !== 'object' || !trip.id || known.has(trip.id)) return;
        trips.unshift({ ...trip, automatic: true });
        known.add(trip.id);
        added += 1;
      });

      if (added) writeAll(trips.sort((a, b) => (Number(b.startedAt) || 0) - (Number(a.startedAt) || 0)));
      window.AndroidBridge?.clearImportedAutoTimelineTrips?.();
      return added;
    } catch (error) {
      console.warn('Não foi possível importar a Linha do Tempo automática:', error);
      return 0;
    }
  }

  function readAll() {
    importNativeAutoTrips();
    return readAllRaw();
  }

  function createId() {
    return `trip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function saveTrip(trip) {
    if (!trip || typeof trip !== 'object') throw new Error('Viagem inválida');
    const trips = readAllRaw();
    const record = { id: trip.id || createId(), createdAt: Date.now(), ...trip };
    const index = trips.findIndex((item) => item.id === record.id);
    if (index >= 0) trips[index] = record;
    else trips.unshift(record);
    writeAll(trips);
    return record;
  }

  function getTrip(id) {
    if (!id) return null;
    return readAll().find((trip) => trip.id === id) || null;
  }

  function deleteTrip(id) {
    if (!id) return false;
    const trips = readAll();
    const filtered = trips.filter((trip) => trip.id !== id);
    const changed = filtered.length !== trips.length;
    if (changed) writeAll(filtered);
    return changed;
  }

  function clearTrips() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function countTrips() {
    return readAll().length;
  }

  window.GPSSpeedDB = {
    readAll,
    writeAll,
    saveTrip,
    getTrip,
    deleteTrip,
    clearTrips,
    countTrips,
    importNativeAutoTrips
  };
})();
