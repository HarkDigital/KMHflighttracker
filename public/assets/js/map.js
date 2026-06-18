/**
 * map.js — live "radar" of aircraft around the selected airport (à la
 * FlightRadar24).
 *
 * Works on static hosting (GitHub Pages) because it polls a free, keyless,
 * CORS-enabled ADS-B feed directly from the browser every few seconds, and
 * dead-reckons each aircraft between polls so they glide smoothly instead of
 * jumping. No backend or API key required. The centre follows whichever
 * airport is selected in the header.
 *
 * Data: adsb.lol (primary) / airplanes.live (fallback) — community ADS-B
 * aggregators. FlightRadar24's own data is proprietary and not used.
 */
(function () {
  'use strict';

  const cfg = (window.APP_CONFIG && window.APP_CONFIG.radar) || {};
  const RADIUS_NM = cfg.radiusNm ?? 120;
  const POLL_MS = 6000;        // fetch fresh positions (feeds allow ~1 req/s)
  const TICK_MS = 1000;        // dead-reckon redraw between fetches
  const STALE_MS = 60000;      // drop aircraft not seen for this long

  let map = null, layer = null, apMarker = null, pollTimer = null, tickTimer = null;
  let lastIcao = null;
  const fleet = new Map();     // hex -> aircraft state + marker

  function center() {
    const a = App.airport;
    return (a && a.lat != null) ? [a.lat, a.lon] : [39.8729, -75.2437];
  }

  function ensureMap() {
    if (map || typeof L === 'undefined') return;
    map = L.map('map', { zoomControl: true, attributionControl: true });
    map.attributionControl.setPrefix(false);   // drop the "Leaflet" link
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: 'OSM · CARTO',
      maxZoom: 12,
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }

  function icon(track, onGround) {
    return L.divIcon({
      className: '',
      // SVG plane points straight up at 0deg, so rotate(track) aims the nose the
      // way the aircraft is actually flying (toward its destination en route) —
      // unlike the ✈ glyph, which has a built-in diagonal tilt.
      html: '<div class="plane-marker' + (onGround ? ' on-ground' : '') +
            '" style="transform:rotate(' + Math.round(track || 0) + 'deg)">' +
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">' +
            '<path d="M12 2c-.6 0-1 .9-1 2.3V9L3 13.4v1.6l8-2.2v4.3l-2 1.5v1.3l3-.8 3 .8v-1.3l-2-1.5v-4.3l8 2.2v-1.6L13 9V4.3C13 2.9 12.6 2 12 2z"/>' +
            '</svg></div>',
      iconSize: [18, 18], iconAnchor: [9, 9],
    });
  }

  function popup(a) {
    const alt = (a.alt === 'ground' || a.alt == null) ? 'on ground' : Math.round(a.alt) + ' ft';
    const spd = a.gs ? Math.round(a.gs) + ' kt' : '';
    return '<b>' + (a.flight || a.hex) + '</b>' +
      (a.type ? ' &middot; ' + a.type : '') + '<br>' + alt +
      (spd ? '<br>' + spd : '') + (a.reg ? '<br>' + a.reg : '') +
      (a.flight ? '<br><a href="#" class="more-info" onclick="window.App.openFlight(\'' +
        a.flight + '\');return false;">More info →</a>' : '');
  }

  // Advance a lat/lon by ground speed (kt) along a track (deg) for dt seconds.
  function deadReckon(a, dtSec) {
    if (!a.gs || a.alt === 'ground') return [a.lat, a.lon];
    const distNm = (a.gs / 3600) * dtSec;
    const dLat = (distNm / 60) * Math.cos(a.track * Math.PI / 180);
    const dLon = (distNm / 60) * Math.sin(a.track * Math.PI / 180) /
                 Math.cos(a.lat * Math.PI / 180);
    return [a.lat + dLat, a.lon + dLon];
  }

  function clearFleet() {
    fleet.forEach(a => { if (a.marker) layer.removeLayer(a.marker); });
    fleet.clear();
  }

  async function fetchFleet() {
    if (!map) return;
    const c = center();
    const list = await Adsb.point(c[0], c[1], RADIUS_NM);
    if (list === null) return;                            // both feeds unreachable

    const now = Date.now();
    list.forEach(raw => {
      const hex = raw.hex;
      if (!hex) return;
      let a = fleet.get(hex);
      if (!a) { a = { hex }; fleet.set(hex, a); }
      a.lat = raw.lat;
      a.lon = raw.lon;
      a.track = raw.track || 0;
      a.gs = raw.gs || 0;
      a.alt = raw.alt;
      a.flight = raw.callsign;
      a.type = raw.type;
      a.reg = raw.reg;
      a.seen = now;
      a.base = now;
    });
    redraw();
  }

  function redraw() {
    if (!map) return;
    const now = Date.now();
    fleet.forEach((a, hex) => {
      if (now - a.seen > STALE_MS) {
        if (a.marker) layer.removeLayer(a.marker);
        fleet.delete(hex);
        return;
      }
      const [lat, lon] = deadReckon(a, (now - a.base) / 1000);
      if (!a.marker) {
        a.marker = L.marker([lat, lon], { icon: icon(a.track, a.alt === 'ground') });
        a.marker.bindPopup(popup(a));
        layer.addLayer(a.marker);
      } else {
        a.marker.setLatLng([lat, lon]);
        a.marker.setIcon(icon(a.track, a.alt === 'ground'));
        a.marker.setPopupContent(popup(a));
      }
    });
    const el = document.getElementById('radar-count');
    if (el) el.textContent = fleet.size + ' aircraft';
  }

  window.Views = window.Views || {};
  window.Views.radar = {
    async activate() {
      await App.loadLeaflet();
      ensureMap();
      if (!map) return;
      const icaoNow = App.airport ? App.airport.icao : null;
      const changed = icaoNow !== lastIcao;
      if (changed) {
        lastIcao = icaoNow;
        clearFleet();
        map.setView(center(), 8);
        if (!apMarker) {
          apMarker = L.circleMarker(center(), { radius: 4, color: '#f5b301', weight: 2, fillOpacity: 1 }).addTo(map);
        } else {
          apMarker.setLatLng(center());
        }
        apMarker.bindTooltip(App.airport ? App.airport.iata : '', { permanent: false });
      }
      setTimeout(() => { if (map) map.invalidateSize(); }, 60);
      fetchFleet();
      clearInterval(pollTimer); clearInterval(tickTimer);
      pollTimer = setInterval(fetchFleet, POLL_MS);
      tickTimer = setInterval(redraw, TICK_MS);
    },
  };
})();
