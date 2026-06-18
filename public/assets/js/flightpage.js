/**
 * flightpage.js — individual flight profile. Uses Flights.lookup (AeroDataBox
 * when available, else free feeds) for route/status/aircraft/scheduled times,
 * and live ADS-B for position + telemetry, refreshing every 15s.
 */
(function () {
  'use strict';

  const el = document.getElementById('flight-detail');
  let cs = null, timer = null, map = null, layer = null, info = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  const isHidden = () => {
    const v = document.querySelector('[data-view="flight"]');
    return !v || v.classList.contains('hidden');
  };

  const toRad = d => d * Math.PI / 180;
  function havNm(la1, lo1, la2, lo2) {
    const R = 3440.065;
    const dLa = toRad(la2 - la1), dLo = toRad(lo2 - lo1);
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  const p2 = n => String(n).padStart(2, '0');
  const hm = d => p2(d.getHours()) + ':' + p2(d.getMinutes());

  // Displayed dep/arr times: prefer real scheduled/estimated; else estimate from
  // live position + ground speed.
  function depTime(i) {
    if (i.from.estimated) return i.from.estimated;
    if (i.from.scheduled) return i.from.scheduled;
    const ac = i.live;
    if (ac && ac.gs > 40 && ac.alt !== 'ground' && i.from.lat != null)
      return '~' + hm(new Date(Date.now() - havNm(i.from.lat, i.from.lon, ac.lat, ac.lon) / ac.gs * 3600000));
    return '—';
  }
  function arrTime(i) {
    if (i.to.estimated) return i.to.estimated;
    if (i.to.scheduled) return i.to.scheduled;
    const ac = i.live;
    if (ac && ac.gs > 40 && ac.alt !== 'ground' && i.to.lat != null)
      return '~' + hm(new Date(Date.now() + havNm(ac.lat, ac.lon, i.to.lat, i.to.lon) / ac.gs * 3600000));
    return '—';
  }
  function tele(i) {
    const ac = i.live;
    return {
      alt: ac && typeof ac.alt === 'number' ? ac.alt.toLocaleString() + ' ft' : (ac && ac.alt === 'ground' ? 'GND' : '—'),
      gs:  ac && ac.gs ? Math.round(ac.gs) + ' kt' : '—',
      vs:  ac && ac.vs != null ? (ac.vs > 0 ? '+' : '') + Math.round(ac.vs) + ' fpm' : '—',
      hdg: ac && ac.track != null ? Math.round(ac.track) + '°' : '—',
    };
  }

  function wireBack() {
    const b = el.querySelector('.fp-back');
    if (b) b.addEventListener('click', () => App.closeFlight());
  }
  function stat(v, k) { return '<div class="fp-stat"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>'; }

  function skeleton(num) {
    el.innerHTML = '<button class="fp-back">‹ Back</button>' +
      '<div class="fp-head"><span class="fp-num">' + esc(num) + '</span></div>' +
      '<div class="empty">Looking up ' + esc(num) + '…</div>';
    wireBack();
  }

  function render(num, i) {
    const t = tele(i);
    const from = i.from, to = i.to;
    const gates = [];
    if (from.gate || from.terminal) gates.push('Dep ' + esc((from.terminal ? 'T' + from.terminal + ' ' : '') + (from.gate ? 'Gate ' + from.gate : '')).trim());
    if (to.gate || to.terminal) gates.push('Arr ' + esc((to.terminal ? 'T' + to.terminal + ' ' : '') + (to.gate ? 'Gate ' + to.gate : '')).trim());
    const starred = App.Stars.has(num);

    el.innerHTML =
      '<button class="fp-back">‹ Back</button>' +
      '<div class="fp-head"><span class="fp-num">' + esc(num) + '</span>' +
        '<span class="fp-status ' + App.statusClass(i.status) + '">' + esc(i.status) + '</span></div>' +
      (i.airline ? '<div class="fp-airline">' + esc(i.airline) + '</div>' : '') +
      '<div class="fp-route">' +
        '<div class="fp-ap"><div class="code">' + esc(from.iata || from.icao || '???') + '</div>' +
          '<div class="city">' + esc(from.city || '') + '</div></div>' +
        '<div class="fp-arrow">✈</div>' +
        '<div class="fp-ap"><div class="code">' + esc(to.iata || to.icao || '???') + '</div>' +
          '<div class="city">' + esc(to.city || '') + '</div></div>' +
      '</div>' +
      '<div class="fp-times">' +
        '<div class="fp-stat"><div class="v" id="fp-dep">' + depTime(i) + '</div><div class="k">' +
          (from.scheduled || from.estimated ? 'Departure' : 'Est. takeoff') + '</div></div>' +
        '<div class="fp-stat"><div class="v" id="fp-eta">' + arrTime(i) + '</div><div class="k">' +
          (to.scheduled || to.estimated ? 'Arrival' : 'Est. landing (ETA)') + '</div></div>' +
      '</div>' +
      (gates.length ? '<div class="fp-meta">' + gates.join(' &middot; ') + '</div>' : '') +
      '<div class="fp-grid">' +
        stat(t.alt, 'Altitude') + stat(t.gs, 'Ground speed') + stat(t.vs, 'Vert. speed') +
        stat(t.hdg, 'Heading') + stat(esc(i.aircraft || '—'), 'Aircraft') + stat(esc(i.reg || '—'), 'Registration') +
      '</div>' +
      '<div class="fp-meta"><button class="fp-star ' + (starred ? 'on' : '') + '">' +
        (starred ? '★ Tracked' : '☆ Track') + '</button></div>' +
      '<div id="fp-map"></div>' +
      '<div class="fp-note">' + (i.source === 'adb'
        ? 'Schedule from AeroDataBox; live position from ADS-B.'
        : (i.airborne ? 'Live position from ADS-B. Route is best-effort from community data' + (i.approx ? ' and may be approximate' : '') + '.'
          : 'Not broadcasting a position right now. Route is a typical/last-known route from community data and may be out of date.')) + '</div>';

    wireBack();
    const sb = el.querySelector('.fp-star');
    if (sb) sb.addEventListener('click', () => {
      const on = App.Stars.toggle(num);
      sb.classList.toggle('on', on);
      sb.textContent = on ? '★ Tracked' : '☆ Track';
    });
    buildMap(i);
  }

  // Bearing (deg clockwise from north) from one point to another.
  function bearingTo(la1, lo1, la2, lo2) {
    const p1 = toRad(la1), p2 = toRad(la2), dl = toRad(lo2 - lo1);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  // SVG plane that points straight up at 0deg, so rotate(bearing) aims the nose
  // exactly along the given bearing (no built-in glyph tilt like the ✈ char).
  function planeIcon(deg) {
    return L.divIcon({ className: '',
      html: '<div class="plane-marker" style="transform:rotate(' + Math.round(deg || 0) + 'deg)">' +
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">' +
        '<path d="M12 2c-.6 0-1 .9-1 2.3V9L3 13.4v1.6l8-2.2v4.3l-2 1.5v1.3l3-.8 3 .8v-1.3l-2-1.5v-4.3l8 2.2v-1.6L13 9V4.3C13 2.9 12.6 2 12 2z"/>' +
        '</svg></div>',
      iconSize: [22, 22], iconAnchor: [11, 11] });
  }

  async function buildMap(i) {
    await App.loadLeaflet();
    const mapEl = document.getElementById('fp-map');
    if (!window.L || !mapEl) return;
    if (map) { map.remove(); map = null; }
    map = L.map(mapEl, { zoomControl: true });
    map.attributionControl.setPrefix(false);   // drop the "Leaflet" link
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { attribution: 'OSM · CARTO', maxZoom: 11 }).addTo(map);
    layer = L.layerGroup().addTo(map);
    draw(i, true);
    setTimeout(() => { if (map) map.invalidateSize(); }, 80);
  }

  // Points along the great-circle (shortest path over the globe) between two
  // coords, so the route reads as a curve rather than a flat straight line.
  function greatCircle(a, b, segs) {
    const la1 = toRad(a[0]), lo1 = toRad(a[1]), la2 = toRad(b[0]), lo2 = toRad(b[1]);
    const dLat = la2 - la1, dLon = lo2 - lo1;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    const d = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
    if (!d) return [a, b];
    const out = [];
    for (let i = 0; i <= segs; i++) {
      const f = i / segs;
      const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
      const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
      const z = A * Math.sin(la1) + B * Math.sin(la2);
      out.push([Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI, Math.atan2(y, x) * 180 / Math.PI]);
    }
    return out;
  }

  function draw(i, fit) {
    if (!map || !layer) return;
    layer.clearLayers();
    const pts = [];
    const from = i.from, to = i.to, ac = i.live;
    const hasAc = ac && ac.lat != null;
    const acPt = hasAc ? [ac.lat, ac.lon] : null;
    const ROUTE = { color: '#f5b301', weight: 1.5, opacity: 0.4, dashArray: '4 6' };
    const FLOWN = { color: '#f5b301', weight: 2.6, opacity: 0.95 };

    // Real flown track (ADS-B history) when we have it; else a great-circle.
    if (i.trace && i.trace.length > 1) {
      const t = i.trace.slice();
      if (hasAc) t.push(acPt);                                   // extend to the live point
      L.polyline(t, FLOWN).addTo(layer);
      if (hasAc && to.lat != null)                              // remaining leg, curved + dashed
        L.polyline(greatCircle(acPt, [to.lat, to.lon], 48), ROUTE).addTo(layer);
    } else if (hasAc) {
      if (from.lat != null) L.polyline(greatCircle([from.lat, from.lon], acPt, 48), { color: '#f5b301', weight: 2.2, opacity: 0.85 }).addTo(layer);
      if (to.lat != null)   L.polyline(greatCircle(acPt, [to.lat, to.lon], 48), ROUTE).addTo(layer);
    } else if (from.lat != null && to.lat != null) {
      L.polyline(greatCircle([from.lat, from.lon], [to.lat, to.lon], 64), Object.assign({}, ROUTE, { opacity: 0.6 })).addTo(layer);
    }

    if (from.lat != null) {
      L.circleMarker([from.lat, from.lon], { radius: 5, color: '#38d66b', weight: 2, fillOpacity: 1 }).bindTooltip(from.iata || '').addTo(layer);
      pts.push([from.lat, from.lon]);
    }
    if (hasAc) {
      // Always aim the plane at the destination dot (fall back to its live
      // heading only if we don't have destination coordinates).
      const head = (to && to.lat != null) ? bearingTo(ac.lat, ac.lon, to.lat, to.lon) : ac.track;
      L.marker(acPt, { icon: planeIcon(head) }).addTo(layer);
      pts.push(acPt);
    }
    if (to.lat != null) {
      L.circleMarker([to.lat, to.lon], { radius: 5, color: '#ff5a52', weight: 2, fillOpacity: 1 }).bindTooltip(to.iata || '').addTo(layer);
      pts.push([to.lat, to.lon]);
    }
    if (fit && pts.length === 1) map.setView(pts[0], 7);
    else if (fit && pts.length) map.fitBounds(pts, { padding: [30, 30] });
    else if (fit) map.setView([39.87, -75.24], 4);
  }

  // Overlay a board-supplied airport onto a looked-up one, preferring the board's
  // identity/coords but keeping any scheduled times/gate the lookup found.
  function mergeAp(base, hint) {
    base = base || {}; hint = hint || {};
    return {
      iata: hint.iata || base.iata || '', icao: hint.icao || base.icao || '',
      city: hint.city || base.city || '', name: hint.name || base.name || '',
      lat: hint.lat != null ? hint.lat : base.lat,
      lon: hint.lon != null ? hint.lon : base.lon,
      scheduled: base.scheduled || '', estimated: base.estimated || '',
      gate: base.gate || '', terminal: base.terminal || '',
    };
  }

  const eqCode = (a, b) => !!a && !!b && String(a).toUpperCase() === String(b).toUpperCase();
  const sameAp = (a, b) => eqCode(a && a.iata, b && b.iata) || eqCode(a && a.icao, b && b.icao);
  // Does a looked-up route describe the same physical hop the board showed?
  function routeMatches(i, hint) {
    return i && i.from && i.to && hint &&
      sameAp(i.from, hint.from) && sameAp(i.to, hint.to);
  }

  async function load() {
    const num = App.flight; cs = num;
    const hint = App.flightHint;
    if (!num) { el.innerHTML = '<div class="empty">No flight selected.</div>'; return; }
    skeleton(num);
    // Fetch live ADS-B in parallel but DON'T wait on it — the schedule is the
    // primary content and live position is often slow or absent. Render the
    // schedule as soon as it's ready, then fold telemetry in below.
    const livePromise = Flights.live(num);
    const i = await Flights.lookup(num, { skipLive: true });
    if (cs !== num) return;
    // When opened from the board, the board's route is the physical aircraft the
    // user tapped. AeroDataBox (looked up by flight number) can land on a
    // different leg/codeshare, so it's only trusted to enrich (times, gate) when
    // its route AGREES with the board. If it disagrees — or we're on free data —
    // we keep the board's route so the page can never show a different flight.
    if (hint) {
      if (i.source === 'adb' && routeMatches(i, hint)) {
        i.from = mergeAp(i.from, hint.from);   // keep ADB times, board identity
        i.to = mergeAp(i.to, hint.to);
      } else {
        i.from = mergeAp(null, hint.from);     // board route only (no stray times)
        i.to = mergeAp(null, hint.to);
        i.approx = i.source === 'adb' ? true : i.approx;
        if (i.source === 'adb') i.source = 'free';
      }
    }
    info = i;
    render(num, i);
    const ac = await livePromise;              // arrives a beat later (or never)
    if (cs === num && ac) applyAc(ac);
    loadTrace(num);                            // overlay the real flown path
  }

  // Fetch the aircraft's real ADS-B track (server-cached) and draw it. Silent
  // no-op (great-circle stays) when there's no hex or the trace isn't available.
  async function loadTrace(num) {
    const cfg = window.APP_CONFIG || {};
    const hex = info && info.live && String(info.live.hex || '').toLowerCase().replace(/[^0-9a-f]/g, '');
    if (!cfg.traceApi || !hex || hex.length < 6) return;
    try {
      const r = await fetch(cfg.traceApi + '?hex=' + hex, { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      const t = j && j.trace;
      if (cs === num && info && Array.isArray(t) && t.length > 1) { info.trace = t; draw(info, false); }
    } catch (_) {}
  }

  // Apply a live ADS-B reading to the open page: telemetry tiles, computed
  // dep/arr times, status (free source only) and the map marker.
  function applyAc(ac) {
    if (!info) return;
    if (ac) {
      info.live = { hex: ac.hex, alt: ac.alt, gs: ac.gs, vs: ac.baroRate, track: ac.track, lat: ac.lat, lon: ac.lon };
      info.airborne = ac.alt !== 'ground';
      if (info.source === 'free') {
        const s = ac.alt === 'ground' ? 'ON GROUND' : 'EN ROUTE';
        const pill = el.querySelector('.fp-status');
        if (info.status !== s && pill) { info.status = s; pill.className = 'fp-status ' + App.statusClass(s); pill.textContent = s; }
      }
    }
    const t = tele(info);
    const v = el.querySelectorAll('.fp-grid .fp-stat .v');
    if (v.length >= 4) { v[0].textContent = t.alt; v[1].textContent = t.gs; v[2].textContent = t.vs; v[3].textContent = t.hdg; }
    const dep = el.querySelector('#fp-dep'), eta = el.querySelector('#fp-eta');
    if (dep) dep.textContent = depTime(info);
    if (eta) eta.textContent = arrTime(info);
    draw(info, false);
  }

  let refreshN = 0;
  async function refresh() {
    if (!cs || isHidden() || !info) return;
    let ac = null;
    try { const l = await Adsb.callsign(cs); ac = l && l[0]; } catch (_) {}
    applyAc(ac);
    // Extend the flown track roughly once a minute (server cache makes it cheap).
    if (++refreshN % 4 === 0) loadTrace(cs);
  }

  window.Views = window.Views || {};
  window.Views.flight = {
    activate() { load(); clearInterval(timer); timer = setInterval(refresh, 15000); },
  };
})();
