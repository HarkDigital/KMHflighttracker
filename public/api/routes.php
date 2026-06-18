<?php
/**
 * routes.php — cached route resolver for the board.
 *
 *   POST { "planes": [ { "callsign":"DAL2092", "lat":..., "lng":... }, ... ],
 *          "fast": true }
 *   ->   { "map": { "DAL2092": { origin:{…}, destination:{…}, approx:false } | null, … } }
 *
 * Resolves each callsign's route via adsb.lol's batched routeset (position-aware)
 * and, unless "fast", falls back to adsbdb.com for the stragglers. Every route is
 * cached per-callsign on disk for hours (routes are stable across the day) and
 * SHARED across all devices — so after the first lookup the whole board resolves
 * from cache instantly. Airport objects match the browser's shape
 * ({ iata, icao, name, city, lat, lon }).
 */
require __DIR__ . '/_feed.php';
header('Cache-Control: no-store');

function ap_rs($o) {                              // adsb.lol routeset airport
    if (!is_array($o)) return null;
    return [
        'iata' => $o['iata'] ?? '', 'icao' => $o['icao'] ?? '',
        'name' => $o['name'] ?? '', 'city' => $o['location'] ?? ($o['name'] ?? ''),
        'lat'  => $o['lat'] ?? ($o['latitude'] ?? null),
        'lon'  => $o['lon'] ?? ($o['longitude'] ?? null),
    ];
}
function ap_db($o) {                              // adsbdb.com airport
    if (!is_array($o)) return null;
    return [
        'iata' => $o['iata_code'] ?? '', 'icao' => $o['icao_code'] ?? '',
        'name' => $o['name'] ?? '', 'city' => $o['municipality'] ?? '',
        'lat'  => $o['latitude'] ?? null, 'lon' => $o['longitude'] ?? null,
    ];
}

$ROUTE_TTL = 6 * 3600;
$dir = feed_cache_dir();
feed_cache_sweep($dir, 'rt_');

$body  = json_decode(file_get_contents('php://input'), true);
$plist = (is_array($body) && is_array($body['planes'] ?? null)) ? $body['planes'] : [];
$fast  = !empty($body['fast']);

$map = [];
$need = [];
foreach ($plist as $p) {
    $cs = strtoupper(trim($p['callsign'] ?? ''));
    if ($cs === '' || isset($map[$cs]) || isset($need[$cs])) continue;
    $f = $dir . '/rt_' . $cs . '.json';
    $hit = feed_cache_get($f, $ROUTE_TTL);
    if ($hit !== null) { $map[$cs] = $hit['v']; }      // may be a cached null (unknown)
    else $need[$cs] = ['callsign' => $cs, 'lat' => $p['lat'] ?? null, 'lng' => $p['lng'] ?? null];
}

if ($need) {
    // 1) Batched routeset — one request for everything we don't have cached.
    $raw = feed_post_json('https://api.adsb.lol/api/0/routeset',
        json_encode(['planes' => array_values($need)]), 8);
    $byCs = [];
    if ($raw) {
        $arr = json_decode($raw, true);
        if (is_array($arr)) foreach ($arr as $r) {
            if (!isset($r['callsign'])) continue;
            $aps = $r['_airports'] ?? null;
            $byCs[strtoupper($r['callsign'])] =
                (!empty($r['plausible']) && is_array($aps) && count($aps) >= 2)
                ? ['origin' => ap_rs($aps[0]), 'destination' => ap_rs($aps[count($aps) - 1]), 'approx' => false]
                : null;
        }
    }
    $straggler = [];
    foreach ($need as $cs => $_) {
        if (!empty($byCs[$cs])) {
            $map[$cs] = $byCs[$cs];
            feed_cache_put($dir . '/rt_' . $cs . '.json', ['v' => $byCs[$cs]]);
        } else {
            $straggler[] = $cs;
        }
    }

    // 2) adsbdb fallback for what routeset didn't know (skipped in fast mode).
    //    We cache a confirmed result — a route OR a definite "no route" (null) —
    //    so we stop re-querying known-unknown (military/GA) callsigns. But if the
    //    upstream is simply unreachable, we OMIT the callsign (don't cache, don't
    //    return it) so a transient blip can't hide a real route for hours; the
    //    client just retries it next pass.
    if (!$fast) {
        foreach (array_slice($straggler, 0, 40) as $cs) {
            $raw2 = feed_get('https://api.adsbdb.com/v0/callsign/' . rawurlencode($cs), 6);
            if ($raw2 === null) continue;              // upstream down -> omit, retry later
            $r = null;
            $j = json_decode($raw2, true);
            $fr = is_array($j) ? ($j['response']['flightroute'] ?? null) : null;
            if ($fr) $r = ['origin' => ap_db($fr['origin'] ?? null),
                           'destination' => ap_db($fr['destination'] ?? null), 'approx' => true];
            $map[$cs] = $r;                            // confirmed (route or genuine null)
            feed_cache_put($dir . '/rt_' . $cs . '.json', ['v' => $r]);
        }
        // Callsigns beyond the cap are left out (uncached) for a later request.
    }
    // In fast mode, stragglers are simply left out of the map (uncached), so the
    // client's background pass can resolve them.
}

feed_json(['map' => $map, 'fetchedAt' => time()]);
