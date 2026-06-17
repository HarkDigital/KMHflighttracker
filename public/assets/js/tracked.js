/**
 * tracked.js — the "Tracked" tab: starred flights (stored on the device), each
 * a tappable card that opens the full flight page. Status resolved live.
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

  function card(num, rt, ac) {
    const status = !ac ? 'NOT AIRBORNE' : (ac.alt === 'ground' ? 'ON GROUND' : 'EN ROUTE');
    const from = rt && rt.origin, to = rt && rt.destination;
    return `
      <div class="flightcard" data-flight="${esc(num)}">
        <div class="fc-head">
          <span class="fc-num">${esc(num)}</span>
          <span class="${App.statusClass(status)}">${status}</span>
          <span class="star on" title="Remove" data-rm="${esc(num)}">★</span>
        </div>
        <div class="fc-route">
          <div class="fc-ap"><div class="code">${code(from)}</div></div>
          <div class="fc-arrow">✈</div>
          <div class="fc-ap"><div class="code">${code(to)}</div></div>
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
      try {
        const live = await Adsb.callsign(num);
        const ac = live && live[0];
        const rt = await Adsbdb.resolve(num, ac && ac.lat, ac && ac.lon);
        return card(num, rt, ac);
      } catch (_) { return card(num, null, null); }
    }));
    wrap.innerHTML = cards.join('');
    wrap.querySelectorAll('.flightcard').forEach(fc => {
      fc.addEventListener('click', e => {
        if (e.target.closest('[data-rm]')) {
          App.Stars.remove(e.target.dataset.rm); render(); return;
        }
        App.openFlight(fc.dataset.flight);
      });
    });
  }

  window.Views = window.Views || {};
  window.Views.tracked = {
    activate() {
      render();
      clearInterval(timer);
      timer = setInterval(render, 30000);
    },
  };
})();
