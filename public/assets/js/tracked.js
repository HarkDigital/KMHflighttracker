/**
 * tracked.js — the "Tracked" tab. Shows every flight the user has starred
 * (stored on the device), each rendered as a live card from /api/flight.php.
 */
(function () {
  'use strict';

  const wrap = document.getElementById('tracked-list');
  let timer = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function card(d) {
    return `
      <div class="flightcard" data-flight="${esc(d.flight)}">
        <div class="fc-head">
          <span class="fc-num">${esc(d.flight)}</span>
          <span class="${App.statusClass(d.status)}">${esc(d.status || '…')}</span>
          <span class="star on" title="Remove">★</span>
        </div>
        <div class="fc-route">
          <div class="fc-ap"><div class="code">${esc(d.from && d.from.iata || '???')}</div>
            <div class="time">${esc(d.from && (d.from.est || d.from.time) || '')}</div></div>
          <div class="fc-arrow">✈</div>
          <div class="fc-ap"><div class="code">${esc(d.to && d.to.iata || '???')}</div>
            <div class="time">${esc(d.to && (d.to.est || d.to.time) || '')}</div></div>
        </div>
        <div class="fc-meta">
          ${d.aircraft ? 'Aircraft <b>' + esc(d.aircraft) + '</b>' : ''}
          ${d.reg ? ' &middot; Reg <b>' + esc(d.reg) + '</b>' : ''}
        </div>
      </div>`;
  }

  function pending(num) {
    return `<div class="flightcard" data-flight="${esc(num)}">
        <div class="fc-head"><span class="fc-num">${esc(num)}</span>
          <span>FETCHING…</span><span class="star on" title="Remove">★</span></div>
        <div class="fc-meta">Waiting for the next data refresh.</div>
      </div>`;
  }

  async function render() {
    const stars = App.Stars.all();
    if (!stars.length) {
      wrap.innerHTML = '<div class="empty">No tracked flights yet.<br>' +
        'Tap ☆ on the board or use the Track tab to follow a flight.</div>';
      return;
    }
    const results = await Promise.all(stars.map(async n => {
      try {
        const r = await fetch(App.dataUrl('flight', n), { cache: 'no-store' });
        if (!r.ok) return pending(n);
        const d = await r.json();
        return d.state === 'pending' ? pending(n) : card(d);
      } catch (_) { return pending(n); }
    }));
    wrap.innerHTML = results.join('');
    wrap.querySelectorAll('.star').forEach(s => {
      s.addEventListener('click', () => {
        const fc = s.closest('[data-flight]');
        App.Stars.remove(fc.dataset.flight);
        render();
      });
    });
  }

  window.Views = window.Views || {};
  window.Views.tracked = {
    activate() {
      render();
      clearInterval(timer);
      timer = setInterval(render, 60000);
    },
  };
})();
