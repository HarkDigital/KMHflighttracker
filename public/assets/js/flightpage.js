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

  function planeIcon(track) {
    return L.divIcon({ className: '',
      html: '<div class="plane-marker" style="transform:rotate(' + Math.round(track || 0) + 'deg)">✈</div>',
      iconSize: [24, 24], iconAnchor: [12, 12] });
  }

  async function buildMap(i) {
    await App.loadLeaflet();
    const mapEl = document.getElementById('fp-map');
    if (!window.L || !mapEl) return;
    if (map) { map.remove(); map = null; }
    map = L.map(mapEl, { zoomControl: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { attribution: '&copy; OSM &copy; CARTO', maxZoom: 11 }).addTo(map);
    layer = L.layerGroup().addTo(map);
    draw(i, true);
    setTimeout(() => { if (map) map.invalidateSize(); }, 80);
  }

  function draw(i, fit) {
    if (!map || !layer) return;
    layer.clearLayers();
    const pts = [], line = [];
    const from = i.from, to = i.to, ac = i.live;
    if (from.lat != null) {
      L.circleMarker([from.lat, from.lon], { radius: 5, color: '#38d66b', weight: 2, fillOpacity: 1 }).bindTooltip(from.iata || '').addTo(layer);
      pts.push([from.lat, from.lon]); line.push([from.lat, from.lon]);
    }
    if (ac && ac.lat != null) {
      L.marker([ac.lat, ac.lon], { icon: planeIcon(ac.track) }).addTo(layer);
      pts.push([ac.lat, ac.lon]); line.push([ac.lat, ac.lon]);
    }
    if (to.lat != null) {
      L.circleMarker([to.lat, to.lon], { radius: 5, color: '#ff5a52', weight: 2, fillOpacity: 1 }).bindTooltip(to.iata || '').addTo(layer);
      pts.push([to.lat, to.lon]); line.push([to.lat, to.lon]);
    }
    if (line.length >= 2) L.polyline(line, { color: '#f5b301', weight: 1.5, opacity: 0.7, dashArray: '4 6' }).addTo(layer);
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
    const i = await Flights.lookup(num);
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
  }

  async function refresh() {
    if (!cs || isHidden() || !info) return;
    let ac = null;
    try { const l = await Adsb.callsign(cs); ac = l && l[0]; } catch (_) {}
    info.live = ac ? { alt: ac.alt, gs: ac.gs, vs: ac.baroRate, track: ac.track, lat: ac.lat, lon: ac.lon } : info.live;
    const t = tele(info);
    const v = el.querySelectorAll('.fp-grid .fp-stat .v');
    if (v.length >= 4) { v[0].textContent = t.alt; v[1].textContent = t.gs; v[2].textContent = t.vs; v[3].textContent = t.hdg; }
    const dep = el.querySelector('#fp-dep'), eta = el.querySelector('#fp-eta');
    if (dep) dep.textContent = depTime(info);
    if (eta) eta.textContent = arrTime(info);
    draw(info, false);
  }

  window.Views = window.Views || {};
  window.Views.flight = {
    activate() { load(); clearInterval(timer); timer = setInterval(refresh, 15000); },
  };
})();
