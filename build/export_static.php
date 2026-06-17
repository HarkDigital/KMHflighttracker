<?php
/**
 * export_static.php — intentionally a no-op.
 *
 * The board, radar and flight tracking are now built entirely client-side from
 * free, keyless feeds (ADS-B via adsb.lol/airplanes.live + routes via
 * adsbdb.com), so GitHub Pages needs no prebuilt data and no API key. The
 * deploy workflow still invokes this script; it simply has nothing to generate.
 *
 * (A future OpenSky-backed board for IONOS would add its own PHP cron; it does
 * not run here.)
 */

echo "No static data to export — board/radar/track are client-side & keyless.\n";
