<?php
/**
 * GET /api/states.php
 * Returns cached live aircraft positions (OpenSky) for the airport bbox,
 * used by the live map.
 */
require __DIR__ . '/_bootstrap.php';

$staleSeconds = (int)($config['states_stale_min'] ?? 5) * 60;
$env = cache_envelope($cache, 'opensky_states', $staleSeconds);

if ($env === null) {
    json_out(['aircraft' => [], 'stale' => true, 'bbox' => $config['bbox']]);
}
$env['bbox'] = $config['bbox'];
$env['airport'] = [
    'iata' => $config['airport_iata'] ?? '',
    'name' => $config['airport_name'] ?? '',
];
json_out($env);
