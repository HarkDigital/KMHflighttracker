/**
 * adsb.js — tiny client for live ADS-B aircraft.
 *
 * Prefers our own cached same-origin proxy (APP_CONFIG.adsbProxy, present on
 * IONOS): one fast request, server-side cached and shared across devices. Falls
 * back to the free keyless aggregators (adsb.lol primary, airplanes.live) when
 * the proxy isn't configured (e.g. GitHub Pages) or fails.
 *
 *   Adsb.point(lat, lon, radiusNm) -> Promise<aircraft[] | null>
 *   Adsb.callsign(callsign)        -> Promise<aircraft[] | null>
 */
window.Adsb = (function () {
  'use strict';

  const proxy = (window.APP_CONFIG || {}).adsbProxy || null;

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

  // Fetch a feed URL with a hard timeout. Returns { ac:[normalized], error } or
  // null on network failure (and rotates to the other direct provider).
  async function fetchFeed(url, rotate) {
    const ctrl = ('AbortController' in window) ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
    try {
      const res = await fetch(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      if (!res.ok) throw new Error(res.status);
      const d = await res.json();
      const ac = (d.ac || d.aircraft || []).filter(a => a.lat != null && a.lon != null).map(norm);
      return { ac, error: !!d.error };
    } catch (e) {
      if (rotate) idx = (idx + 1) % POINT.length;
      return null;
    } finally { if (timer) clearTimeout(timer); }
  }

  // Try the cached proxy first; fall back to the direct providers on miss/error.
  async function viaProxyOrDirect(proxyUrl, directUrl) {
    if (proxy) {
      const r = await fetchFeed(proxyUrl, false);
      if (r && !r.error) return r.ac;       // proxy answered (cached or fresh)
    }
    const r = await fetchFeed(directUrl, true);
    return r ? r.ac : null;
  }

  return {
    point: (lat, lon, nm) => viaProxyOrDirect(
      proxy && `${proxy}?type=point&lat=${lat}&lon=${lon}&radius=${nm}`,
      POINT[idx](lat, lon, nm)),
    callsign: cs => {
      cs = (cs || '').trim();
      return viaProxyOrDirect(
        proxy && `${proxy}?type=callsign&cs=${encodeURIComponent(cs)}`,
        CALL[idx](cs));
    },
  };
})();
