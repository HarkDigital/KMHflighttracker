<?php
/**
 * prefetch_flights.php — keep starred/tracked flights fresh.
 *
 * Reads private/cache/watchlist.json (flight numbers users have starred,
 * written by api/watch.php), fetches each flight's status + route + aircraft
 * model from AeroDataBox, and writes a per-flight cache. Expired entries are
 * pruned so the watchlist stays small and within the API budget.
 *
 * Run by IONOS cron:  php /…/cron/prefetch_flights.php
 */

require __DIR__ . '/lib/boot.php';

$lock = cron_lock('flights');
$adb  = new AeroDataBox($config, $cache);

$ttl = (int)($config['watchlist_ttl_hours'] ?? 48) * 3600;
$max = (int)($config['watchlist_max'] ?? 15);

$wl = $cache->read('watchlist');
$entries = $wl['payload']['flights'] ?? [];
if (!is_array($entries)) {
    $entries = [];
}

// Prune expired, dedupe, cap.
$now = time();
$kept = [];
foreach ($entries as $num => $addedAt) {
    if (($now - (int)$addedAt) <= $ttl) {
        $kept[strtoupper($num)] = (int)$addedAt;
    }
}
arsort($kept);                       // most-recently-starred first
$kept = array_slice($kept, 0, $max, true);

foreach (array_keys($kept) as $number) {
    try {
        if ($adb->unitsRemaining() < 1) {
            logline("flight[$number]: budget exhausted — skipping");
            continue;
        }
        $flights = $adb->flightByNumber($number);
        $aircraft = null;
        $reg = $flights[0]['aircraft']['reg'] ?? '';
        if ($reg && $adb->unitsRemaining() >= 1
            && empty($flights[0]['aircraft']['model'])) {
            try {
                $aircraft = $adb->aircraftByReg($reg);
            } catch (Throwable $e) {
                // model lookup is best-effort
            }
        }
        $record = normalize_flight(is_array($flights) ? $flights : [], $aircraft);
        if ($record) {
            $cache->write('flight_' . $number, $record);
            logline("flight[$number]: " . $record['status'] . " (units left: " . $adb->unitsRemaining() . ")");
        } else {
            logline("flight[$number]: no data");
        }
    } catch (Throwable $e) {
        logline("flight[$number] ERROR: " . $e->getMessage());
    }
}

// Persist the pruned watchlist.
$cache->write('watchlist', ['flights' => $kept]);
