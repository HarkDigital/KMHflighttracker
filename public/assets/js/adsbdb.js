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
  const routeProxy = (window.APP_CONFIG || {}).routeProxy || null;

  // fetch with a hard timeout (resolves to null on timeout/failure).
  function fetchT(url, options, ms) {
    const ctrl = ('AbortController' in window) ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
    const opts = Object.assign({}, options, ctrl ? { signal: ctrl.signal } : {});
    return fetch(url, opts).finally(() => { if (timer) clearTimeout(timer); }).catch(() => null);
  }

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
             name: o.name || '', city: o.municipality || '',
             lat: o.latitude, lon: o.longitude };
  }
  function apRouteset(o) {
    if (!o) return null;
    return { iata: o.iata || '', icao: o.icao || '',
             name: o.name || '', city: o.location || o.name || '',
             lat: (o.lat != null ? o.lat : o.latitude),
             lon: (o.lon != null ? o.lon : o.longitude) };
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

  // Position-aware route resolver: tries adsb.lol's routeset (the tar1090 route
  // DB, disambiguated by current position — more current) and falls back to
  // adsbdb. Returns { origin, destination, approx } or null.
  async function resolve(callsign, lat, lon) {
    callsign = (callsign || '').trim().toUpperCase();
    if (!callsign) return null;
    return cached('rt.' + callsign, async () => {
      if (lat != null && lon != null) {
        try {
          const res = await fetch('https://api.adsb.lol/api/0/routeset', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ planes: [{ callsign, lat, lng: lon }] }),
          });
          if (res.ok) {
            const j = await res.json();
            const r = Array.isArray(j) ? j[0] : null;
            const aps = r && r._airports;
            if (r && r.plausible && Array.isArray(aps) && aps.length >= 2) {
              return { origin: apRouteset(aps[0]), destination: apRouteset(aps[aps.length - 1]), approx: false };
            }
          }
        } catch (_) {}
      }
      const r = await route(callsign);
      return r ? { origin: r.origin, destination: r.destination, approx: true } : null;
    });
  }

  // Resolve many callsigns at once via adsb.lol's routeset (one request for the
  // whole board). Returns a map callsign -> { origin, destination } | null.
  //
  // opts.fallback (default true): when false, skip the slow per-callsign adsbdb
  // GET fallback and leave unresolved callsigns out of the result (uncached, so
  // a later full pass can still fill them). This lets the board paint fast from
  // the single batched routeset request, then enrich the stragglers in the
  // background.
  async function resolveBatch(planes, opts) {
    const doFallback = !opts || opts.fallback !== false;
    const out = {};
    const need = [];
    for (const p of planes) {
      const cs = (p.callsign || '').toUpperCase();
      if (!cs) continue;
      if (mem.has('rt.' + cs)) { out[cs] = mem.get('rt.' + cs); continue; }
      const ls = lsGet('rt.' + cs);
      if (ls !== undefined) { mem.set('rt.' + cs, ls); out[cs] = ls; continue; }
      need.push({ cs, lat: p.lat, lng: p.lon });
    }
    if (need.length) {
      // Preferred path: our cached same-origin proxy resolves the whole batch
      // server-side (routeset + adsbdb) and shares the result across devices, so
      // after the first lookup the board resolves from cache instantly.
      if (routeProxy) {
        const res = await fetchT(routeProxy, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planes: need.map(n => ({ callsign: n.cs, lat: n.lat, lng: n.lng })), fast: !doFallback }),
        }, 9000);
        if (res && res.ok) {
          let j = null;
          try { j = await res.json(); } catch (_) {}
          const m = (j && j.map) || {};
          for (const n of need) {
            // Only entries the proxy returned are definitive (a route, or a
            // confirmed null for a known-unknown callsign) — cache those. Omitted
            // callsigns (fast-mode skips, or transient upstream failures) are
            // left unresolved and uncached so a later pass retries them.
            if (Object.prototype.hasOwnProperty.call(m, n.cs)) {
              const r = m[n.cs];
              mem.set('rt.' + n.cs, r); lsSet('rt.' + n.cs, r); out[n.cs] = r;
            }
          }
          return out;
        }
        // proxy unreachable -> fall through to the direct cross-origin path
      }

      // 1) Try adsb.lol routeset (batched, position-aware) — map by the callsign
      //    in each result (the API may reorder / omit unknowns). Time-boxed so a
      //    slow request can't stall the board.
      let results = [];
      const ctrl = ('AbortController' in window) ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null;
      try {
        const res = await fetch('https://api.adsb.lol/api/0/routeset', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planes: need.map(n => ({ callsign: n.cs, lat: n.lat, lng: n.lng })) }),
          signal: ctrl ? ctrl.signal : undefined,
        });
        if (res.ok) { const j = await res.json(); if (Array.isArray(j)) results = j; }
      } catch (_) {} finally { if (timer) clearTimeout(timer); }
      const byCs = {};
      results.forEach(r => {
        if (!r || !r.callsign) return;
        const aps = r._airports;
        byCs[r.callsign.toUpperCase()] = (r.plausible && Array.isArray(aps) && aps.length >= 2)
          ? { origin: apRouteset(aps[0]), destination: apRouteset(aps[aps.length - 1]), approx: false } : null;
      });
      const fallback = [];
      for (const n of need) {
        const r = byCs[n.cs];
        if (r) { mem.set('rt.' + n.cs, r); lsSet('rt.' + n.cs, r); out[n.cs] = r; }
        else fallback.push(n.cs);
      }
      // 2) Fall back to adsbdb (GET, reliable) for anything routeset didn't
      //    return — only when asked (slow; the board does this in the background).
      if (doFallback) {
        await Promise.all(fallback.slice(0, 30).map(async cs => {
          let r = null;
          try { const a = await route(cs); if (a) r = { origin: a.origin, destination: a.destination, approx: true }; } catch (_) {}
          mem.set('rt.' + cs, r); lsSet('rt.' + cs, r); out[cs] = r;
        }));
        fallback.slice(30).forEach(cs => { out[cs] = null; });
      }
    }
    return out;
  }

  return { route, aircraft, resolve, resolveBatch };
})();
