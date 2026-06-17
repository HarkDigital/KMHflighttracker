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
    'cache_ttl'        => 900,   // seconds (15 min) — protects the monthly unit quota
];
