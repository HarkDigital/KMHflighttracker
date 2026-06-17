<?php
/**
 * PHL Split-Flap Flight Tracker — configuration template.
 *
 * Copy this file to `config.php` and fill in your real secrets.
 * `config.php` is gitignored and must NEVER be committed or served to the browser.
 *
 * On IONOS, set the domain's document root to the `public/` folder so this
 * `private/` directory cannot be reached by URL. (Fallback: an .htaccess
 * "Require all denied" inside private/.)
 */

return [
    // ---- Airport the board tracks ----
    'airport_icao' => 'KPHL',                 // Philadelphia International
    'airport_iata' => 'PHL',
    'airport_name' => 'PHILADELPHIA',         // shown on the board header

    // ---- AeroDataBox via RapidAPI ----
    'rapidapi_key'  => 'YOUR_RAPIDAPI_KEY_HERE',
    'rapidapi_host' => 'aerodatabox.p.rapidapi.com',

    // ---- OpenSky Network (live map) — OAuth2 client credentials ----
    // Create an API client at https://opensky-network.org/ -> Account.
    // Leave blank to use anonymous access (reduced rate limits).
    'opensky_client_id'     => '',
    'opensky_client_secret' => '',

    // Bounding box around PHL for the live map (lat/lon).
    'bbox' => [
        'lamin' => 39.4,
        'lomin' => -75.9,
        'lamax' => 40.3,
        'lomax' => -74.6,
    ],

    // ---- Cache + quota ----
    'cache_dir'           => __DIR__ . '/cache',
    'monthly_unit_budget' => 600,   // AeroDataBox free-tier units/month

    // ---- Refresh cadence (minutes) — tune to stay under the budget ----
    'board_window_hours'  => 8,     // how far ahead the FIDS board looks
    'board_stale_min'     => 75,    // board cache older than this is flagged "stale"
    'flight_stale_min'    => 180,   // tracked-flight cache staleness threshold
    'states_stale_min'    => 5,     // OpenSky positions staleness threshold

    // ---- Watchlist (starred flights the cron keeps fresh) ----
    'watchlist_max'        => 15,   // cap to protect the API budget
    'watchlist_ttl_hours'  => 48,   // drop a watched flight after this long

    // ---- Admin / debug ----
    'health_token' => '',           // optional ?token= guard for api/health.php

    // ---- Dev ----
    // Set true (or define MOCK=1 env) to serve bundled sample JSON instead of
    // calling the real APIs, so the UI can be built without spending units.
    'mock' => false,
];
