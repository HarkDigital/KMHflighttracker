<?php
/**
 * prefetch_states.php — fetch live aircraft positions around the airport from
 * OpenSky and write a compact cache for the live map. OpenSky has its own free
 * quota (separate from AeroDataBox), so this can run more often.
 *
 * Run by IONOS cron:  php /…/cron/prefetch_states.php
 */

require __DIR__ . '/lib/boot.php';

$lock = cron_lock('states');
$osky = new OpenSky($config, $cache);

try {
    $raw = $osky->statesInBbox($config['bbox']);

    // OpenSky /states/all column order (subset we use):
    //  0 icao24, 1 callsign, 2 origin_country, 5 longitude, 6 latitude,
    //  7 baro_altitude, 8 on_ground, 9 velocity, 10 true_track (heading),
    //  13 geo_altitude
    $aircraft = [];
    foreach (($raw['states'] ?? []) as $s) {
        if (!is_array($s) || $s[5] === null || $s[6] === null) {
            continue;   // skip aircraft with no position
        }
        $aircraft[] = [
            'icao24'   => $s[0],
            'callsign' => trim((string)($s[1] ?? '')),
            'country'  => $s[2] ?? '',
            'lon'      => $s[5],
            'lat'      => $s[6],
            'altitude' => $s[13] ?? $s[7],          // metres
            'onGround' => (bool)($s[8] ?? false),
            'velocity' => $s[9],                     // m/s
            'heading'  => $s[10] ?? 0,               // degrees
        ];
    }

    $cache->write('opensky_states', [
        'time'     => $raw['time'] ?? time(),
        'aircraft' => $aircraft,
    ]);
    logline('states: cached ' . count($aircraft) . ' aircraft');
} catch (Throwable $e) {
    logline('states ERROR: ' . $e->getMessage());
    // Keep previous cache; states.php serves it (briefly stale).
}
