<?php
/**
 * GET /api/flight.php?flight=AA1234
 * Returns the cached status/route/aircraft for a tracked flight. If the flight
 * isn't cached yet, responds with status "pending" — the frontend should POST
 * it to /api/watch.php so the cron picks it up next run.
 */
require __DIR__ . '/_bootstrap.php';

$number = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $_GET['flight'] ?? ''));
if ($number === '') {
    json_out(['error' => 'Missing flight number'], 400);
}

$staleSeconds = (int)($config['flight_stale_min'] ?? 180) * 60;
$env = cache_envelope($cache, 'flight_' . $number, $staleSeconds);

if ($env === null) {
    json_out([
        'flight'  => $number,
        'state'   => 'pending',
        'message' => 'Not tracked yet — added to the queue.',
    ]);
}
$env['state'] = 'ready';
json_out($env);
