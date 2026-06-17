/**
 * app.js — bootstrap: airport selection, tab routing, the live clock, the
 * "add to home screen" hint, starred-flight storage, and shared helpers.
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

  // ---- Selected airport (persisted on the device) ----
  const AIRPORT_KEY = 'kmh.airport';
  let airports = [];
  let current = null;        // the selected airport object

  function dataUrl(kind, arg) {
    const icao = current ? current.icao : '';
    if (isStatic) {
      if (kind === 'board')  return 'data/' + icao + '/board_' + arg + '.json';
      if (kind === 'flight') return 'data/flights/' + encodeURIComponent(arg) + '.json';
    } else {
      if (kind === 'board')  return API + '/board.php?icao=' + encodeURIComponent(icao) + '&type=' + arg;
      if (kind === 'flight') return API + '/flight.php?flight=' + encodeURIComponent(arg);
    }
  }

  // Age of a data payload in seconds (static files carry fetchedAt; the PHP
  // API also returns a precomputed ageSeconds).
  function computeAge(data) {
    if (data && typeof data.ageSeconds === 'number') return data.ageSeconds;
    if (data && data.fetchedAt) return Math.floor(Date.now() / 1000) - data.fetchedAt;
    return null;
  }

  // ---- Starred flights (persist on the device) ----
  const STAR_KEY = 'kmh.starred';
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
    if (/BOARD|DEPART|LAND|GATE|GROUND/.test(t)) return 'status-boarding';
    if (/ON TIME|EN ROUTE|EXPECT|APPROACH|ARRIV/.test(t)) return 'status-ontime';
    return '';
  }

  function formatAge(seconds) {
    if (seconds == null) return '';
    if (seconds < 60) return 'just now';
    const m = Math.round(seconds / 60);
    if (m < 60) return m + ' min ago';
    return Math.round(m / 60) + ' h ago';
  }

  // ---- Tabs ----
  let currentView = 'board';
  const tabs = document.querySelectorAll('.tabs button');
  const views = document.querySelectorAll('[data-view]');
  function show(view) {
    currentView = view;
    tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === view));
    views.forEach(v => v.classList.toggle('hidden', v.dataset.view !== view));
    if (window.Views && window.Views[view]) window.Views[view].activate();
    location.hash = view;
  }
  tabs.forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));

  // ---- Airport selection + search ----
  const chip = document.getElementById('current-airport');
  const searchInput = document.getElementById('airport-search');
  const resultsEl = document.getElementById('airport-results');
  let fullDb = null;        // lazily-loaded full airport dataset
  let fullLoading = null;

  function setAirport(ap, opts) {
    if (!ap || ap.lat == null) return;
    current = ap;
    App.airport = current;
    try { localStorage.setItem(AIRPORT_KEY, JSON.stringify(current)); } catch (_) {}
    if (chip) chip.textContent = (current.iata ? current.iata + ' — ' : '') + current.name;
    document.title = 'KMH Flights — ' + (current.iata || current.icao || '');
    if (!(opts && opts.silent)) show(currentView);   // refresh the active view
  }

  const lc = s => (s == null ? '' : String(s)).toLowerCase();

  function searchAirports(q) {
    q = lc(q).trim();
    if (!q) return [];
    const src = fullDb || airports;
    const exact = [], starts = [], contains = [];
    for (const a of src) {
      const iata = lc(a.iata), icao = lc(a.icao), name = lc(a.name), city = lc(a.city);
      if (iata === q || icao === q) exact.push(a);
      else if (iata.startsWith(q) || icao.startsWith(q) || name.startsWith(q) || city.startsWith(q)) starts.push(a);
      else if (name.includes(q) || city.includes(q)) contains.push(a);
      if (exact.length + starts.length + contains.length > 60) break;
    }
    return exact.concat(starts, contains).slice(0, 8);
  }

  function renderResults(list) {
    if (!list.length) { resultsEl.classList.add('hidden'); resultsEl.innerHTML = ''; return; }
    resultsEl.innerHTML = list.map((a, i) =>
      '<li data-i="' + i + '"' + (i === 0 ? ' class="active"' : '') + '>' +
        '<span class="iata">' + (a.iata || a.icao || '') + '</span>' +
        '<span class="nm">' + (a.name || '') + '</span>' +
        '<span class="ct">' + (a.country || '') + '</span></li>').join('');
    resultsEl.classList.remove('hidden');
    resultsEl._list = list;
  }

  function pick(a) {
    if (!a) return;
    setAirport(a);
    searchInput.value = '';
    searchInput.blur();
    resultsEl.classList.add('hidden');
  }

  // Lazy-load a full worldwide airport list so any airport is searchable.
  // Falls back silently to the bundled curated list if it can't be fetched.
  function loadFullDb() {
    if (fullDb || fullLoading) return fullLoading;
    fullLoading = fetch('https://cdn.jsdelivr.net/gh/mwgg/Airports@master/airports.json', { cache: 'force-cache' })
      .then(r => r.json())
      .then(obj => {
        const arr = [];
        for (const k in obj) {
          const a = obj[k];
          if (a && a.lat != null && a.lon != null && a.iata) {
            arr.push({ icao: a.icao || k, iata: a.iata,
                       name: (a.city || a.name || '').toUpperCase(),
                       city: a.city, country: a.country, lat: a.lat, lon: a.lon });
          }
        }
        fullDb = arr;
      })
      .catch(() => {});
    return fullLoading;
  }

  function wireSearch() {
    if (!searchInput) return;
    let activeIdx = 0;
    searchInput.addEventListener('focus', loadFullDb);
    searchInput.addEventListener('input', () => { activeIdx = 0; renderResults(searchAirports(searchInput.value)); });
    searchInput.addEventListener('keydown', e => {
      const items = resultsEl.querySelectorAll('li');
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, items.length - 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); }
      else if (e.key === 'Enter') { e.preventDefault(); if (resultsEl._list) pick(resultsEl._list[activeIdx]); return; }
      else if (e.key === 'Escape') { resultsEl.classList.add('hidden'); return; }
      else return;
      items.forEach((li, i) => li.classList.toggle('active', i === activeIdx));
    });
    resultsEl.addEventListener('mousedown', e => {
      const li = e.target.closest('li');
      if (!li || !resultsEl._list) return;
      e.preventDefault();
      pick(resultsEl._list[+li.dataset.i]);
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.airport-search')) resultsEl.classList.add('hidden');
    });
  }

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
  if (hint && isiOS && !standalone && !localStorage.getItem('kmh.hintDismissed')) {
    hint.classList.add('show');
    hint.querySelector('.close').addEventListener('click', () => {
      hint.classList.remove('show');
      localStorage.setItem('kmh.hintDismissed', '1');
    });
  }

  // Expose shared bits (airport is set during init()).
  window.App = { API, isStatic, dataUrl, computeAge, Stars, statusClass, formatAge,
                 airport: null, airports: [] };

  // ---- Init: load the airport list, then start ----
  (async function init() {
    try {
      airports = await fetch('airports.json', { cache: 'no-store' }).then(r => r.json());
    } catch (_) { airports = []; }
    if (!Array.isArray(airports) || !airports.length) {
      airports = [{ icao: 'KPHL', iata: 'PHL', name: 'PHILADELPHIA', lat: 39.8729, lon: -75.2437 }];
    }
    App.airports = airports;
    wireSearch();

    let initial = null;
    try { const s = JSON.parse(localStorage.getItem(AIRPORT_KEY)); if (s && s.lat != null) initial = s; } catch (_) {}
    if (!initial) initial = airports.find(a => a.icao === 'KPHL') || airports[0];
    setAirport(initial, { silent: true });

    const start = (location.hash || '#board').slice(1);
    show(['board', 'track', 'tracked', 'map'].includes(start) ? start : 'board');
  })();
})();
