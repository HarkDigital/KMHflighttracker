<?php
/**
 * _feed.php — shared helpers for the cached feed proxies (adsb.php, routes.php).
 *
 * These endpoints sit between the browser and the free public ADS-B/route APIs.
 * The browser talks only to our own origin (one DNS+TLS, same host as the app),
 * and the server fetches upstream once and caches it on disk — so repeat polls
 * and other devices are served instantly, and the slow third-party calls run on
 * the server's fast connection instead of an iPad over home wifi.
 */

error_reporting(E_ALL);
ini_set('display_errors', '0');

function feed_json($obj, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($obj, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function feed_cache_dir() {
    $d = __DIR__ . '/cache';
    if (!is_dir($d)) { @mkdir($d, 0775, true); }
    return $d;
}

/** Return decoded cache if younger than $ttl seconds, else null. */
function feed_cache_get($file, $ttl) {
    if (is_file($file)) {
        $age = time() - filemtime($file);
        if ($age < $ttl) {
            $j = json_decode(file_get_contents($file), true);
            if (is_array($j)) return $j;
        }
    }
    return null;
}

/** Atomic write. */
function feed_cache_put($file, $data) {
    $tmp = $file . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmp, json_encode($data)) !== false) { @rename($tmp, $file); }
}

/** GET with timeout + gzip; returns body string or null on any failure/4xx/5xx. */
function feed_get($url, $timeout = 8, $headers = []) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_ENCODING       => '',          // accept gzip
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_USERAGENT      => 'KMHFlights/1.0',
    ]);
    $b = curl_exec($ch);
    $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ($b !== false && $c >= 200 && $c < 400) ? $b : null;
}

/** POST JSON with timeout; returns body string or null. */
function feed_post_json($url, $body, $timeout = 8) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_ENCODING       => '',
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_USERAGENT      => 'KMHFlights/1.0',
    ]);
    $b = curl_exec($ch);
    $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ($b !== false && $c >= 200 && $c < 400) ? $b : null;
}

/** Occasionally sweep cache files older than a day so the dir can't grow forever. */
function feed_cache_sweep($dir, $prefix) {
    if (mt_rand(1, 50) !== 1) return;            // ~2% of requests
    foreach (glob($dir . '/' . $prefix . '*.json') ?: [] as $f) {
        if (time() - filemtime($f) > 86400) @unlink($f);
    }
}

/** Send the buffered response to the client and keep running (PHP-FPM only).
 *  Returns true if the request was detached so background work is invisible. */
function feed_finish() {
    if (function_exists('fastcgi_finish_request')) { @fastcgi_finish_request(); return true; }
    return false;
}
