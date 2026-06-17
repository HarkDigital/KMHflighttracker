/**
 * board.js — live arrivals/departures board from free keyless feeds.
 *
 * Accuracy approach: gather aircraft in the airport's terminal area, look up
 * each one's route (adsb.lol routeset, batched), then decide direction from the
 * ROUTE — if this airport is the route origin it's a departure (show the
 * destination); if it's the destination it's an arrival (show the origin);
 * otherwise it's an overflight / bad data and is dropped. This avoids the
 * climb/descent guessing that produced wrong directions and "to same airport".
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
    el.addEventListener('click', () => { if (el.dataset.flight) App.openFlight(el.dataset.flight); });
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
      const n = (row.flight || '').toUpperCase();
      r.el.dataset.flight = n;
      r.star.dataset.flight = n;
      const on = App.Stars.has(n);
      r.star.classList.toggle('on', on);
      r.star.textContent = on ? '★' : '☆';
    });
  }

  // Aircraft in the terminal area (no direction yet).
  function candidatesNear(list, ap) {
    const rows = [];
    for (const a of list) {
      if (!a.callsign) continue;
      if (/^N\d/.test(a.callsign)) continue;          // skip US private/GA
      const alt = a.alt === 'ground' ? 0 : (typeof a.alt === 'number' ? a.alt : null);
      if (alt === null || alt > 20000) continue;       // terminal area only
      const dist = haversineNm(ap.lat, ap.lon, a.lat, a.lon);
      if (dist > RADIUS_NM) continue;
      rows.push({
        callsign: a.callsign, flight: a.callsign, reg: a.reg, aircraft: a.type,
        dist, gs: a.gs, lat: a.lat, lon: a.lon,
        alt: a.alt === 'ground' ? 'GND' : String(Math.round(alt / 100) * 100),
        place: '', placeIata: '', dir: null, time: '',
      });
    }
    rows.sort((x, y) => x.dist - y.dist);
    return rows.slice(0, 40);
  }

  function apMatch(rapt, ap) {
    if (!rapt) return false;
    const i = (rapt.iata || '').toUpperCase(), c = (rapt.icao || '').toUpperCase();
    return (i && i === (ap.iata || '').toUpperCase()) || (c && c === (ap.icao || '').toUpperCase());
  }

  // Resolve routes and assign direction relative to the selected airport.
  async function assignRoutes(rows, ap) {
    const map = await Adsbdb.resolveBatch(rows.map(r => ({ callsign: r.callsign, lat: r.lat, lon: r.lon })));
    rows.forEach(row => {
      const rt = map[(row.callsign || '').toUpperCase()];
      if (!rt || !rt.origin || !rt.destination) return;
      const oM = apMatch(rt.origin, ap), dM = apMatch(rt.destination, ap);
      let other = null;
      if (oM && !dM) { row.dir = 'departures'; other = rt.destination; }
      else if (dM && !oM) { row.dir = 'arrivals'; other = rt.origin; }
      else return;   // route doesn't clearly involve this airport
      row.place = (other.city || other.name || other.iata || '').toUpperCase();
      row.placeIata = (other.iata || '').toUpperCase();
    });
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

    const cands = candidatesNear(list, ap);
    await assignRoutes(cands, ap);
    const rows = cands.filter(r => r.dir === type);
    rows.forEach(r => {
      if (type === 'arrivals') r.time = r.gs > 40 ? hhmm(new Date(Date.now() + r.dist / r.gs * 3600000)) : '';
      else { if (!seenClock.has(r.callsign)) seenClock.set(r.callsign, hhmm(new Date())); r.time = seenClock.get(r.callsign); }
      r.status = type === 'arrivals' ? 'ARRIVING' : 'DEPARTING';
    });
    rows.sort((x, y) => x.dist - y.dist);
    const final = rows.slice(0, MAX_ROWS);

    if (!final.length && noteEl) noteEl.textContent = 'No ' + type + ' near ' + ap.name + ' right now.';
    render(final, firstPaint || !showed);
    saveCache(ap.icao, final);
    firstPaint = false;
    if (updatedEl) { updatedEl.textContent = 'LIVE • ' + final.length + ' ' + type; updatedEl.classList.remove('stale'); }
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
