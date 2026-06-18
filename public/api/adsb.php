<?php
/**
 * adsb.php — cached, trimmed proxy for the free ADS-B feeds.
 *
 *   GET ?type=point&lat=..&lon=..&radius=..   live traffic near a point
 *   GET ?type=callsign&cs=DAL2092             one aircraft by callsign
 *
 * Stale-while-revalidate: a recent cached copy is served INSTANTLY and the
 * upstream refresh happens in the background after the response is sent (so the
 * browser never waits on the slow third-party API). Falls back adsb.lol ->
 * airplanes.live, and to a synchronous fetch when there's no usable cache or the
 * host can't detach the request. Output keeps the upstream field names the
 * browser already reads, trimmed to shrink the payload.
 */
require __DIR__ . '/_feed.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=8');

$FRESH = 10;          // within this, serve as-is and don't bother refreshing
$STALE = 90;          // within this, serve instantly + refresh in the background
$dir = feed_cache_dir();
$type = ($_GET['type'] ?? 'point') === 'callsign' ? 'callsign' : 'point';

if ($type === 'callsign') {
    $cs = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $_GET['cs'] ?? ''));
    if ($cs === '') { echo json_encode(['ac' => []]); exit; }
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

/** Fetch upstream, trim, cache, and return the payload (or null on failure). */
function adsb_refresh($urls, $file) {
    $raw = null;
    foreach ($urls as $u) { $raw = feed_get($u, 8); if ($raw !== null) break; }
    if ($raw === null) return null;
    $d  = json_decode($raw, true);
    $ac = (is_array($d) ? ($d['ac'] ?? ($d['aircraft'] ?? [])) : []) ?: [];
    $trim = [];
    foreach ($ac as $a) {
        if (!isset($a['lat'], $a['lon'])) continue;
        $trim[] = [
            'hex'       => $a['hex'] ?? ($a['r'] ?? ''),
            'flight'    => isset($a['flight']) ? trim($a['flight']) : '',
            'lat'       => $a['lat'], 'lon' => $a['lon'],
            'alt_baro'  => $a['alt_baro'] ?? null,
            'gs'        => $a['gs'] ?? 0,
            'track'     => $a['track'] ?? ($a['true_heading'] ?? 0),
            'baro_rate' => $a['baro_rate'] ?? ($a['geom_rate'] ?? 0),
            't'         => $a['t'] ?? '', 'r' => $a['r'] ?? '',
        ];
    }
    $out = ['ac' => $trim, 'fetchedAt' => time()];
    feed_cache_put($file, $out);
    return $out;
}

function adsb_send($out) {
    $out['ageSeconds'] = isset($out['fetchedAt']) ? time() - $out['fetchedAt'] : 0;
    echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

// 1) Fresh enough -> serve as-is.
$fresh = feed_cache_get($file, $FRESH);
if ($fresh) adsb_send($fresh);

// 2) Slightly stale + we can detach the request -> serve instantly, refresh after.
$stale = feed_cache_get($file, $STALE);
if ($stale && function_exists('fastcgi_finish_request')) {
    $stale['ageSeconds'] = time() - ($stale['fetchedAt'] ?? time());
    $stale['stale'] = true;
    echo json_encode($stale, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    feed_finish();                       // browser has its answer; below is invisible
    adsb_refresh($urls, $file);          // warm the cache for next time
    exit;
}

// 3) No usable cache (or can't background) -> fetch now.
feed_cache_sweep($dir, $type === 'callsign' ? 'cs_' : 'pt_');
$out = adsb_refresh($urls, $file);
if ($out === null) {
    $any = feed_cache_get($file, 86400);
    if ($any) { $any['stale'] = true; adsb_send($any); }
    echo json_encode(['ac' => [], 'error' => 'upstream']); exit;
}
adsb_send($out);
