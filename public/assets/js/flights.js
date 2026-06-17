/**
 * flights.js — one place to resolve a flight, returning a normalized shape no
 * matter the source. Prefers the accurate AeroDataBox data served by our PHP
 * cache (App.flightApi, present on IONOS); falls back to the free feeds
 * (adsbdb route + ADS-B live position) on GitHub Pages or if AeroDataBox fails.
 * Live position always comes from ADS-B and supplements either source.
 */
window.Flights = (function () {
  'use strict';

  async function live(cs) {
    try { const l = await Adsb.callsign(cs); return (l && l[0]) || null; } catch (_) { return null; }
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
      live: ac ? { alt: ac.alt, gs: ac.gs, vs: ac.baroRate, track: ac.track, lat: ac.lat, lon: ac.lon } : null,
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
      live: ac ? { alt: ac.alt, gs: ac.gs, vs: ac.baroRate, track: ac.track, lat: ac.lat, lon: ac.lon } : null,
      from: ap(rt && rt.origin), to: ap(rt && rt.destination), approx: !!(rt && rt.approx),
    };
  }

  async function lookup(callsign) {
    callsign = (callsign || '').trim().toUpperCase();
    const ac = await live(callsign);
    if (App.flightApi) {
      // AeroDataBox is keyed on the IATA flight number (DL2092), not the ICAO
      // callsign (DAL2092) that aircraft broadcast — convert back for the query.
      const num = window.Airlines ? Airlines.toIata(callsign) : callsign;
      try {
        const r = await fetch(App.flightApi + '?flight=' + encodeURIComponent(num), { cache: 'no-store' });
        if (r.ok) { const d = await r.json(); if (d && d.state === 'ready') return fromAdb(d, ac); }
      } catch (_) {}
    }
    let rt = null, acInfo = null;
    try { rt = await Adsbdb.resolve(callsign, ac && ac.lat, ac && ac.lon); } catch (_) {}
    try { if (ac && (ac.reg || ac.hex)) acInfo = await Adsbdb.aircraft(ac.reg || ac.hex); } catch (_) {}
    return fromFree(rt, ac, acInfo, callsign);
  }

  return { lookup };
})();
