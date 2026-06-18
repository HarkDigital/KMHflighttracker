<?php
/**
 * trace.php — cached proxy for an aircraft's real flown track (ADS-B history).
 *
 *   GET ?hex=a1b2c3   ->   { "trace": [ [lat,lon], ... ], "fetchedAt": ... }
 *
 * Pulls the recent trace from the readsb/tar1090 "globe history" files that the
 * ADS-B aggregators publish, keyed by the aircraft's Mode-S hex, and returns
 * just the [lat,lon] path (chronological, origin -> now), downsampled. Cached
 * per-hex briefly so repeat polls/devices are cheap. Returns an empty trace on
 * any failure, so the client simply falls back to a great-circle line.
 */
require __DIR__ . '/_feed.php';
header('Cache-Control: public, max-age=20');

$hex = preg_replace('/[^0-9a-f]/', '', strtolower($_GET['hex'] ?? ''));
if (strlen($hex) < 6) feed_json(['trace' => []]);
$hex = substr($hex, -6);

$dir  = feed_cache_dir();
$file = $dir . '/tr_' . $hex . '.json';

$hit = feed_cache_get($file, 25);
if ($hit) { $hit['ageSeconds'] = time() - filemtime($file); feed_json($hit); }
feed_cache_sweep($dir, 'tr_');

$xx = substr($hex, -2);
$urls = [
    "https://globe.adsb.lol/data/traces/$xx/trace_full_$hex.json",
    "https://globe.adsb.lol/data/traces/$xx/trace_recent_$hex.json",
    "https://globe.airplanes.live/data/traces/$xx/trace_full_$hex.json",
];
$raw = null;
foreach ($urls as $u) { $raw = feed_get($u, 9); if ($raw !== null) break; }
if ($raw === null) {
    $stale = feed_cache_get($file, 86400);
    if ($stale) { $stale['stale'] = true; feed_json($stale); }
    feed_json(['trace' => []]);
}

// readsb trace format: { trace: [ [secs, lat, lon, alt, gs, track, ...], ... ] }
$d  = json_decode($raw, true);
$tr = (is_array($d) && isset($d['trace']) && is_array($d['trace'])) ? $d['trace'] : [];
$pts = [];
foreach ($tr as $p) {
    if (!is_array($p) || !isset($p[1], $p[2]) || !is_numeric($p[1]) || !is_numeric($p[2])) continue;
    $pts[] = [round((float)$p[1], 4), round((float)$p[2], 4)];
}

// Downsample to keep the payload small (curve stays smooth at ~400 points).
$n = count($pts);
if ($n > 400) {
    $step = (int)ceil($n / 400);
    $ds = [];
    for ($i = 0; $i < $n; $i += $step) $ds[] = $pts[$i];
    if ($ds[count($ds) - 1] !== $pts[$n - 1]) $ds[] = $pts[$n - 1];   // keep the latest point
    $pts = $ds;
}

$out = ['trace' => $pts, 'fetchedAt' => time(), 'ageSeconds' => 0];
feed_cache_put($file, $out);
feed_json($out);
