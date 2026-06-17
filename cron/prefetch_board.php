<?php
/**
 * prefetch_board.php — fetch the airport departures + arrivals (FIDS) from
 * AeroDataBox and write a normalized board cache. This is the dominant API
 * cost, so it runs on a slow cron cadence (see README) and respects the
 * monthly unit budget.
 *
 * Run by IONOS cron:  php /…/cron/prefetch_board.php
 */

require __DIR__ . '/lib/boot.php';

$lock = cron_lock('board');
$window = (int)($config['board_window_hours'] ?? 8);
$adb = new AeroDataBox($config, $cache);

// Boards for every airport in public/airports.json (fallback: configured one).
$airportsFile = __DIR__ . '/../public/airports.json';
$airports = is_file($airportsFile) ? json_decode((string)file_get_contents($airportsFile), true) : null;
if (!is_array($airports) || !$airports) {
    $airports = [['icao' => $config['airport_icao'], 'name' => $config['airport_name'] ?? '']];
}

foreach ($airports as $ap) {
    $icao = strtoupper($ap['icao'] ?? '');
    if ($icao === '') continue;
    if (array_key_exists('boards', $ap) && $ap['boards'] === false) continue;  // radar-only

    foreach (['departures', 'arrivals'] as $type) {
        try {
            if ($adb->unitsRemaining() < 1) {
                logline("$icao board[$type]: budget exhausted — keeping existing cache");
                continue;
            }
            $raw = $adb->airportBoard($icao, $type, $window);

            $items = $raw[$type] ?? ($raw['departures'] ?? ($raw['arrivals'] ?? []));
            if (!is_array($items)) $items = [];

            $rows = [];
            foreach ($items as $item) {
                if (is_array($item)) $rows[] = normalize_board_item($item, $type);
            }
            usort($rows, fn($a, $b) => strcmp($a['time'], $b['time']));

            $cache->write("board_{$icao}_{$type}", [
                'airport' => $ap['name'] ?? $icao,
                'icao'    => $icao,
                'iata'    => $ap['iata'] ?? '',
                'type'    => $type,
                'rows'    => $rows,
            ]);
            logline("$icao board[$type]: cached " . count($rows) . " flights (units left: " . $adb->unitsRemaining() . ")");
        } catch (Throwable $e) {
            logline("$icao board[$type] ERROR: " . $e->getMessage());
        }
    }
}
