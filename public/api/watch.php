<?php
/**
 * POST /api/watch.php   body: { "flight": "AA1234" }
 * Adds a starred flight number to the server-side watchlist so the cron keeps
 * its status fresh even after it leaves the board. Capped + deduped + TTL'd by
 * the cron. This is the only write endpoint; it stores nothing but a number.
 */
require __DIR__ . '/_bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_out(['error' => 'POST only'], 405);
}

$body = json_decode(file_get_contents('php://input'), true) ?: $_POST;
$number = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $body['flight'] ?? ''));
if ($number === '' || strlen($number) > 8) {
    json_out(['error' => 'Invalid flight number'], 400);
}

$max = (int)($config['watchlist_max'] ?? 15);

$entry = $cache->read('watchlist');
$flights = $entry['payload']['flights'] ?? [];
if (!is_array($flights)) {
    $flights = [];
}

$flights[$number] = time();             // (re)stamp so it survives TTL pruning
arsort($flights);                        // newest first
$flights = array_slice($flights, 0, $max, true);

$cache->write('watchlist', ['flights' => $flights]);

json_out(['ok' => true, 'flight' => $number, 'watching' => count($flights)]);
