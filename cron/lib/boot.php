<?php
/**
 * boot.php — shared bootstrap for the cron prefetch scripts.
 * Loads config + library classes, builds a Cache, and provides a simple
 * lock so overlapping cron runs don't stomp each other.
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');   // CLI only — these scripts never serve the web

require __DIR__ . '/Cache.php';
require __DIR__ . '/AeroDataBox.php';
require __DIR__ . '/OpenSky.php';
require __DIR__ . '/normalize.php';

$CONFIG_FILE = __DIR__ . '/../../private/config.php';
if (!is_file($CONFIG_FILE)) {
    fwrite(STDERR, "Missing private/config.php — copy config.sample.php first.\n");
    exit(2);
}
$config = require $CONFIG_FILE;
$cache  = new Cache($config['cache_dir']);

/**
 * Acquire a non-blocking lock for a named job. Returns the file handle
 * (keep it in scope to hold the lock) or exits quietly if already running.
 */
function cron_lock(string $name)
{
    $lockFile = sys_get_temp_dir() . '/phlboard_' . preg_replace('/\W/', '', $name) . '.lock';
    $fh = fopen($lockFile, 'c');
    if (!$fh || !flock($fh, LOCK_EX | LOCK_NB)) {
        fwrite(STDERR, "[$name] already running — skipping\n");
        exit(0);
    }
    return $fh;
}

function logline(string $msg): void
{
    fwrite(STDOUT, '[' . date('H:i:s') . '] ' . $msg . "\n");
}
