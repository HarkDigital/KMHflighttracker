/**
 * app.js — bootstrap: tab routing, the live clock, the "add to home screen"
 * hint, starred-flight storage (localStorage), and shared helpers.
 */
(function () {
  'use strict';

  const API = 'api';

  // ---- Data source ----
  // On a static host (e.g. GitHub Pages) there is no PHP backend, so we read
  // prebuilt JSON from data/ (refreshed by a GitHub Actions workflow) and skip
  // writes. On IONOS the PHP API under api/ is used. Auto-detected for
  // *.github.io; override with  window.APP_CONFIG = { dataMode: 'static'|'php' }.
  const isStatic = (window.APP_CONFIG && window.APP_CONFIG.dataMode)
    ? window.APP_CONFIG.dataMode === 'static'
    : /\.github\.io$/i.test(location.hostname);

  function dataUrl(kind, arg) {
    if (isStatic) {
      if (kind === 'board')  return 'data/board_' + arg + '.json';
      if (kind === 'flight') return 'data/flights/' + encodeURIComponent(arg) + '.json';
      if (kind === 'states') return 'data/states.json';
    }
    if (kind === 'board')  return API + '/board.php?type=' + arg;
    if (kind === 'flight') return API + '/flight.php?flight=' + encodeURIComponent(arg);
    if (kind === 'states') return API + '/states.php';
  }

  // Age of a data payload in seconds (static files carry fetchedAt; the PHP
  // API also returns a precomputed ageSeconds).
  function computeAge(data) {
    if (data && typeof data.ageSeconds === 'number') return data.ageSeconds;
    if (data && data.fetchedAt) return Math.floor(Date.now() / 1000) - data.fetchedAt;
    return null;
  }

  // ---- Starred flights (persist on the device) ----
  const STAR_KEY = 'phl.starred';
  const Stars = {
    all() {
      try { return JSON.parse(localStorage.getItem(STAR_KEY) || '[]'); }
      catch (_) { return []; }
    },
    has(n) { return this.all().includes(n); },
    add(n) {
      const s = this.all();
      if (!s.includes(n)) { s.push(n); localStorage.setItem(STAR_KEY, JSON.stringify(s)); }
      // On IONOS, tell the server to keep this flight fresh after it leaves the
      // board. Static hosts have no write endpoint, so the star is local-only.
      if (isStatic) return;
      fetch(API + '/watch.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flight: n }),
      }).catch(() => {});
    },
    remove(n) {
      const s = this.all().filter(x => x !== n);
      localStorage.setItem(STAR_KEY, JSON.stringify(s));
    },
    toggle(n) { this.has(n) ? this.remove(n) : this.add(n); return this.has(n); },
  };

  // ---- Status -> colour class ----
  function statusClass(text) {
    const t = (text || '').toUpperCase();
    if (/CANCEL|DIVERT/.test(t)) return 'status-cancelled';
    if (/DELAY/.test(t)) return 'status-delayed';
    if (/BOARD|DEPART|LAND|GATE/.test(t)) return 'status-boarding';
    if (/ON TIME|EN ROUTE|EXPECT|APPROACH/.test(t)) return 'status-ontime';
    return '';
  }

  // ---- Tabs ----
  const tabs = document.querySelectorAll('.tabs button');
  const views = document.querySelectorAll('[data-view]');
  function show(view) {
    tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === view));
    views.forEach(v => v.classList.toggle('hidden', v.dataset.view !== view));
    if (window.Views && window.Views[view]) window.Views[view].activate();
    location.hash = view;
  }
  tabs.forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));

  // ---- Live clock ----
  const clockEl = document.querySelector('.clock');
  function tick() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    clockEl.textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  setInterval(tick, 1000); tick();

  // ---- "Add to Home Screen" hint (iOS, only when not already installed) ----
  const hint = document.querySelector('.install-hint');
  const standalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (hint && isiOS && !standalone && !localStorage.getItem('phl.hintDismissed')) {
    hint.classList.add('show');
    hint.querySelector('.close').addEventListener('click', () => {
      hint.classList.remove('show');
      localStorage.setItem('phl.hintDismissed', '1');
    });
  }

  // Expose shared bits.
  window.App = { API, isStatic, dataUrl, computeAge, Stars, statusClass, formatAge };

  function formatAge(seconds) {
    if (seconds == null) return '';
    if (seconds < 60) return 'just now';
    const m = Math.round(seconds / 60);
    if (m < 60) return m + ' min ago';
    return Math.round(m / 60) + ' h ago';
  }

  // ---- Initial view from hash ----
  const start = (location.hash || '#board').slice(1);
  show(['board', 'track', 'tracked', 'map'].includes(start) ? start : 'board');
})();
