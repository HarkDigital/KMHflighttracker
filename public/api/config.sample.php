<?php
/**
 * AeroDataBox backend config.
 *
 * On IONOS this file is GENERATED at deploy time from the AERODATABOX_KEY
 * GitHub secret (see .github/workflows/ionos-sftp.yml) — never committed.
 * Copy to config.php for local testing.
 */
return [
    'aerodatabox_key'  => 'YOUR_RAPIDAPI_KEY',
    'aerodatabox_host' => 'aerodatabox.p.rapidapi.com',
    'cache_ttl'        => 300,   // seconds (5 min) — fresh; repeat views are free
    // Free Basic plan = 600 units/mo; flight-by-number = ~2 units each. We hard-
    // stop (serving the last cached copy) once a month's usage would exceed this,
    // so a fresh cache can never blow the quota.
    'monthly_unit_budget' => 540,
    'unit_cost'           => 2,
];
