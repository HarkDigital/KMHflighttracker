/**
 * flight.js — the "Track" tab: a search box that opens the full flight page
 * for the entered callsign.
 */
(function () {
  'use strict';

  const input = document.getElementById('track-input');
  const goBtn = document.getElementById('track-go');

  function go() {
    const n = (input.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (n) App.openFlight(n);
  }
  goBtn.addEventListener('click', go);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });

  window.Views = window.Views || {};
  window.Views.track = { activate() { input.value = ''; setTimeout(() => input.focus(), 50); } };
})();
