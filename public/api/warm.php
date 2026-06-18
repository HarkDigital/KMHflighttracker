<?php
/**
 * warm.php — keeps the board/radar caches hot so the FIRST load is instant.
 *
 * IONOS runs cron jobs by executing a PHP file from your webspace on a schedule
 * (see the setup notes at the bottom). This script just pokes the app's own
 * cached endpoints for the default airport(s); each one refreshes the upstream
 * ADS-B / route data and stores it on disk for the next visitor — so when your
 * dad opens the app, the data is already waiting in cache.
 *
 * Safe to run as often as you like: the endpoints it calls are themselves cached,
 * so this never hammers the upstream APIs.
 */
require __DIR__ . '/_feed.php';
@set_time_limit(40);

// Your site. Used so the script can poke the live endpoints over HTTP whether
// it's launched from cron (CLI) or hit in a browser.
$BASE = 'https://kmhflights.com';

// Airports to keep warm. PHL is the default Board/Radar; add more here if you
// pin other airports as defaults later.
$airports = [
    ['lat' => 39.8729, 'lon' => -75.2437, 'radius' => 90],   // KPHL — Philadelphia
];

$report = [];
foreach ($airports as $a) {
    // 1) Warm the live traffic feed (the big, fast-changing payload).
    $pt = feed_get("$BASE/api/adsb.php?type=point&lat={$a['lat']}&lon={$a['lon']}&radius={$a['radius']}", 12);

    // 2) Warm the routes for the flights currently in that feed.
    $planes = [];
    if ($pt) {
        $d = json_decode($pt, true);
        foreach (($d['ac'] ?? []) as $ac) {
            if (!empty($ac['flight']) && isset($ac['lat'], $ac['lon'])) {
                $planes[] = ['callsign' => $ac['flight'], 'lat' => $ac['lat'], 'lng' => $ac['lon']];
            }
        }
    }
    if ($planes) feed_post_json("$BASE/api/routes.php", json_encode(['planes' => $planes]), 20);

    $report[] = $a['lat'] . ',' . $a['lon'] . ' -> ' . count($planes) . ' flights';
}

if (PHP_SAPI !== 'cli') header('Content-Type: text/plain; charset=utf-8');
echo 'warmed: ' . implode(' | ', $report) . "\n";

/*
 * --- How to schedule this on IONOS ---
 * 1. Sign in at my.ionos.com.
 * 2. Open your hosting package:  Menu -> "Hosting"  (or "Websites & Stores" ->
 *    your web hosting plan).
 * 3. Find the "Cron Jobs" / "Scheduled Tasks" tile for that package.
 * 4. Create a new cron job:
 *      - Script / file:  api/warm.php   (browse to it in your webspace)
 *      - PHP version:    same one the site uses
 *      - Interval:       every 1 minute if offered, otherwise the smallest
 *                        available (every 5 min is plenty).
 * 5. Save. That's it — the caches now stay warm around the clock.
 */
