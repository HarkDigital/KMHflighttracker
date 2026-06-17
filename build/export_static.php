<?php
/**
 * export_static.php — produce the static JSON the GitHub Pages frontend reads
 * from public/data/. This is the "cron" equivalent for static hosting: a
 * GitHub Actions workflow runs it on a schedule, then deploys public/.
 *
 * It makes only the cheap, essential API calls:
 *   - 2 AeroDataBox FIDS calls (departures + arrivals)
 *   - per-flight detail is SYNTHESIZED from those board rows (no extra units)
 *   - 1 OpenSky call for the live map (separate free quota)
 *
 * Runs against the same config + API clients as the IONOS cron, and honours
 * 'mock' mode so it works with no API keys (useful for a first deploy).
 *
 * Usage:  php build/export_static.php
 */

require __DIR__ . '/../cron/lib/Cache.php';
require __DIR__ . '/../cron/lib/AeroDataBox.php';
require __DIR__ . '/../cron/lib/OpenSky.php';
require __DIR__ . '/../cron/lib/normalize.php';

$root = dirname(__DIR__);
$configFile = $root . '/private/config.php';
if (!is_file($configFile)) {
    fwrite(STDERR, "Missing private/config.php\n");
    exit(2);
}
$config = require $configFile;

$dataDir = $root . '/public/data';
$flightsDir = $dataDir . '/flights';
@mkdir($flightsDir, 0775, true);

$cache = new Cache($config['cache_dir'] ?? sys_get_temp_dir());
$adb   = new AeroDataBox($config, $cache);
$osky  = new OpenSky($config, $cache);

$icao  = $config['airport_icao'];
$iata  = $config['airport_iata'] ?? '';
$name  = $config['airport_name'] ?? $icao;
$window = (int)($config['board_window_hours'] ?? 8);
$now = time();

/** Write a JSON file (pretty + atomic-ish). */
function put_json(string $file, $data): void
{
    file_put_contents($file, json_encode($data, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
    echo "wrote " . basename(dirname($file)) . '/' . basename($file) . "\n";
}

/** Turn a board row into a flight card record (no extra API call). */
function synth_flight(array $row, string $type, string $iata, string $name, int $now): array
{
    $home  = ['iata' => $iata, 'name' => $name, 'time' => $row['time'],
              'est' => $row['estimated'], 'gate' => $row['gate'], 'terminal' => $row['terminal']];
    $other = ['iata' => $row['placeIata'], 'name' => $row['place'],
              'time' => '', 'est' => '', 'gate' => '', 'terminal' => ''];
    [$from, $to] = $type === 'departures' ? [$home, $other] : [$other, $home];
    return [
        'flight'   => $row['flight'], 'airline' => $row['airline'], 'status' => $row['status'],
        'reg'      => $row['reg'], 'aircraft' => $row['aircraft'],
        'from'     => $from, 'to' => $to,
        'fetchedAt' => $now, 'state' => 'ready',
    ];
}

// ---- Board (departures + arrivals) ----
$flightFiles = [];
foreach (['departures', 'arrivals'] as $type) {
    try {
        $raw = $adb->airportBoard($icao, $type, $window);
        $items = $raw[$type] ?? ($raw['departures'] ?? ($raw['arrivals'] ?? []));
        $rows = [];
        foreach ((is_array($items) ? $items : []) as $item) {
            if (is_array($item)) $rows[] = normalize_board_item($item, $type);
        }
        usort($rows, fn($a, $b) => strcmp($a['time'], $b['time']));

        put_json("$dataDir/board_$type.json", [
            'airport' => $name, 'icao' => $icao, 'type' => $type,
            'rows' => $rows, 'fetchedAt' => $now, 'stale' => false,
        ]);

        // Synthesize a per-flight file for each board flight.
        foreach ($rows as $row) {
            $num = preg_replace('/[^A-Z0-9]/', '', strtoupper($row['flight']));
            if ($num === '') continue;
            $flightFiles[$num] = synth_flight($row, $type, $iata, $name, $now);
        }
    } catch (Throwable $e) {
        fwrite(STDERR, "board[$type] ERROR: " . $e->getMessage() . "\n");
    }
}
foreach ($flightFiles as $num => $rec) {
    put_json("$flightsDir/$num.json", $rec);
}

// ---- Live map (OpenSky) ----
try {
    $raw = $osky->statesInBbox($config['bbox']);
    $aircraft = [];
    foreach (($raw['states'] ?? []) as $s) {
        if (!is_array($s) || $s[5] === null || $s[6] === null) continue;
        $aircraft[] = [
            'icao24' => $s[0], 'callsign' => trim((string)($s[1] ?? '')),
            'country' => $s[2] ?? '', 'lon' => $s[5], 'lat' => $s[6],
            'altitude' => $s[13] ?? $s[7], 'onGround' => (bool)($s[8] ?? false),
            'velocity' => $s[9], 'heading' => $s[10] ?? 0,
        ];
    }
    put_json("$dataDir/states.json", [
        'time' => $raw['time'] ?? $now, 'aircraft' => $aircraft,
        'bbox' => $config['bbox'],
        'airport' => ['iata' => $iata, 'name' => $name],
        'fetchedAt' => $now,
    ]);
} catch (Throwable $e) {
    fwrite(STDERR, "states ERROR: " . $e->getMessage() . "\n");
    // Write an empty states file so the map degrades gracefully.
    if (!is_file("$dataDir/states.json")) {
        put_json("$dataDir/states.json", [
            'time' => $now, 'aircraft' => [], 'bbox' => $config['bbox'],
            'airport' => ['iata' => $iata, 'name' => $name], 'fetchedAt' => $now,
        ]);
    }
}

echo "export complete\n";
