/**
 * board.js — the departures/arrivals split-flap board.
 * Polls /api/board.php, diffs rows, and flips only changed tiles.
 */
(function () {
  'use strict';

  const COLS = [
    { key: 'time',   w: 5,  cls: 'col-time' },
    { key: 'flight', w: 7,  cls: 'col-flight' },
    { key: 'place',  w: 16, cls: 'col-dest' },
    { key: 'gate',   w: 4,  cls: 'col-gate' },
    { key: 'status', w: 11, cls: 'col-status' },
  ];

  const listEl    = document.getElementById('board-list');
  const updatedEl = document.querySelector('.topbar .updated');
  const seg       = document.querySelectorAll('#board-controls .seg button');

  let type = 'departures';
  let timer = null;
  const rowPool = [];   // reusable row objects { el, fields:{}, star, flight }

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
    // Grow/shrink the pool to match.
    while (rowPool.length < rows.length) {
      const r = buildRow();
      rowPool.push(r);
      listEl.appendChild(r.el);
    }
    while (rowPool.length > rows.length) {
      const r = rowPool.pop();
      r.el.remove();
    }
    rows.forEach((row, i) => {
      const r = rowPool[i];
      COLS.forEach(c => {
        const txt = c.key === 'place'
          ? (row.placeIata ? row.placeIata + ' ' + row.place : row.place)
          : row[c.key];
        r.fields[c.key].set(txt || '');
      });
      // status colour
      const statusEl = r.el.querySelector('.col-status');
      statusEl.className = 'col-status ' + App.statusClass(row.status);
      // star state
      const n = (row.flight || '').toUpperCase();
      r.star.dataset.flight = n;
      const on = App.Stars.has(n);
      r.star.classList.toggle('on', on);
      r.star.textContent = on ? '★' : '☆';
    });
  }

  const noteEl = document.getElementById('board-note');

  function note(msg) {
    while (rowPool.length) rowPool.pop().el.remove();
    if (noteEl) { noteEl.textContent = msg; noteEl.classList.remove('hidden'); }
  }

  async function poll() {
    try {
      const res = await fetch(App.dataUrl('board', type), { cache: 'no-store' });
      if (!res.ok) { note('No board data yet for this airport.'); return; }
      const data = await res.json();

      if (data.boardsDisabled) {
        note((data.airport || 'This airport') + ' is radar-only. Open the Map tab for live traffic.');
        if (updatedEl) { updatedEl.textContent = ''; updatedEl.classList.remove('stale'); }
        return;
      }
      if (noteEl) noteEl.classList.add('hidden');
      render(data.rows || []);
      if (updatedEl) {
        updatedEl.textContent = data.mock ? 'SAMPLE DATA'
          : 'UPDATED ' + App.formatAge(App.computeAge(data));
        updatedEl.classList.toggle('stale', !!data.stale || !!data.mock);
      }
    } catch (e) {
      if (updatedEl) updatedEl.textContent = 'OFFLINE';
    }
  }

  seg.forEach(b => b.addEventListener('click', () => {
    seg.forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    type = b.dataset.type;
    // wipe rows so the new direction flips in cleanly
    while (rowPool.length) rowPool.pop().el.remove();
    poll();
  }));

  window.Views = window.Views || {};
  window.Views.board = {
    activate() {
      poll();
      if (!timer) timer = setInterval(poll, 60000);  // refresh display every 60s
    },
  };
})();
