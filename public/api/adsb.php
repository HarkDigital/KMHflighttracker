<?php
/**
 * adsb.php — cached, trimmed proxy for the free ADS-B feeds.
 *
 *   GET ?type=point&lat=..&lon=..&radius=..   live traffic near a point
 *   GET ?type=callsign&cs=DAL2092             one aircraft by callsign
 *
 * Caches each result on disk briefly (live data, ~10s) so repeat polls and
 * other devices are served instantly. Falls back adsb.lol -> airplanes.live
 * server-side, and serves a stale copy if both fail. Output keeps the upstream
 * field names the browser already reads ({ ac: [ { hex, flight, lat, lon,
 * alt_baro, gs, track, baro_rate, t, r } ] }), trimmed to shrink the payload.
 */
require __DIR__ . '/_feed.php';
header('Cache-Control: public, max-age=8');

$TTL = 10;
$dir = feed_cache_dir();
$type = ($_GET['type'] ?? 'point') === 'callsign' ? 'callsign' : 'point';

if ($type === 'callsign') {
    $cs = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $_GET['cs'] ?? ''));
    if ($cs === '') feed_json(['ac' => []]);
    $file = $dir . '/cs_' . $cs . '.json';
    $urls = [
        'https://api.adsb.lol/v2/callsign/' . rawurlencode($cs),
        'https://api.airplanes.live/v2/callsign/' . rawurlencode($cs),
    ];
} else {
    $lat = round((float)($_GET['lat'] ?? 0), 2);
    $lon = round((float)($_GET['lon'] ?? 0), 2);
    $r   = max(1, min(250, (int)($_GET['radius'] ?? 90)));
    $file = $dir . '/pt_' . $lat . '_' . $lon . '_' . $r . '.json';
    $urls = [
        "https://api.adsb.lol/v2/point/$lat/$lon/$r",
        "https://api.airplanes.live/v2/point/$lat/$lon/$r",
    ];
}

// Fresh cache -> serve immediately.
$hit = feed_cache_get($file, $TTL);
if ($hit) { $hit['ageSeconds'] = time() - filemtime($file); feed_json($hit); }

feed_cache_sweep($dir, $type === 'callsign' ? 'cs_' : 'pt_');

// Fetch upstream (first provider that answers).
$raw = null;
foreach ($urls as $u) { $raw = feed_get($u, 8); if ($raw !== null) break; }
if ($raw === null) {
    $stale = feed_cache_get($file, 86400);
    if ($stale) { $stale['stale'] = true; $stale['ageSeconds'] = time() - filemtime($file); feed_json($stale); }
    feed_json(['ac' => [], 'error' => 'upstream']);
}

$d  = json_decode($raw, true);
$ac = (is_array($d) ? ($d['ac'] ?? ($d['aircraft'] ?? [])) : []) ?: [];
$trim = [];
foreach ($ac as $a) {
    if (!isset($a['lat'], $a['lon'])) continue;
    $trim[] = [
        'hex'       => $a['hex'] ?? ($a['r'] ?? ''),
        'flight'    => isset($a['flight']) ? trim($a['flight']) : '',
        'lat'       => $a['lat'],
        'lon'       => $a['lon'],
        'alt_baro'  => $a['alt_baro'] ?? null,
        'gs'        => $a['gs'] ?? 0,
        'track'     => $a['track'] ?? ($a['true_heading'] ?? 0),
        'baro_rate' => $a['baro_rate'] ?? ($a['geom_rate'] ?? 0),
        't'         => $a['t'] ?? '',
        'r'         => $a['r'] ?? '',
    ];
}

$out = ['ac' => $trim, 'fetchedAt' => time(), 'ageSeconds' => 0];
feed_cache_put($file, $out);
feed_json($out);
