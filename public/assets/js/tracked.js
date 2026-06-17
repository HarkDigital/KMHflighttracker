/**
 * tracked.js — the "Tracked" tab. Shows every flight the user has starred
 * (stored on the device), each resolved live from the free keyless sources
 * (adsbdb route + ADS-B live position). No API key.
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
    const aircraft = ac && ac.type ? ac.type : '';
    const reg = ac && ac.reg ? ac.reg : '';
    const alt = ac && typeof ac.alt === 'number' ? Math.round(ac.alt) + ' ft' : '';
    return `
      <div class="flightcard" data-flight="${esc(num)}">
        <div class="fc-head">
          <span class="fc-num">${esc(num)}</span>
          <span class="${App.statusClass(status)}">${status}</span>
          <span class="star on" title="Remove">★</span>
        </div>
        <div class="fc-route">
          <div class="fc-ap"><div class="code">${code(from)}</div>
            <div class="city">${esc(from ? (from.city || from.name) : '')}</div></div>
          <div class="fc-arrow">✈</div>
          <div class="fc-ap"><div class="code">${code(to)}</div>
            <div class="city">${esc(to ? (to.city || to.name) : '')}</div></div>
        </div>
        <div class="fc-meta">
          ${aircraft ? 'Aircraft <b>' + esc(aircraft) + '</b>' : ''}
          ${reg ? ' &middot; Reg <b>' + esc(reg) + '</b>' : ''}
          ${alt ? ' &middot; <b>' + esc(alt) + '</b>' : ''}
        </div>
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
        const [rt, live] = await Promise.all([Adsbdb.route(num), Adsb.callsign(num)]);
        return card(num, rt, live && live[0]);
      } catch (_) { return card(num, null, null); }
    }));
    wrap.innerHTML = cards.join('');
    wrap.querySelectorAll('.star').forEach(s => {
      s.addEventListener('click', () => {
        App.Stars.remove(s.closest('[data-flight]').dataset.flight);
        render();
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
