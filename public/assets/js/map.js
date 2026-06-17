/**
 * map.js — live aircraft map (Leaflet + OpenStreetMap tiles), fed by
 * /api/states.php (OpenSky positions around the airport).
 */
(function () {
  'use strict';

  let map = null;
  let layer = null;
  let timer = null;

  function ensureMap() {
    if (map || typeof L === 'undefined') return;
    map = L.map('map', { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 12,
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }

  function planeIcon(heading) {
    return L.divIcon({
      className: '',
      html: '<div class="plane-marker" style="transform:rotate(' + (heading || 0) + 'deg)">✈</div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  }

  async function poll() {
    ensureMap();
    if (!map) return;
    try {
      const res = await fetch(App.API + '/states.php', { cache: 'no-store' });
      const data = await res.json();

      if (!map._fitted && data.bbox) {
        map.fitBounds([
          [data.bbox.lamin, data.bbox.lomin],
          [data.bbox.lamax, data.bbox.lomax],
        ]);
        map._fitted = true;
      }

      layer.clearLayers();
      (data.aircraft || []).forEach(a => {
        const m = L.marker([a.lat, a.lon], { icon: planeIcon(a.heading) });
        const alt = a.altitude ? Math.round(a.altitude * 3.281) + ' ft' : 'on ground';
        const spd = a.velocity ? Math.round(a.velocity * 1.944) + ' kt' : '';
        m.bindPopup('<b>' + (a.callsign || a.icao24) + '</b><br>' + alt +
          (spd ? '<br>' + spd : '') + '<br>' + (a.country || ''));
        layer.addLayer(m);
      });
    } catch (e) { /* keep last view */ }
  }

  window.Views = window.Views || {};
  window.Views.map = {
    activate() {
      ensureMap();
      setTimeout(() => { if (map) map.invalidateSize(); }, 60);
      poll();
      clearInterval(timer);
      timer = setInterval(poll, 30000);
    },
  };
})();
