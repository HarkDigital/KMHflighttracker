/**
 * board.js — live "arrivals / departures" board built entirely from free,
 * keyless sources: the ADS-B feed (aircraft near the selected airport) plus
 * adsbdb (callsign -> route). No API key, no trial — works on GitHub Pages and
 * IONOS alike. Aircraft in the terminal area are classified as arriving or
 * departing from altitude + climb/descent, and rendered on the split-flap board.
 *
 * (On IONOS you can later layer OpenSky for a richer scheduled-style board; the
 * data-source switch in app.js is where that would hook in.)
 */
(function () {
  'use strict';

  const COLS = [
    { key: 'time',   w: 5,  cls: 'col-time' },
    { key: 'flight', w: 7,  cls: 'col-flight' },
    { key: 'place',  w: 16, cls: 'col-dest' },
    { key: 'gate',   w: 6,  cls: 'col-gate' },     // repurposed: altitude (ft)
    { key: 'status', w: 11, cls: 'col-status' },
  ];
  const RADIUS_NM = 100;
  const MAX_ROWS = 14;

  const listEl    = document.getElementById('board-list');
  const noteEl    = document.getElementById('board-note');
  const updatedEl = document.querySelector('.topbar .updated');
  const destHead  = document.querySelector('.board-head .col-dest');
  const gateHead  = document.querySelector('.board-head .col-gate');
  const seg       = document.querySelectorAll('#board-controls .seg button');

  let type = 'departures';
  let timer = null;
  const rowPool = [];

  if (gateHead) gateHead.textContent = 'Alt';

  // ---- geo helpers ----
  const toRad = d => d * Math.PI / 180;
  function haversineNm(la1, lo1, la2, lo2) {
    const R = 3440.065; // nm
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
  function hhmm(date) {
    const p = n => String(n).padStart(2, '0');
    return p(date.getHours()) + ':' + p(date.getMinutes());
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
    star.className = 'star';
    star.textContent = '☆';
    star.addEventListener('click', () => {
      const n = star.dataset.flight;
      if (!n) return;
      const on = App.Stars.toggle(n);
      star.classList.toggle('on', on);
      star.textContent = on ? '★' : '☆';
    });
    el.appendChild(star);
    return { el, fields, star };
  }

  function render(rows) {
    if (noteEl) noteEl.classList.toggle('hidden', rows.length > 0);
    while (rowPool.length < rows.length) {
      const r = buildRow(); rowPool.push(r); listEl.appendChild(r.el);
    }
    while (rowPool.length > rows.length) { rowPool.pop().el.remove(); }

    rows.forEach((row, i) => {
      const r = rowPool[i];
      COLS.forEach(c => {
        const txt = c.key === 'place'
          ? (row.placeIata ? row.placeIata + ' ' + row.place : row.place)
          : row[c.key];
        r.fields[c.key].set(txt || '');
      });
      r.el.querySelector('.col-status').className = 'col-status ' + App.statusClass(row.status);
      const n = (row.flight || '').toUpperCase();
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
      const alt = a.alt === 'ground' ? 0 : (typeof a.alt === 'number' ? a.alt : null);
      if (alt === null || alt > 20000) continue;          // skip cruise overflights
      const dist = haversineNm(ap.lat, ap.lon, a.lat, a.lon);
      let kind = null;
      if (a.baroRate > 250 && dist < 70) kind = 'departures';
      else if (a.baroRate < -250 && dist < 100) kind = 'arrivals';
      else if (Math.abs(a.baroRate) <= 250 && alt < 8000 && dist < 30) {
        const diff = Math.abs(((a.track - bearing(a.lat, a.lon, ap.lat, ap.lon) + 540) % 360) - 180);
        kind = diff < 90 ? 'arrivals' : 'departures';
      }
      if (kind !== type) continue;

      const etaMin = (type === 'arrivals' && a.gs > 40) ? dist / a.gs * 60 : null;
      rows.push({
        callsign: a.callsign, flight: a.callsign, reg: a.reg, aircraft: a.type,
        dist, etaMin,
        gate: alt ? String(Math.round(alt / 100) * 100) : 'GND',
        time: etaMin != null ? hhmm(new Date(Date.now() + etaMin * 60000)) : '',
        status: type === 'arrivals' ? 'ARRIVING' : 'DEPARTING',
        place: '', placeIata: '',
      });
    }
    rows.sort((x, y) => (x.etaMin ?? x.dist) - (y.etaMin ?? y.dist));
    return rows.slice(0, MAX_ROWS);
  }

  async function enrich(rows) {
    await Promise.all(rows.map(async row => {
      const rt = await Adsbdb.route(row.callsign);
      const apt = rt && (type === 'arrivals' ? rt.origin : rt.destination);
      if (apt) {
        row.place = (apt.city || apt.name || apt.iata || '').toUpperCase();
        row.placeIata = (apt.iata || '').toUpperCase();
      }
    }));
  }

  async function poll() {
    const ap = App.airport;
    if (!ap) return;
    if (destHead) destHead.textContent = type === 'arrivals' ? 'Origin' : 'Destination';

    const list = await Adsb.point(ap.lat, ap.lon, RADIUS_NM);
    if (list === null) {                                  // both feeds unreachable
      if (updatedEl) updatedEl.textContent = 'OFFLINE';
      return;
    }
    const rows = classify(list, ap);
    if (!rows.length && noteEl) {
      noteEl.textContent = 'No ' + type + ' near ' + ap.name + ' right now.';
    }
    render(rows);                                         // show immediately
    await enrich(rows);                                   // then fill in routes
    render(rows);
    if (updatedEl) {
      updatedEl.textContent = 'LIVE • ' + rows.length + ' ' + type;
      updatedEl.classList.remove('stale');
    }
  }

  seg.forEach(b => b.addEventListener('click', () => {
    seg.forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    type = b.dataset.type;
    while (rowPool.length) rowPool.pop().el.remove();
    poll();
  }));

  window.Views = window.Views || {};
  window.Views.board = {
    activate() {
      poll();
      if (!timer) timer = setInterval(poll, 15000);
    },
  };
})();
