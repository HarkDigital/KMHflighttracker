<?php
/**
 * GET /api/flight.php?flight=AA1234
 *
 * On-demand, cached AeroDataBox flight-by-number proxy. The browser never sees
 * the API key: it lives in config.php (generated at deploy from the
 * AERODATABOX_KEY GitHub secret) and is only sent server-side in the
 * X-RapidAPI-Key header. Responses are cached on disk for cache_ttl seconds so
 * many viewers of the same flight cost a single API unit — this is what keeps us
 * inside the free Basic monthly quota.
 *
 * Output is normalized to the shape flights.js (Flights.fromAdb) expects:
 *   { state:'ready', flight, airline, status, aircraft, reg,
 *     from:{iata,icao,name,city,lat,lon,scheduled,estimated,gate,terminal},
 *     to:{...}, fetchedAt, ageSeconds }
 * On any upstream/config failure it returns { state:'error', ... } so the client
 * transparently falls back to the free ADS-B + adsbdb feeds.
 */

error_reporting(E_ALL);
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=60');

function out($obj, $code = 200) {
    http_response_code($code);
    echo json_encode($obj, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

// ---- Config (key never leaves the server) ----
$cfgPath = __DIR__ . '/config.php';
if (!is_file($cfgPath)) {
    out(['state' => 'error', 'reason' => 'not_configured'], 200);
}
$cfg  = require $cfgPath;
$key  = $cfg['aerodatabox_key']  ?? '';
$host = $cfg['aerodatabox_host'] ?? 'aerodatabox.p.rapidapi.com';
$ttl  = (int)($cfg['cache_ttl']  ?? 300);
$budget   = (int)($cfg['monthly_unit_budget'] ?? 540);   // free Basic = 600; leave margin
$unitCost = (int)($cfg['unit_cost'] ?? 2);               // flight-by-number = Tier 2
if ($key === '' || $key === 'YOUR_RAPIDAPI_KEY') {
    out(['state' => 'error', 'reason' => 'not_configured'], 200);
}

// ---- Validate the flight number ----
$flight = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $_GET['flight'] ?? ''));
if (!preg_match('/^[A-Z0-9]{2,8}$/', $flight)) {
    out(['state' => 'error', 'reason' => 'bad_flight'], 400);
}

// ---- Disk cache ----
$cacheDir = __DIR__ . '/cache';
if (!is_dir($cacheDir)) { @mkdir($cacheDir, 0775, true); }
$cacheFile = $cacheDir . '/flight_' . $flight . '.json';

if (is_file($cacheFile)) {
    $age = time() - filemtime($cacheFile);
    if ($age < $ttl) {
        $cached = json_decode(file_get_contents($cacheFile), true);
        if (is_array($cached)) {
            $cached['ageSeconds'] = $age;
            out($cached);
        }
    }
}

// ---- Monthly unit budget ----
// AeroDataBox free Basic is 600 units/mo; each flight-by-number call is ~2.
// We track usage per calendar month and hard-stop (serving the last cached
// copy, however stale) once we'd exceed the budget — so we can run a fresh
// cache_ttl without any risk of blowing the free quota.
$usageFile = $cacheDir . '/usage.json';
$month = gmdate('Y-m');
$usage = ['month' => $month, 'units' => 0];
if (is_file($usageFile)) {
    $u = json_decode(file_get_contents($usageFile), true);
    if (is_array($u) && ($u['month'] ?? '') === $month) $usage = $u;
}
function serveStaleOrError($cacheFile, $reason) {
    if (is_file($cacheFile)) {
        $cached = json_decode(file_get_contents($cacheFile), true);
        if (is_array($cached)) {
            $cached['stale'] = true;
            $cached['ageSeconds'] = time() - filemtime($cacheFile);
            out($cached);
        }
    }
    out(['state' => 'error', 'reason' => $reason], 200);
}
if (((int)$usage['units'] + $unitCost) > $budget) {
    serveStaleOrError($cacheFile, 'budget');
}

// ---- Call AeroDataBox (Tier-2 flight status, ~2 units) ----
$url = 'https://' . $host . '/flights/number/' . rawurlencode($flight)
     . '?withAircraftImage=false&withLocation=true';

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_HTTPHEADER     => [
        'X-RapidAPI-Key: ' . $key,
        'X-RapidAPI-Host: ' . $host,
    ],
]);
$body = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

