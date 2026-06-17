<?php
/**
 * GET /api/health.php
 * Debug view: cache file ages + remaining monthly API-unit budget.
 * Optionally guarded by ?token= matching config 'health_token'.
 */
require __DIR__ . '/_bootstrap.php';

$want = (string)($config['health_token'] ?? '');
if ($want !== '' && ($_GET['token'] ?? '') !== $want) {
    json_out(['error' => 'forbidden'], 403);
}

$icao = $config['airport_icao'];
$budget = (int)($config['monthly_unit_budget'] ?? 600);
$used   = $cache->unitsUsed('aerodatabox');

$keys = [
    "board_{$icao}_departures",
    "board_{$icao}_arrivals",
    'opensky_states',
    'watchlist',
];
$caches = [];
foreach ($keys as $k) {
    $age = $cache->ageSeconds($k);
    $caches[$k] = $age === null ? 'missing' : ($age . 's ago');
}

json_out([
    'airport' => $icao,
    'now'     => gmdate('c'),
    'budget'  => ['monthly' => $budget, 'used' => $used, 'remaining' => max(0, $budget - $used)],
    'caches'  => $caches,
]);
