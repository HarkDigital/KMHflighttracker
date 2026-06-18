/**
 * flights.js — one place to resolve a flight, returning a normalized shape no
 * matter the source. Prefers the accurate AeroDataBox data served by our PHP
 * cache (App.flightApi, present on IONOS); falls back to the free feeds
 * (adsbdb route + ADS-B live position) on GitHub Pages or if AeroDataBox fails.
 * Live position always comes from ADS-B and supplements either source.
 *
 * Speed: the schedule (route/times/aircraft) and the live ADS-B position are
 * fetched in parallel, each with a hard timeout, so one slow/absent feed never
 * stalls the page. With { skipLive:true } the schedule resolves on its own and
 * the caller folds live telemetry in afterwards (progressive render).
 */
window.Flights = (function () {
  'use strict';

  // Resolve to null after `ms` so a hung/absent feed can't block the page.
  function withTimeout(promise, ms) {
    return Promise.race([
      Promise.resolve(promise).catch(() => null),
      new Promise(resolve => setTimeout(() => resolve(null), ms)),
    ]);
  }

  async function live(cs) {
    const l = await withTimeout(Adsb.callsign(cs), 6000);
    return (l && l[0]) || null;
  }

  // AeroDataBox is keyed on the IATA flight number (DL2092), not the ICAO
  // callsign (DAL2092) that aircraft broadcast — convert back for the query.
  async function fetchAdb(callsign) {
    if (!App.flightApi) return null;
    const num = window.Airlines ? Airlines.toIata(callsign) : callsign;
    const ctrl = ('AbortController' in window) ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 12000) : null;
    try {
      const r = await fetch(App.flightApi + '?flight=' + encodeURIComponent(num),
        { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      if (r.ok) { const d = await r.json(); if (d && d.state === 'ready') return d; }
    } catch (_) {} finally { if (timer) clearTimeout(timer); }
    return null;
  }

  const ap = x => x ? {
    iata: x.iata || '', icao: x.icao || '', city: x.city || x.name || '', name: x.name || '',
    lat: x.lat, lon: x.lon, scheduled: x.scheduled || '', estimated: x.estimated || '',
    gate: x.gate || '', terminal: x.terminal || '',
  } : {};

  function fromAdb(d, ac) {
    return {
      source: 'adb',
      flight: d.flight || '', airline: d.airline || '',
      status: (d.status || '').toUpperCase() || 'SCHEDULED',
      aircraft: d.aircraft || (ac && ac.type) || '', reg: d.reg || (ac && ac.reg) || '',
      airborne: !!ac && ac.alt !== 'ground',
      live: ac ? { hex: ac.hex, alt: ac.alt, gs: ac.gs, vs: ac.baroRate, track: ac.track, lat: ac.lat, lon: ac.lon } : null,
      from: ap(d.from), to: ap(d.to), approx: false,
    };
  }

  function fromFree(rt, ac, acInfo, cs) {
    return {
      source: 'free',
      flight: cs, airline: (window.Airlines ? Airlines.airlineOf(cs) : '') || '',
      status: !ac ? 'NOT AIRBORNE' : (ac.alt === 'ground' ? 'ON GROUND' : 'EN ROUTE'),
      aircraft: (ac && ac.type) || (acInfo && acInfo.type) || '', reg: (ac && ac.reg) || (acInfo && acInfo.reg) || '',
      airborne: !!ac && ac.alt !== 'ground',
      live: ac ? { hex: ac.hex, alt: ac.alt, gs: ac.gs, vs: ac.baroRate, track: ac.track, lat: ac.lat, lon: ac.lon } : null,
      from: ap(rt && rt.origin), to: ap(rt && rt.destination), approx: !!(rt && rt.approx),
    };
  }

  async function lookup(callsign, opts) {
    callsign = (callsign || '').trim().toUpperCase();
    // Kick off live ADS-B and the AeroDataBox schedule together.
    const livePromise = (opts && opts.skipLive) ? Promise.resolve(null) : live(callsign);
    const d = await fetchAdb(callsign);
    if (d) return fromAdb(d, await livePromise);

    // Free fallback: route from adsbdb (uses live position to disambiguate when
    // we have it), aircraft from registration.
    const ac = await livePromise;
    let rt = null, acInfo = null;
    try { rt = await Adsbdb.resolve(callsign, ac && ac.lat, ac && ac.lon); } catch (_) {}
    try { if (ac && (ac.reg || ac.hex)) acInfo = await Adsbdb.aircraft(ac.reg || ac.hex); } catch (_) {}
    return fromFree(rt, ac, acInfo, callsign);
  }

  return { lookup, live };
})();
