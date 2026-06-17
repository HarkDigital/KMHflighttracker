<?php
/**
 * GET /api/board.php?type=departures|arrivals
 * Returns the cached split-flap board rows for the configured airport.
 */
require __DIR__ . '/_bootstrap.php';

$type = ($_GET['type'] ?? 'departures') === 'arrivals' ? 'arrivals' : 'departures';
// Airport is selectable; sanitize and default to the configured one.
$icao = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $_GET['icao'] ?? '')) ?: $config['airport_icao'];
$staleSeconds = (int)($config['board_stale_min'] ?? 75) * 60;

$env = cache_envelope($cache, "board_{$icao}_{$type}", $staleSeconds);
if ($env === null) {
    json_out([
        'airport' => $config['airport_name'] ?? $icao,
        'type'    => $type,
        'rows'    => [],
        'stale'   => true,
        'message' => 'No data yet — the board is warming up.',
    ]);
}
json_out($env);
