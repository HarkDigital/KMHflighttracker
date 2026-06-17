/**
 * flightpage.js — the individual flight profile. Reached by tapping a flight on
 * the board, in Tracked, on the radar, or via the Track tab. Shows route, live
 * altitude / ground speed / vertical speed / heading, aircraft type & reg, and
 * a map with origin, destination, the aircraft, and the route line. Live data
 * refreshes every 10s.
 */
(function () {
  'use strict';

  const el = document.getElementById('flight-detail');
  let cs = null, timer = null, map = null, layer = null, route = null;

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
  function times(ac, from, to) {
    let dep = '—', eta = '—';
    if (ac && typeof ac.lat === 'number' && ac.gs > 40 && ac.alt !== 'ground') {
      if (to && to.lat != null) eta = '~' + hm(new Date(Date.now() + havNm(ac.lat, ac.lon, to.lat, to.lon) / ac.gs * 3600000));
      if (from && from.lat != null) dep = '~' + hm(new Date(Date.now() - havNm(from.lat, from.lon, ac.lat, ac.lon) / ac.gs * 3600000));
    }
    return { dep, eta };
  }

  function tele(ac) {
    return {
      alt: ac && typeof ac.alt === 'number' ? ac.alt.toLocaleString() + ' ft'
           : (ac && ac.alt === 'ground' ? 'GND' : '—'),
      gs:  ac && ac.gs ? Math.round(ac.gs) + ' kt' : '—',
      vs:  ac && ac.baroRate != null ? (ac.baroRate > 0 ? '+' : '') + Math.round(ac.baroRate) + ' fpm' : '—',
      hdg: ac && ac.track != null ? Math.round(ac.track) + '°' : '—',
    };
  }

  function wireBack() {
    const b = el.querySelector('.fp-back');
    if (b) b.addEventListener('click', () => App.closeFlight());
  }

  function skeleton(num) {
    el.innerHTML = '<button class="fp-back">‹ Back</button>' +
      '<div class="fp-head"><span class="fp-num">' + esc(num) + '</span></div>' +
      '<div class="empty">Loading live data…</div>';
    wireBack();
  }

  function render(num, ac, rt, acInfo) {
    const status = !ac ? 'NOT AIRBORNE' : (ac.alt === 'ground' ? 'ON GROUND' : 'EN ROUTE');
    const from = rt && rt.origin, to = rt && rt.destination;
    const type = (ac && ac.type) || (acInfo && acInfo.type) || '';
    const reg = (ac && ac.reg) || (acInfo && acInfo.reg) || '';
    const t = tele(ac);
    const tt = times(ac, from, to);
    const airline = window.Airlines ? Airlines.airlineOf(num) : '';
    const starred = App.Stars.has(num);

    el.innerHTML =
      '<button class="fp-back">‹ Back</button>' +
      '<div class="fp-head"><span class="fp-num">' + esc(num) + '</span>' +
        '<span class="fp-status ' + App.statusClass(status) + '">' + status + '</span></div>' +
      (airline ? '<div class="fp-airline">' + esc(airline) + '</div>' : '') +
      '<div class="fp-route">' +
        '<div class="fp-ap"><div class="code">' + esc(from && (from.iata || from.icao) || '???') + '</div>' +
          '<div class="city">' + esc(from && (from.city || from.name) || '') + '</div></div>' +
        '<div class="fp-arrow">✈</div>' +
        '<div class="fp-ap"><div class="code">' + esc(to && (to.iata || to.icao) || '???') + '</div>' +
          '<div class="city">' + esc(to && (to.city || to.name) || '') + '</div></div>' +
      '</div>' +
      '<div class="fp-times">' +
        '<div class="fp-stat"><div class="v" id="fp-dep">' + tt.dep + '</div><div class="k">Est. takeoff</div></div>' +
        '<div class="fp-stat"><div class="v" id="fp-eta">' + tt.eta + '</div><div class="k">Est. landing (ETA)</div></div>' +
      '</div>' +
      '<div class="fp-grid">' +
        stat(t.alt, 'Altitude') + stat(t.gs, 'Ground speed') + stat(t.vs, 'Vert. speed') +
        stat(t.hdg, 'Heading') + stat(esc(type || '—'), 'Aircraft') + stat(esc(reg || '—'), 'Registration') +
      '</div>' +
      '<div class="fp-meta"><button class="fp-star ' + (starred ? 'on' : '') + '">' +
        (starred ? '★ Tracked' : '☆ Track') + '</button></div>' +
      '<div id="fp-map"></div>' +
      '<div class="fp-note">' + (ac
        ? 'Live position from ADS-B. Route is best-effort from community data' + (rt && rt.approx ? ' and may be approximate' : '') + '.'
        : 'This flight isn\'t broadcasting a position right now, so there\'s no live data. The route shown is a typical/last-known route from community data and may be out of date for today.')
      + '</div>';

    wireBack();
    const sb = el.querySelector('.fp-star');
    if (sb) sb.addEventListener('click', () => {
      const on = App.Stars.toggle(num);
      sb.classList.toggle('on', on);
      sb.textContent = on ? '★ Tracked' : '☆ Track';
    });
    buildMap(ac, from, to);
  }
  function stat(v, k) { return '<div class="fp-stat"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>'; }

  function planeIcon(track) {
    return L.divIcon({ className: '',
      html: '<div class="plane-marker" style="transform:rotate(' + Math.round(track || 0) + 'deg)">✈</div>',
      iconSize: [24, 24], iconAnchor: [12, 12] });
  }

  async function buildMap(ac, from, to) {
    await App.loadLeaflet();
    const mapEl = document.getElementById('fp-map');
    if (!window.L || !mapEl) return;
    if (map) { map.remove(); map = null; }
    map = L.map(mapEl, { zoomControl: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { attribution: '&copy; OSM &copy; CARTO', maxZoom: 11 }).addTo(map);
    layer = L.layerGroup().addTo(map);
    draw(ac, from, to, true);
    setTimeout(() => { if (map) map.invalidateSize(); }, 80);
  }

  function draw(ac, from, to, fit) {
    if (!map || !layer) return;
    layer.clearLayers();
    const pts = [], line = [];
    if (from && from.lat != null) {
      L.circleMarker([from.lat, from.lon], { radius: 5, color: '#38d66b', weight: 2, fillOpacity: 1 })
        .bindTooltip(from.iata || from.icao || '').addTo(layer);
      pts.push([from.lat, from.lon]); line.push([from.lat, from.lon]);
    }
    if (ac && ac.lat != null) {
      L.marker([ac.lat, ac.lon], { icon: planeIcon(ac.track) }).addTo(layer);
      pts.push([ac.lat, ac.lon]); line.push([ac.lat, ac.lon]);
    }
    if (to && to.lat != null) {
      L.circleMarker([to.lat, to.lon], { radius: 5, color: '#ff5a52', weight: 2, fillOpacity: 1 })
        .bindTooltip(to.iata || to.icao || '').addTo(layer);
      pts.push([to.lat, to.lon]); line.push([to.lat, to.lon]);
    }
    if (line.length >= 2) L.polyline(line, { color: '#f5b301', weight: 1.5, opacity: 0.7, dashArray: '4 6' }).addTo(layer);
    if (fit && pts.length === 1) map.setView(pts[0], 8);
    else if (fit && pts.length) map.fitBounds(pts, { padding: [30, 30] });
    else if (fit) map.setView([39.87, -75.24], 4);
  }

  async function load() {
    const num = App.flight; cs = num;
    if (!num) { el.innerHTML = '<div class="empty">No flight selected.</div>'; return; }
    skeleton(num);
    let ac = null, rt = null, acInfo = null;
    try { const live = await Adsb.callsign(num); ac = live && live[0]; } catch (_) {}
    try { rt = await Adsbdb.resolve(num, ac && ac.lat, ac && ac.lon); } catch (_) {}
    try { if (ac && (ac.reg || ac.hex)) acInfo = await Adsbdb.aircraft(ac.reg || ac.hex); } catch (_) {}
    if (cs !== num) return;     // user opened a different flight meanwhile
    route = rt;
    render(num, ac, rt, acInfo);
  }

  async function refresh() {
    if (!cs || isHidden()) return;
    let ac = null;
    try { const live = await Adsb.callsign(cs); ac = live && live[0]; } catch (_) {}
    const t = tele(ac);
    const grid = el.querySelector('.fp-grid');
    if (grid) {
      const v = grid.querySelectorAll('.fp-stat .v');
      if (v.length >= 4) { v[0].textContent = t.alt; v[1].textContent = t.gs; v[2].textContent = t.vs; v[3].textContent = t.hdg; }
    }
    const tt = times(ac, route && route.origin, route && route.destination);
    const dep = el.querySelector('#fp-dep'), eta = el.querySelector('#fp-eta');
    if (dep) dep.textContent = tt.dep;
    if (eta) eta.textContent = tt.eta;
    draw(ac, route && route.origin, route && route.destination, false);
  }

  window.Views = window.Views || {};
  window.Views.flight = {
    activate() { load(); clearInterval(timer); timer = setInterval(refresh, 10000); },
  };
})();
