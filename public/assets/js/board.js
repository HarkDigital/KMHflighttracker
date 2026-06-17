/**
 * board.js — live arrivals/departures board from free keyless feeds (ADS-B near
 * the selected airport + adsb.lol routeset for routes). Aircraft in the terminal
 * area are classified as arriving/departing from altitude + climb/descent.
 *
 * Columns: TIME | FLIGHT | DESTINATION/ORIGIN | ALT | STATUS | ★
 * Tapping a row opens the flight page. Only flights with a known route are shown
 * (private/GA is filtered out). The last board is cached per airport so revisits
 * paint instantly while fresh data loads.
 */
(function () {
  'use strict';

  const COLS = [
    { key: 'time',   w: 5,  cls: 'col-time' },
    { key: 'flight', w: 7,  cls: 'col-flight' },
    { key: 'place',  w: 15, cls: 'col-dest' },
    { key: 'alt',    w: 6,  cls: 'col-alt' },
    { key: 'status', w: 9,  cls: 'col-status' },
  ];
  const RADIUS_NM = 80;
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
  function hhmm(date) { return pad(date.getHours()) + ':' + pad(date.getMinutes()); }

  // ---- per-airport board cache (stale-while-revalidate) ----
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

  function classify(list, ap) {
    const rows = [];
    for (const a of list) {
      if (!a.callsign) continue;
      if (/^N\d/.test(a.callsign)) continue;   // skip US private/GA tail-number callsigns
      const alt = a.alt === 'ground' ? 0 : (typeof a.alt === 'number' ? a.alt : null);
      if (alt === null || alt > 20000) continue;
      const dist = haversineNm(ap.lat, ap.lon, a.lat, a.lon);
      let kind = null;
      if (a.baroRate > 250 && dist < 60) kind = 'departures';
      else if (a.baroRate < -250 && dist < 80) kind = 'arrivals';
      else if (Math.abs(a.baroRate) <= 250 && alt < 8000 && dist < 25) {
        const diff = Math.abs(((a.track - bearing(a.lat, a.lon, ap.lat, ap.lon) + 540) % 360) - 180);
        kind = diff < 90 ? 'arrivals' : 'departures';
      }
      if (kind !== type) continue;

      let time = '';
      if (type === 'arrivals') { if (a.gs > 40) time = hhmm(new Date(Date.now() + dist / a.gs * 3600000)); }
      else { if (!seenClock.has(a.callsign)) seenClock.set(a.callsign, hhmm(new Date())); time = seenClock.get(a.callsign); }

      rows.push({
        callsign: a.callsign, flight: a.callsign, reg: a.reg, aircraft: a.type,
        dist, time, status: type === 'arrivals' ? 'ARRIVING' : 'DEPARTING',
        alt: a.alt === 'ground' ? 'GND' : String(Math.round(alt / 100) * 100),
        lat: a.lat, lon: a.lon, place: '', placeIata: '', hasRoute: false,
      });
    }
    rows.sort((x, y) => x.dist - y.dist);
    return rows.slice(0, 24);
  }

  async function enrich(rows) {
    const map = await Adsbdb.resolveBatch(rows.map(r => ({ callsign: r.callsign, lat: r.lat, lon: r.lon })));
    rows.forEach(row => {
      const rt = map[(row.callsign || '').toUpperCase()];
      const apt = rt && (type === 'arrivals' ? rt.origin : rt.destination);
      if (apt) {
        row.place = (apt.city || apt.name || apt.iata || '').toUpperCase();
        row.placeIata = (apt.iata || '').toUpperCase();
        row.hasRoute = true;
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
      if (cached && cached.length) {
        render(cached, true); showed = true;
        if (updatedEl) updatedEl.textContent = 'LIVE • ' + cached.length + ' ' + type;
      } else if (noteEl) {
        noteEl.textContent = 'Loading live traffic near ' + ap.name + '…';
        noteEl.classList.remove('hidden');
      }
    }

    const list = await Adsb.point(ap.lat, ap.lon, RADIUS_NM);
    if (list === null) { if (updatedEl) updatedEl.textContent = 'OFFLINE'; return; }

    const immediate = firstPaint;
    const candidates = classify(list, ap);
    if (!showed) render(candidates, immediate);    // quick paint of flight numbers/times
    await enrich(candidates);
    const rows = candidates.filter(r => r.hasRoute).slice(0, MAX_ROWS);
    if (!rows.length && noteEl) noteEl.textContent = 'No ' + type + ' with a known route near ' + ap.name + ' right now.';
    render(rows, immediate);
    saveCache(ap.icao, rows);
    firstPaint = false;
    if (updatedEl) { updatedEl.textContent = 'LIVE • ' + rows.length + ' ' + type; updatedEl.classList.remove('stale'); }
  }

  function reset() {
    firstPaint = true;
    while (rowPool.length) rowPool.pop().el.remove();
  }

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
