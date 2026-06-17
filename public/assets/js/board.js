/**
 * board.js — live arrivals/departures board from free keyless feeds.
 *
 * Direction comes from the physical signal (a low aircraft near the field that
 * is climbing is departing; descending is arriving) — reliable for terminal-area
 * traffic. The route lookup (routeset + adsbdb fallback) supplies the OTHER
 * airport: we always show the route endpoint that is NOT this airport, so a PHL
 * board never shows "to PHL".
 *
 * Columns: TIME | FLIGHT | DESTINATION/ORIGIN | ALT | STATUS | ★
 */
(function () {
  'use strict';

  const COLS = [
    { key: 'time',   w: 5,  cls: 'col-time' },
    { key: 'flight', w: 7,  cls: 'col-flight' },
    { key: 'place',  w: 18, cls: 'col-dest' },
    { key: 'alt',    w: 6,  cls: 'col-alt' },
    { key: 'status', w: 9,  cls: 'col-status' },
  ];
  const RADIUS_NM = 90;
  const MAX_ROWS = 14;

  const listEl    = document.getElementById('board-list');
  const noteEl    = document.getElementById('board-note');
  const updatedEl = document.querySelector('.topbar .updated');
  const destHead  = document.querySelector('.board-head .col-dest');
  const seg       = document.querySelectorAll('#board-controls .seg button');

  let type = 'departures';
  let timer = null;
  let firstPaint = true;
  const rowPool = [];
  const seenClock = new Map();

  const toRad = d => d * Math.PI / 180;
  function haversineNm(la1, lo1, la2, lo2) {
    const R = 3440.065;
    const dLat = toRad(la2 - la1), dLon = toRad(lo2 - lo1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function bearing(la1, lo1, la2, lo2) {
    const y = Math.sin(toRad(lo2 - lo1)) * Math.cos(toRad(la2));
    const x = Math.cos(toRad(la1)) * Math.sin(toRad(la2)) -
      Math.sin(toRad(la1)) * Math.cos(toRad(la2)) * Math.cos(toRad(lo2 - lo1));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  const pad = n => String(n).padStart(2, '0');
  const hhmm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());

  const cacheKey = icao => 'kmh.board.' + icao + '.' + type;
  function saveCache(icao, rows) { try { localStorage.setItem(cacheKey(icao), JSON.stringify({ t: Date.now(), rows })); } catch (_) {} }
  function loadCache(icao) {
    try { const v = JSON.parse(localStorage.getItem(cacheKey(icao))); if (v && Date.now() - v.t < 1800000) return v.rows; } catch (_) {}
    return null;
  }

  function buildRow() {
    const el = document.createElement('div');
    el.className = 'board-row';
    const fields = {};
    COLS.forEach(c => {
      const cell = document.createElement('div');
      cell.className = c.cls;
      fields[c.key] = new FlapText(cell, c.w);
      el.appendChild(cell);
    });
    const star = document.createElement('div');
    star.className = 'col-star star';
    star.textContent = '☆';
    star.addEventListener('click', e => {
      e.stopPropagation();
      const n = star.dataset.flight;
      if (!n) return;
      const on = App.Stars.toggle(n);
      star.classList.toggle('on', on);
      star.textContent = on ? '★' : '☆';
    });
    el.appendChild(star);
    el.addEventListener('click', () => { if (el.dataset.flight) App.openFlight(el.dataset.flight, el._hint); });
    return { el, fields, star };
  }

  function render(rows, immediate) {
    if (noteEl) noteEl.classList.toggle('hidden', rows.length > 0);
    while (rowPool.length < rows.length) { const r = buildRow(); rowPool.push(r); listEl.appendChild(r.el); }
    while (rowPool.length > rows.length) { rowPool.pop().el.remove(); }
    rows.forEach((row, i) => {
      const r = rowPool[i];
      COLS.forEach(c => {
        const txt = c.key === 'place'
          ? (row.placeIata ? row.placeIata + ' ' + row.place : row.place)
          : row[c.key];
        r.fields[c.key].set(txt || '', immediate);
      });
      r.el.querySelector('.col-status').className = 'col-status ' + App.statusClass(row.status);
      // Carry the route we resolved into the detail page so the tapped flight
      // and the page it opens always agree.
      r.el._hint = (row.from && row.to) ? { from: row.from, to: row.to, status: row.status } : null;
      const n = (row.flight || '').toUpperCase();
      r.el.dataset.flight = n;
      r.star.dataset.flight = n;
      const on = App.Stars.has(n);
      r.star.classList.toggle('on', on);
      r.star.textContent = on ? '★' : '☆';
    });
  }

  function classify(list, ap) {
    const rows = [];
    for (const a of list) {
      if (!a.callsign) continue;
      if (/^N\d/.test(a.callsign)) continue;           // skip US private/GA
      const altN = a.alt === 'ground' ? 0 : (typeof a.alt === 'number' ? a.alt : null);
      if (altN === null || altN > 20000) continue;      // terminal area only
      const dist = haversineNm(ap.lat, ap.lon, a.lat, a.lon);
      if (dist > RADIUS_NM) continue;

      let dir = null;
      if (a.baroRate > 250 && dist < 60) dir = 'departures';
      else if (a.baroRate < -250 && dist < 80) dir = 'arrivals';
      else if (Math.abs(a.baroRate) <= 250 && altN < 8000 && dist < 25) {
        const diff = Math.abs(((a.track - bearing(a.lat, a.lon, ap.lat, ap.lon) + 540) % 360) - 180);
        dir = diff < 90 ? 'arrivals' : 'departures';
      }
      if (dir !== type) continue;

      let time = '';
      if (type === 'arrivals') { if (a.gs > 40) time = hhmm(new Date(Date.now() + dist / a.gs * 3600000)); }
      else { if (!seenClock.has(a.callsign)) seenClock.set(a.callsign, hhmm(new Date())); time = seenClock.get(a.callsign); }

      rows.push({
        callsign: a.callsign, flight: a.callsign, reg: a.reg, aircraft: a.type,
        dist, gs: a.gs, time, status: type === 'arrivals' ? 'ARRIVING' : 'DEPARTING',
        alt: a.alt === 'ground' ? 'GND' : String(Math.round(altN / 100) * 100),
        lat: a.lat, lon: a.lon, place: '', placeIata: '', hasRoute: false,
      });
    }
    rows.sort((x, y) => x.dist - y.dist);
    return rows.slice(0, 24);
  }

  function apMatch(rapt, ap) {
    if (!rapt) return false;
    const i = (rapt.iata || '').toUpperCase(), c = (rapt.icao || '').toUpperCase();
    return (i && i === (ap.iata || '').toUpperCase()) || (c && c === (ap.icao || '').toUpperCase());
  }

  async function enrich(rows, ap) {
    const map = await Adsbdb.resolveBatch(rows.map(r => ({ callsign: r.callsign, lat: r.lat, lon: r.lon })));
    rows.forEach(row => {
      const rt = map[(row.callsign || '').toUpperCase()];
      if (!rt || !rt.origin || !rt.destination) return;
      const oM = apMatch(rt.origin, ap), dM = apMatch(rt.destination, ap);
      let other;
      if (oM && !dM) other = rt.destination;            // this airport is origin -> show destination
      else if (dM && !oM) other = rt.origin;            // this airport is destination -> show origin
      else other = type === 'arrivals' ? rt.origin : rt.destination;   // no clear match: directional default
      if (other) {
        row.place = (other.city || other.name || other.iata || '').toUpperCase();
        row.placeIata = (other.iata || '').toUpperCase();
        row.hasRoute = true;
        // Full origin/destination for the detail page. "Here" is this airport;
        // the other endpoint is what the route lookup gave us.
        const here = { iata: ap.iata || '', icao: ap.icao || '', city: ap.name || '',
                       name: ap.name || '', lat: ap.lat, lon: ap.lon };
        if (type === 'arrivals') { row.from = other; row.to = here; }
        else { row.from = here; row.to = other; }
      }
    });
    rows.sort((x, y) => (x.hasRoute === y.hasRoute) ? x.dist - y.dist : (x.hasRoute ? -1 : 1));
  }

  async function poll() {
    const ap = App.airport;
    if (!ap) return;
    if (destHead) destHead.textContent = type === 'arrivals' ? 'Origin' : 'Destination';

    let showed = false;
    if (firstPaint) {
      const cached = loadCache(ap.icao);
      if (cached && cached.length) { render(cached, true); showed = true; if (updatedEl) updatedEl.textContent = 'LIVE • ' + cached.length + ' ' + type; }
      else if (noteEl) { noteEl.textContent = 'Loading live traffic near ' + ap.name + '…'; noteEl.classList.remove('hidden'); }
    }

    const list = await Adsb.point(ap.lat, ap.lon, RADIUS_NM);
    if (list === null) { if (updatedEl) updatedEl.textContent = 'OFFLINE'; return; }

    const cands = classify(list, ap);
    if (!showed) render(cands, firstPaint);            // quick paint of flights/times
    await enrich(cands, ap);
    const rows = cands.slice(0, MAX_ROWS);
    if (!rows.length && noteEl) noteEl.textContent = 'No ' + type + ' near ' + ap.name + ' right now.';
    render(rows, firstPaint || !showed);
    saveCache(ap.icao, rows);
    firstPaint = false;
    if (updatedEl) { updatedEl.textContent = 'LIVE • ' + rows.length + ' ' + type; updatedEl.classList.remove('stale'); }
  }

  function reset() { firstPaint = true; while (rowPool.length) rowPool.pop().el.remove(); }

  seg.forEach(b => b.addEventListener('click', () => {
    seg.forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    type = b.dataset.type;
    reset();
    poll();
  }));

  window.Views = window.Views || {};
  window.Views.board = {
    activate() { reset(); poll(); clearInterval(timer); timer = setInterval(poll, 15000); },
  };
})();
