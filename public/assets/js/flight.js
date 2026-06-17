/**
 * flight.js — "Track a flight" view. Look up a flight number; show its route,
 * times, status and aircraft. If it isn't cached yet, it's queued server-side
 * and we poll until it's ready.
 */
(function () {
  'use strict';

  const input  = document.getElementById('track-input');
  const goBtn   = document.getElementById('track-go');
  const result = document.getElementById('track-result');
  let pollTimer = null;

  function card(d) {
    const starred = App.Stars.has(d.flight);
    return `
      <div class="flightcard">
        <div class="fc-head">
          <span class="fc-num">${esc(d.flight)}</span>
          <span class="${App.statusClass(d.status)}">${esc(d.status || '')}</span>
        </div>
        <div class="fc-route">
          <div class="fc-ap">
            <div class="code">${esc(d.from.iata || '???')}</div>
            <div class="city">${esc(d.from.name || '')}</div>
            <div class="time">${esc(d.from.est || d.from.time || '')}</div>
          </div>
          <div class="fc-arrow">✈</div>
          <div class="fc-ap">
            <div class="code">${esc(d.to.iata || '???')}</div>
            <div class="city">${esc(d.to.name || '')}</div>
            <div class="time">${esc(d.to.est || d.to.time || '')}</div>
          </div>
        </div>
        <div class="fc-meta">
          ${d.airline ? '<b>' + esc(d.airline) + '</b> &middot; ' : ''}
          ${d.aircraft ? 'Aircraft <b>' + esc(d.aircraft) + '</b> &middot; ' : ''}
          ${d.reg ? 'Reg <b>' + esc(d.reg) + '</b>' : ''}
        </div>
        <div class="fc-meta">
          <button class="go" data-star="${esc(d.flight)}">${starred ? '★ Tracked' : '☆ Track this flight'}</button>
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
    clearTimeout(pollTimer);

    try {
      const res = await fetch(App.dataUrl('flight', num), { cache: 'no-store' });
      if (!res.ok) {
        // Static host (GitHub Pages): only flights on the prebuilt board exist.
        if (App.isStatic) {
          App.Stars.add(num);
          result.innerHTML = '<div class="empty">On this preview host, only flights currently ' +
            'on the PHL board can be opened.<br>Starred <b>' + esc(num) +
            '</b> — on-demand tracking works once it\'s on IONOS.</div>';
        } else {
          result.innerHTML = '<div class="empty">Could not reach the server.</div>';
        }
        return;
      }
      const d = await res.json();
      if (d.state === 'pending') {
        // Queue it server-side and poll back shortly.
        App.Stars.add(num);   // also stars + adds to watchlist
        result.innerHTML = '<div class="empty">Added <b>' + esc(num) +
          '</b> to tracking — fetching its details… this can take a minute.</div>';
        pollTimer = setTimeout(() => lookup(num), 15000);
        return;
      }
      result.innerHTML = card(d);
      wireStar();
    } catch (e) {
      result.innerHTML = '<div class="empty">Could not reach the server.</div>';
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  goBtn.addEventListener('click', () => lookup(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') lookup(input.value); });

  window.Views = window.Views || {};
  window.Views.track = { activate() {} };
})();
