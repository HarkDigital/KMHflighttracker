/**
 * flight.js — "Track a flight" view. Looks up a flight by its callsign using
 * free, keyless sources: adsbdb (callsign -> route) and the ADS-B feed (live
 * position/altitude/type if it's airborne right now). No API key.
 */
(function () {
  'use strict';

  const input  = document.getElementById('track-input');
  const goBtn   = document.getElementById('track-go');
  const result = document.getElementById('track-result');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function airportCode(apt, live) {
    if (apt && (apt.iata || apt.icao)) return esc(apt.iata || apt.icao);
    return '???';
  }

  function card(num, rt, ac) {
    const starred = App.Stars.has(num);
    const status = !ac ? 'NOT AIRBORNE'
      : (ac.alt === 'ground' ? 'ON GROUND' : 'EN ROUTE');
    const from = rt && rt.origin, to = rt && rt.destination;
    const aircraft = ac && ac.type ? ac.type : '';
    const reg = ac && ac.reg ? ac.reg : '';
    const alt = ac && typeof ac.alt === 'number' ? Math.round(ac.alt) + ' ft' : '';
    const spd = ac && ac.gs ? Math.round(ac.gs) + ' kt' : '';

    return `
      <div class="flightcard">
        <div class="fc-head">
          <span class="fc-num">${esc(num)}</span>
          <span class="${App.statusClass(status)}">${status}</span>
        </div>
        <div class="fc-route">
          <div class="fc-ap">
            <div class="code">${airportCode(from)}</div>
            <div class="city">${esc(from ? (from.city || from.name) : '')}</div>
          </div>
          <div class="fc-arrow">✈</div>
          <div class="fc-ap">
            <div class="code">${airportCode(to)}</div>
            <div class="city">${esc(to ? (to.city || to.name) : '')}</div>
          </div>
        </div>
        <div class="fc-meta">
          ${aircraft ? 'Aircraft <b>' + esc(aircraft) + '</b>' : ''}
          ${reg ? ' &middot; Reg <b>' + esc(reg) + '</b>' : ''}
          ${alt ? ' &middot; <b>' + esc(alt) + '</b>' : ''}
          ${spd ? ' &middot; <b>' + esc(spd) + '</b>' : ''}
        </div>
        <div class="fc-meta">
          <button class="go" data-star="${esc(num)}">${starred ? '★ Tracked' : '☆ Track this flight'}</button>
        </div>
      </div>`;
  }

  function wireStar() {
    const btn = result.querySelector('[data-star]');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const on = App.Stars.toggle(btn.dataset.star);
      btn.textContent = on ? '★ Tracked' : '☆ Track this flight';
    });
  }

  async function lookup(num) {
    num = (num || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!num) return;
    result.innerHTML = '<div class="empty">Looking up ' + esc(num) + '…</div>';

    try {
      const [rt, live] = await Promise.all([Adsbdb.route(num), Adsb.callsign(num)]);
      const ac = live && live[0];
      if (!rt && !ac) {
        result.innerHTML = '<div class="empty">No data for <b>' + esc(num) +
          '</b>.<br>It may not be flying right now — star it and check back when it\'s airborne.</div>';
        return;
      }
      result.innerHTML = card(num, rt, ac);
      wireStar();
    } catch (e) {
      result.innerHTML = '<div class="empty">Could not reach the flight data service.</div>';
    }
  }

  goBtn.addEventListener('click', () => lookup(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') lookup(input.value); });

  window.Views = window.Views || {};
  window.Views.track = { activate() {} };
})();
