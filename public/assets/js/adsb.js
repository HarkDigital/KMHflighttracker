/**
 * adsb.js — tiny client for the free, keyless, CORS-enabled ADS-B aggregators
 * (adsb.lol primary, airplanes.live fallback). Shared by the radar and the
 * live board. No API key, no account.
 *
 *   Adsb.point(lat, lon, radiusNm) -> Promise<aircraft[] | null>
 *   Adsb.callsign(callsign)        -> Promise<aircraft[] | null>
 *
 * Returns null on failure (and rotates to the other provider next call).
 */
window.Adsb = (function () {
  'use strict';

  const POINT = [
    (lat, lon, nm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}`,
    (lat, lon, nm) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${nm}`,
  ];
  const CALL = [
    cs => `https://api.adsb.lol/v2/callsign/${encodeURIComponent(cs)}`,
    cs => `https://api.airplanes.live/v2/callsign/${encodeURIComponent(cs)}`,
  ];
  let idx = 0;

  function norm(raw) {
    return {
      hex: raw.hex || raw.r || (raw.flight || '').trim(),
      callsign: (raw.flight || '').trim(),
      lat: raw.lat, lon: raw.lon,
      alt: raw.alt_baro,                                   // number or 'ground'
      gs: raw.gs ?? 0,
      track: raw.track ?? raw.true_heading ?? 0,
      baroRate: raw.baro_rate ?? raw.geom_rate ?? 0,       // ft/min
      type: raw.t || '',
      reg: raw.r || '',
    };
  }

  async function hit(url) {
    const ctrl = ('AbortController' in window) ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 7000) : null;
    try {
      const res = await fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      if (!res.ok) throw new Error(res.status);
      const d = await res.json();
      return (d.ac || d.aircraft || [])
        .filter(a => a.lat != null && a.lon != null)
        .map(norm);
    } catch (e) {
      idx = (idx + 1) % POINT.length;     // try the other provider next time
      return null;
    } finally { if (timer) clearTimeout(timer); }
  }

  return {
    point: (lat, lon, nm) => hit(POINT[idx](lat, lon, nm)),
    callsign: cs => hit(CALL[idx]((cs || '').trim())),
  };
})();