// The request reached RapidAPI (any HTTP status) -> it counts against the
// monthly quota. Record it before we branch on the result.
if ($body !== false && $code > 0) {
    $usage['units'] = (int)$usage['units'] + $unitCost;
    $tmpU = $usageFile . '.' . getmypid() . '.tmp';
    if (@file_put_contents($tmpU, json_encode($usage)) !== false) { @rename($tmpU, $usageFile); }
}

// On upstream trouble, serve a stale cache if we have one rather than failing.
if ($body === false || $code >= 400) {
    serveStaleOrError($cacheFile, 'upstream');
}

$data = json_decode($body, true);
if (!is_array($data) || !count($data)) {
    out(['state' => 'error', 'reason' => 'not_found'], 200);
}

// ---- Pick the leg that is happening now ----
// AeroDataBox returns one entry per recent/upcoming operation of this number
// (which can include yesterday's and tomorrow's). Prefer an active flight
// (EnRoute/Departed); otherwise break ties by whichever leg's scheduled
// departure is closest to the current time, so we never show the wrong day's
// or the return leg.
function legRank($f) {
    $s = strtolower($f['status'] ?? '');
    if (strpos($s, 'enroute') !== false || strpos($s, 'en route') !== false) return 0;
    if (strpos($s, 'departed') !== false || strpos($s, 'airborne') !== false) return 0;
    if (strpos($s, 'boarding') !== false || strpos($s, 'expected') !== false) return 1;
    if (strpos($s, 'scheduled') !== false) return 2;
    if (strpos($s, 'arrived') !== false || strpos($s, 'landed') !== false) return 4;
    return 3;
}
function legWhen($f) {
    $t = $f['departure']['scheduledTime']['utc']
       ?? ($f['departure']['revisedTime']['utc']
       ?? ($f['arrival']['scheduledTime']['utc'] ?? ''));
    $ts = $t ? strtotime($t) : 0;
    return $ts ? abs($ts - time()) : PHP_INT_MAX;
}
usort($data, function ($a, $b) {
    $r = legRank($a) - legRank($b);
    if ($r !== 0) return $r;
    $d = legWhen($a) - legWhen($b);
    return ($d < 0) ? -1 : (($d > 0) ? 1 : 0);
});
$f = $data[0];

// ---- Normalize ----
function hm($t) {
    // AeroDataBox times look like "2026-06-17 14:30-04:00" (local) / "...Z" (utc).
    if (!is_array($t)) return '';
    $s = $t['local'] ?? ($t['utc'] ?? '');
    if (preg_match('/(\d{2}):(\d{2})/', (string)$s, $m)) return $m[1] . ':' . $m[2];
    return '';
}
function endpoint($e) {
    $ap    = $e['airport'] ?? [];
    $loc   = $ap['location'] ?? [];
    $sched = hm($e['scheduledTime'] ?? null);
    $rev   = hm($e['revisedTime'] ?? null);   // actual/estimated when known
    return [
        'iata'      => $ap['iata'] ?? '',
        'icao'      => $ap['icao'] ?? '',
        'name'      => $ap['name'] ?? '',
        'city'      => $ap['municipalityName'] ?? ($ap['shortName'] ?? ($ap['name'] ?? '')),
        'lat'       => $loc['lat'] ?? null,
        'lon'       => $loc['lon'] ?? null,
        'scheduled' => $sched,
        'estimated' => ($rev && $rev !== $sched) ? $rev : '',
        'gate'      => $e['gate'] ?? '',
        'terminal'  => $e['terminal'] ?? '',
    ];
}

$ac = $f['aircraft'] ?? [];
$result = [
    'state'      => 'ready',
    'flight'     => $f['number'] ?? $flight,
    'airline'    => $f['airline']['name'] ?? '',
    'status'     => $f['status'] ?? 'Scheduled',
    'aircraft'   => $ac['model'] ?? '',
    'reg'        => $ac['reg'] ?? '',
    'from'       => endpoint($f['departure'] ?? []),
    'to'         => endpoint($f['arrival'] ?? []),
    'fetchedAt'  => time(),
    'ageSeconds' => 0,
];

// ---- Persist (atomic) ----
$tmp = $cacheFile . '.' . getmypid() . '.tmp';
if (@file_put_contents($tmp, json_encode($result, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)) !== false) {
    @rename($tmp, $cacheFile);
}

out($result);
