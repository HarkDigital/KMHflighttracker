/**
 * tracked.js — the "Tracked" tab: starred flights (on the device), each a
 * tappable card that opens the full flight page. Uses Flights.lookup so cards
 * show accurate status/route (AeroDataBox when available).
 */
(function () {
  'use strict';

  const wrap = document.getElementById('tracked-list');
  let timer = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function code(apt) { return esc(apt && (apt.iata || apt.icao) || '???'); }

  function card(num, i) {
    const t = i.from && i.to ? '' : '';
    return `
      <div class="flightcard" data-flight="${esc(num)}">
        <div class="fc-head">
          <span class="fc-num">${esc(num)}</span>
          <span class="${App.statusClass(i.status)}">${esc(i.status)}</span>
          <span class="star on" title="Remove" data-rm="${esc(num)}">★</span>
        </div>
        <div class="fc-route">
          <div class="fc-ap"><div class="code">${code(i.from)}</div></div>
          <div class="fc-arrow">✈</div>
          <div class="fc-ap"><div class="code">${code(i.to)}</div></div>
        </div>
        <div class="fc-meta">Tap for live altitude, speed &amp; map →</div>
      </div>`;
  }

  async function render() {
    const stars = App.Stars.all();
    if (!stars.length) {
      wrap.innerHTML = '<div class="empty">No tracked flights yet.<br>' +
        'Tap ☆ on the board or use the Track tab to follow a flight.</div>';
      return;
    }
    const cards = await Promise.all(stars.map(async num => {
      try { return card(num, await Flights.lookup(num)); }
      catch (_) { return card(num, { status: '—', from: {}, to: {} }); }
    }));
    wrap.innerHTML = cards.join('');
    wrap.querySelectorAll('.flightcard').forEach(fc => {
      fc.addEventListener('click', e => {
        if (e.target.closest('[data-rm]')) { App.Stars.remove(e.target.dataset.rm); render(); return; }
        App.openFlight(fc.dataset.flight);
      });
    });
  }

  window.Views = window.Views || {};
  window.Views.tracked = {
    activate() { render(); clearInterval(timer); timer = setInterval(render, 30000); },
  };
})();
