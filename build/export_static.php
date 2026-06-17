<?php
/**
 * export_static.php — produce the static JSON the GitHub Pages frontend reads
 * from public/data/. This is the "cron" equivalent for static hosting: a
 * GitHub Actions workflow runs it on a schedule, then deploys public/.
 *
 * Generates a board (departures + arrivals) for EVERY airport listed in
 * public/airports.json, into public/data/<ICAO>/. Per-flight detail is
 * synthesized from the board rows (no extra API units) into a shared,
 * airport-independent public/data/flights/ folder so starred flights resolve
 * regardless of which airport is selected.
 *
 * The live radar (Map tab) is client-side and needs no prebuilt data.
 *
 * Honours 'mock' mode so it works with no API keys.
 * Usage:  php build/export_static.php
 */

require __DIR__ . '/../cron/lib/Cache.php';
require __DIR__ . '/../cron/lib/AeroDataBox.php';
require __DIR__ . '/../cron/lib/normalize.php';

$root = dirname(__DIR__);
$configFile = $root . '/private/config.php';
if (!is_file($configFile)) {
    fwrite(STDERR, "Missing private/config.php\n");
    exit(2);
}
$config = require $configFile;
$isMock = !empty($config['mock']) || getenv('MOCK') === '1';

$dataDir    = $root . '/public/data';
$flightsDir = $dataDir . '/flights';
@mkdir($flightsDir, 0775, true);

// Airport list (fallback to the single configured airport for back-compat).
$airportsFile = $root . '/public/airports.json';
$airports = is_file($airportsFile) ? json_decode((string)file_get_contents($airportsFile), true) : null;
if (!is_array($airports) || !$airports) {
    $airports = [[
        'icao' => $config['airport_icao'] ?? 'KPHL',
        'iata' => $config['airport_iata'] ?? '',
        'name' => $config['airport_name'] ?? '',
    ]];
}

$cache  = new Cache($config['cache_dir'] ?? sys_get_temp_dir());
$adb    = new AeroDataBox($config, $cache);
$window = (int)($config['board_window_hours'] ?? 8);
$now    = time();

function put_json(string $file, $data): void
{
    @mkdir(dirname($file), 0775, true);
    file_put_contents($file, json_encode($data, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
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

$globalFlights = [];

foreach ($airports as $ap) {
    $icao = $ap['icao'] ?? '';
    if ($icao === '') continue;
    $iata = $ap['iata'] ?? '';
    $name = $ap['name'] ?? $icao;

    // An airport can opt out of boards (radar-only) to protect API quota.
    if (array_key_exists('boards', $ap) && $ap['boards'] === false) {
        put_json("$dataDir/$icao/board_departures.json", ['icao' => $icao, 'iata' => $iata,
            'airport' => $name, 'type' => 'departures', 'rows' => [], 'boardsDisabled' => true, 'fetchedAt' => $now]);
        put_json("$dataDir/$icao/board_arrivals.json", ['icao' => $icao, 'iata' => $iata,
            'airport' => $name, 'type' => 'arrivals', 'rows' => [], 'boardsDisabled' => true, 'fetchedAt' => $now]);
        echo "$icao: boards disabled (radar-only)\n";
        continue;
    }

    foreach (['departures', 'arrivals'] as $type) {
        try {
            $raw = $adb->airportBoard($icao, $type, $window);
            $items = $raw[$type] ?? ($raw['departures'] ?? ($raw['arrivals'] ?? []));
            $rows = [];
            foreach ((is_array($items) ? $items : []) as $item) {
                if (is_array($item)) $rows[] = normalize_board_item($item, $type);
            }
            usort($rows, fn($a, $b) => strcmp($a['time'], $b['time']));

            put_json("$dataDir/$icao/board_$type.json", [
                'icao' => $icao, 'iata' => $iata, 'airport' => $name, 'type' => $type,
                'rows' => $rows, 'fetchedAt' => $now, 'mock' => $isMock,
            ]);

            foreach ($rows as $row) {
                $num = preg_replace('/[^A-Z0-9]/', '', strtoupper($row['flight']));
                if ($num !== '') $globalFlights[$num] = synth_flight($row, $type, $iata, $name, $now);
            }
            echo "$icao $type: " . count($rows) . " flights\n";
        } catch (Throwable $e) {
            fwrite(STDERR, "$icao $type ERROR: " . $e->getMessage() . "\n");
        }
    }
}

foreach ($globalFlights as $num => $rec) {
    put_json("$flightsDir/$num.json", $rec);
}

echo "export complete: " . count($airports) . " airports, " . count($globalFlights) . " flights\n";
