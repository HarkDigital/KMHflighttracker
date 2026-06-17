/**
 * adsbdb.js — client for adsbdb.com, a free, keyless, no-registration API that
 * resolves a callsign to its flight route (origin/destination airports) and a
 * registration / Mode-S hex to an aircraft type. Results are cached in memory
 * and localStorage (routes are stable for the day) to stay polite to the
 * service and keep the board snappy.
 *
 *   Adsbdb.route(callsign) -> Promise<{origin, destination} | null>
 *   Adsbdb.aircraft(idOrReg) -> Promise<{type, manufacturer, reg} | null>
 *
 * Each airport is { iata, icao, name, city }.
 */
window.Adsbdb = (function () {
  'use strict';

  const TTL = 12 * 3600 * 1000;
  const mem = new Map();

  function lsGet(key) {
    try {
      const v = JSON.parse(localStorage.getItem('adsbdb.' + key));
      if (v && Date.now() - v.t < TTL) return v.d;
    } catch (_) {}
    return undefined;
  }
  function lsSet(key, d) {
    try { localStorage.setItem('adsbdb.' + key, JSON.stringify({ t: Date.now(), d })); } catch (_) {}
  }

  function airport(o) {
    if (!o) return null;
    return { iata: o.iata_code || '', icao: o.icao_code || '',
             name: o.name || '', city: o.municipality || '' };
  }

  async function cached(key, fetcher) {
    if (mem.has(key)) return mem.get(key);
    const ls = lsGet(key);
    if (ls !== undefined) { mem.set(key, ls); return ls; }
    let result = null;
    try { result = await fetcher(); } catch (_) { result = null; }
    mem.set(key, result);
    lsSet(key, result);
    return result;
  }

  async function route(callsign) {
    callsign = (callsign || '').trim().toUpperCase();
    if (!callsign) return null;
    return cached('r.' + callsign, async () => {
      const res = await fetch('https://api.adsbdb.com/v0/callsign/' + encodeURIComponent(callsign),
        { cache: 'no-store' });
      if (!res.ok) return null;
      const j = await res.json();
      const fr = j && j.response && j.response.flightroute;
      if (!fr) return null;
      return { origin: airport(fr.origin), destination: airport(fr.destination) };
    });
  }

  async function aircraft(id) {
    id = (id || '').trim().toUpperCase();
    if (!id) return null;
    return cached('a.' + id, async () => {
      const res = await fetch('https://api.adsbdb.com/v0/aircraft/' + encodeURIComponent(id),
        { cache: 'no-store' });
      if (!res.ok) return null;
      const j = await res.json();
      const a = j && j.response && j.response.aircraft;
      if (!a) return null;
      return { type: a.type || '', manufacturer: a.manufacturer || '', reg: a.registration || '' };
    });
  }

  return { route, aircraft };
})();
