/**
 * airlines.js — IATA <-> ICAO airline codes + names, so a ticket-style flight
 * number (e.g. "DL2092") converts to the ICAO callsign aircraft actually
 * broadcast ("DAL2092"). Route databases are keyed on the ICAO callsign, so
 * this is essential for accurate lookups.
 */
window.Airlines = (function () {
  'use strict';
  // iata, icao, name
  const A = [
    ['AA','AAL','American Airlines'],['DL','DAL','Delta Air Lines'],['UA','UAL','United Airlines'],
    ['WN','SWA','Southwest'],['AS','ASA','Alaska Airlines'],['B6','JBU','JetBlue'],['NK','NKS','Spirit'],
    ['F9','FFT','Frontier'],['HA','HAL','Hawaiian'],['G4','AAY','Allegiant'],['SY','SCX','Sun Country'],
    ['AC','ACA','Air Canada'],['WS','WJA','WestJet'],
    ['OO','SKW','SkyWest'],['YX','RPA','Republic'],['MQ','ENY','Envoy Air'],['OH','JIA','PSA Airlines'],
    ['9E','EDV','Endeavor Air'],['YV','ASH','Mesa Airlines'],['ZW','AWI','Air Wisconsin'],['G7','GJS','GoJet'],
    ['QX','QXE','Horizon Air'],['EV','ASQ','ExpressJet'],['CP','CPZ','Compass'],
    ['BA','BAW','British Airways'],['VS','VIR','Virgin Atlantic'],['LH','DLH','Lufthansa'],['AF','AFR','Air France'],
    ['KL','KLM','KLM'],['IB','IBE','Iberia'],['AZ','ITY','ITA Airways'],['LX','SWR','Swiss'],['OS','AUA','Austrian'],
    ['SN','BEL','Brussels Airlines'],['TP','TAP','TAP Air Portugal'],['SK','SAS','SAS'],['AY','FIN','Finnair'],
    ['EI','EIN','Aer Lingus'],['FR','RYR','Ryanair'],['U2','EZY','easyJet'],['W6','WZZ','Wizz Air'],
    ['EW','EWG','Eurowings'],['LO','LOT','LOT Polish'],['TK','THY','Turkish Airlines'],
    ['EK','UAE','Emirates'],['QR','QTR','Qatar Airways'],['EY','ETD','Etihad'],['SV','SVA','Saudia'],
    ['SQ','SIA','Singapore Airlines'],['CX','CPA','Cathay Pacific'],['QF','QFA','Qantas'],['NZ','ANZ','Air New Zealand'],
    ['JL','JAL','Japan Airlines'],['NH','ANA','All Nippon'],['KE','KAL','Korean Air'],['OZ','AAR','Asiana'],
    ['CI','CAL','China Airlines'],['BR','EVA','EVA Air'],['TG','THA','Thai Airways'],['MH','MAS','Malaysia Airlines'],
    ['GA','GIA','Garuda'],['CA','CCA','Air China'],['MU','CES','China Eastern'],['CZ','CSN','China Southern'],
    ['HU','CHH','Hainan'],['AM','AMX','Aeromexico'],['CM','CMP','Copa Airlines'],['AV','AVA','Avianca'],
    ['LA','LAN','LATAM'],['JJ','TAM','LATAM Brasil'],['ET','ETH','Ethiopian'],['SA','SAA','South African'],
    ['MS','MSR','EgyptAir'],['AI','AIC','Air India'],['6E','IGO','IndiGo'],['UK','VTI','Vistara'],
  ];
  const byIata = {}, byIcao = {};
  A.forEach(([iata, icao, name]) => { byIata[iata] = { iata, icao, name }; byIcao[icao] = { iata, icao, name }; });

  const clean = s => (s || '').toUpperCase().replace(/\s+/g, '');

  // Airline prefix = 2-3 letters (ICAO/IATA), or letter+digit / digit+letter
  // (IATA like B6, U2, 9E), followed by the flight number.
  const FLIGHT_RE = /^([A-Z]{2,3}|[A-Z]\d|\d[A-Z])(\d{1,4}[A-Z]?)$/;

  // Convert a flight number to the broadcast ICAO callsign where possible.
  function toCallsign(flightNo) {
    const f = clean(flightNo);
    const m = f.match(FLIGHT_RE);
    if (!m) return f;
    const pre = m[1], num = m[2];
    if (pre.length === 2 && byIata[pre]) return byIata[pre].icao + num;
    return f;   // already ICAO, or unknown prefix
  }
  function looksLikeFlight(s) { return FLIGHT_RE.test(clean(s)); }
  function name(code) {
    const c = clean(code);
    return (byIcao[c] && byIcao[c].name) || (byIata[c] && byIata[c].name) || '';
  }
  function airlineOf(callsign) {
    const m = clean(callsign).match(/^([A-Z]{3})\d/);
    return m ? name(m[1]) : '';
  }
  return { toCallsign, looksLikeFlight, name, airlineOf };
})();
