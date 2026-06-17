<?php
/**
 * normalize.php — convert raw AeroDataBox responses into the compact row
 * shape the frontend split-flap board renders. Defensive against missing
 * fields (AeroDataBox omits keys when data is unavailable).
 */

/** Normalize one FIDS movement item into a board row. */
function normalize_board_item(array $item, string $type): array
{
    // For departures the "movement" describes the arrival airport (destination);
    // for arrivals it describes the departure airport (origin).
    $mv = $item['movement'] ?? [];
    $airport = $mv['airport'] ?? [];

    $sched = $mv['scheduledTime']['local'] ?? ($mv['scheduledTime']['utc'] ?? null);
    $est   = $mv['revisedTime']['local']   ?? ($mv['runwayTime']['local'] ?? null);

    return [
        'time'      => hm_from_iso($sched),
        'estimated' => hm_from_iso($est),
        'flight'    => strtoupper(trim($item['number'] ?? '')),
        'airline'   => $item['airline']['name'] ?? '',
        'place'     => strtoupper($airport['municipalityName'] ?? ($airport['shortName'] ?? ($airport['name'] ?? ''))),
        'placeIata' => strtoupper($airport['iata'] ?? ''),
        'gate'      => strtoupper(trim((string)($mv['gate'] ?? ''))),
        'terminal'  => strtoupper(trim((string)($mv['terminal'] ?? ''))),
        'status'    => board_status($item, $type),
        'reg'       => strtoupper(trim((string)($item['aircraft']['reg'] ?? ''))),
        'aircraft'  => strtoupper(trim((string)($item['aircraft']['model'] ?? ''))),
    ];
}

/** Map AeroDataBox statuses to short board words. */
function board_status(array $item, string $type): string
{
    $s = strtolower((string)($item['status'] ?? ''));
    $mv = $item['movement'] ?? [];
    $hasRevised = !empty($mv['revisedTime']);

    $map = [
        'expected'    => 'ON TIME',
        'enroute'     => 'EN ROUTE',
        'checkin'     => 'CHECK-IN',
        'boarding'    => 'BOARDING',
        'gateclosed'  => 'GATE CLOSED',
        'departed'    => 'DEPARTED',
        'delayed'     => 'DELAYED',
        'approaching' => 'APPROACHING',
        'arrived'     => 'LANDED',
        'landed'      => 'LANDED',
        'cancelled'   => 'CANCELLED',
        'canceled'    => 'CANCELLED',
        'diverted'    => 'DIVERTED',
        'unknown'     => '',
    ];
    if (isset($map[$s]) && $map[$s] !== '') {
        return $map[$s];
    }
    // Fall back: a revised time usually means a delay.
    if ($hasRevised) {
        return 'DELAYED';
    }
    return 'ON TIME';
}

/** Build the normalized "tracked flight" record from flight + aircraft data. */
function normalize_flight(array $flights, ?array $aircraft): ?array
{
    if (empty($flights)) {
        return null;
    }
    // AeroDataBox returns an array of matches; take the most recent/active.
    $f = $flights[0];
    foreach ($flights as $cand) {
        $st = strtolower((string)($cand['status'] ?? ''));
        if (in_array($st, ['enroute', 'boarding', 'expected', 'departed', 'approaching'], true)) {
            $f = $cand;
            break;
        }
    }

    $dep = $f['departure'] ?? [];
    $arr = $f['arrival'] ?? [];

    $reg   = strtoupper(trim((string)($f['aircraft']['reg'] ?? '')));
    $model = strtoupper(trim((string)($f['aircraft']['model'] ?? '')));
    if ($model === '' && $aircraft) {
        $model = strtoupper(trim((string)($aircraft['model'] ?? ($aircraft['typeName'] ?? ''))));
    }

    return [
        'flight'    => strtoupper(trim((string)($f['number'] ?? ''))),
        'airline'   => $f['airline']['name'] ?? '',
        'status'    => board_status($f, 'departures'),
        'reg'       => $reg,
        'aircraft'  => $model,
        'from'      => [
            'iata'  => strtoupper((string)($dep['airport']['iata'] ?? '')),
            'name'  => strtoupper((string)($dep['airport']['municipalityName'] ?? ($dep['airport']['name'] ?? ''))),
            'time'  => hm_from_iso($dep['scheduledTime']['local'] ?? null),
            'est'   => hm_from_iso($dep['revisedTime']['local'] ?? null),
            'gate'  => strtoupper((string)($dep['gate'] ?? '')),
            'terminal' => strtoupper((string)($dep['terminal'] ?? '')),
        ],
        'to'        => [
            'iata'  => strtoupper((string)($arr['airport']['iata'] ?? '')),
            'name'  => strtoupper((string)($arr['airport']['municipalityName'] ?? ($arr['airport']['name'] ?? ''))),
            'time'  => hm_from_iso($arr['scheduledTime']['local'] ?? null),
            'est'   => hm_from_iso($arr['revisedTime']['local'] ?? null),
            'gate'  => strtoupper((string)($arr['gate'] ?? '')),
            'terminal' => strtoupper((string)($arr['terminal'] ?? '')),
        ],
    ];
}

/** Extract "HH:MM" from an ISO-ish datetime string. */
function hm_from_iso(?string $iso): string
{
    if (!$iso) {
        return '';
    }
    // Examples: "2026-06-17 14:35-04:00", "2026-06-17T14:35:00Z"
    if (preg_match('/[T ](\d{2}:\d{2})/', $iso, $m)) {
        return $m[1];
    }
    return '';
}
