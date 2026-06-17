<?php
/**
 * _bootstrap.php — shared setup for the read-only JSON API endpoints.
 *
 * These endpoints serve ONLY cached JSON written by the cron prefetch scripts.
 * They never call AeroDataBox/OpenSky directly, so API keys never reach the
 * browser and page views can't burn the monthly quota.
 */

// Never display PHP errors to the client (could leak paths/secrets).
error_reporting(E_ALL);
ini_set('display_errors', '0');

require __DIR__ . '/../../cron/lib/Cache.php';

$CONFIG_FILE = __DIR__ . '/../../private/config.php';
if (!is_file($CONFIG_FILE)) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Server not configured']);
    exit;
}
$config = require $CONFIG_FILE;
$cache  = new Cache($config['cache_dir']);

/** Emit JSON and exit. */
function json_out($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: public, max-age=20');   // brief edge/browser cache
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Read a cache entry and attach freshness metadata. Returns an envelope:
 *   { fetchedAt, ageSeconds, stale, ...payload }
 * or null if the cache file is missing.
 */
function cache_envelope(Cache $cache, string $key, int $staleSeconds): ?array
{
    $entry = $cache->read($key);
    if ($entry === null) {
        return null;
    }
    $age = time() - (int)($entry['fetchedAt'] ?? 0);
    $payload = $entry['payload'] ?? [];
    if (!is_array($payload)) {
        $payload = ['value' => $payload];
    }
    return array_merge($payload, [
        'fetchedAt'  => (int)($entry['fetchedAt'] ?? 0),
        'ageSeconds' => $age,
        'stale'      => $age > $staleSeconds,
    ]);
}
