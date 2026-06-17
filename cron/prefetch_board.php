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
$icao = $config['airport_icao'];
$window = (int)($config['board_window_hours'] ?? 8);

$adb = new AeroDataBox($config, $cache);

foreach (['departures', 'arrivals'] as $type) {
    try {
        if ($adb->unitsRemaining() < 1) {
            logline("board[$type]: budget exhausted — keeping existing cache");
            continue;
        }
        $raw = $adb->airportBoard($icao, $type, $window);

        // FIDS returns { departures: [...] } or { arrivals: [...] }.
        $items = $raw[$type] ?? ($raw['departures'] ?? ($raw['arrivals'] ?? []));
        if (!is_array($items)) {
            $items = [];
        }

        $rows = [];
        foreach ($items as $item) {
            if (is_array($item)) {
                $rows[] = normalize_board_item($item, $type);
            }
        }
        // Sort by scheduled time.
        usort($rows, fn($a, $b) => strcmp($a['time'], $b['time']));

        $cache->write("board_{$icao}_{$type}", [
            'airport' => $config['airport_name'] ?? $icao,
            'icao'    => $icao,
            'type'    => $type,
            'rows'    => $rows,
        ]);
        logline("board[$type]: cached " . count($rows) . " flights (units left: " . $adb->unitsRemaining() . ")");
    } catch (Throwable $e) {
        logline("board[$type] ERROR: " . $e->getMessage());
        // Leave the previous cache in place — board.php will serve it stale.
    }
}
