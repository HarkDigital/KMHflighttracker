# Split-Flap Flight Tracker

A retro **split-flap ("Solari board")** multi-airport flight tracker with a live
**radar**, designed to install as a **PWA** on an iPad. It runs as pure static
files (e.g. GitHub Pages) and also on **IONOS shared hosting**.

![board](docs/board.png)

## Features

- **Board** — live arrivals/departures near the selected airport on an animated flip-tile board.
- **Track** — look up a flight by callsign (route + live status + aircraft type).
- **Tracked** — ★ flights you care about; they persist on the device.
- **Map** — FlightRadar24-style live radar that follows the selected airport.
- **Airport picker** — switch airports (board + radar) from the header; editable list in `public/airports.json`.
- Installable PWA with an offline app shell.

## How it works

Everything is built **client-side from free, keyless feeds** — no API key, no
account, no trial:

- **ADS-B positions** — [adsb.lol](https://api.adsb.lol/docs) (primary) /
  [airplanes.live](https://airplanes.live/api-guide/) (fallback). Powers the radar
  and the live board (aircraft near the airport, classified as arriving/departing).
- **Routes & aircraft type** — [adsbdb.com](https://github.com/mrjackwills/adsbdb)
  (callsign → origin/destination; registration → type). Keyless, cached on-device.

```
iPad PWA  ──fetch──►  adsb.lol / airplanes.live   (live positions)
          ──fetch──►  adsbdb.com                  (routes + aircraft)
```

The PHP backend (`public/api/*.php`, `cron/`) is **optional** and used only if you
later add an OpenSky-account–backed board on IONOS for richer scheduled-style data.

## Local development

```bash
cp private/config.sample.php private/config.php
# set 'mock' => true in private/config.php to use bundled sample data
php cron/prefetch_board.php      # generate cache (mock mode = no API calls)
php cron/prefetch_states.php
php -S localhost:8000 -t public  # open http://localhost:8000
```

Run `php build/generate-icons.php` to (re)generate the PWA icons.

## Deploy to IONOS shared hosting

1. **Upload** the repo. In the IONOS panel, set the domain's **document root to the
   `public/` folder** so `private/` can't be reached by URL. (If you can't change the
   doc root, the included `.htaccess` files deny `private/` as a fallback.)
2. **Configure**: copy `private/config.sample.php` → `private/config.php` and fill in:
   - `rapidapi_key` (AeroDataBox on RapidAPI)
   - `opensky_client_id` / `opensky_client_secret` (optional; blank = anonymous)
   - Set `'mock' => false`.
3. **Cron jobs** (IONOS Cron Manager, PHP CLI). Each run finishes in well under the
   60-second IONOS limit:
   ```
   */60 5-23 * * *   php /path/to/cron/prefetch_board.php     # board (operating hours)
   0    */2  * * *   php /path/to/cron/prefetch_flights.php    # starred/tracked flights
   */2  *    * * *   php /path/to/cron/prefetch_states.php      # live map
   ```
4. **Verify**:
   - `https://yourdomain/api/health.php` → cache ages + remaining unit budget.
   - `https://yourdomain/private/config.php` → must return 403/404.
5. **Install on the iPad**: open the site in Safari → Share → **Add to Home Screen**.

### Staying within the free quota
`board_refresh_min` and friends live in `private/config.php`. The dominant cost is the
board (FIDS). After deploy, watch the RapidAPI dashboard for a week and tune the board
cron cadence to land under ~600 units/month. A ~$5–9/mo AeroDataBox tier removes the
limit with no code changes. The client (`AeroDataBox.php`) also hard-stops and serves
stale cache once the monthly budget is reached.

## Airports (multi-airport)
The selectable airports live in **`public/airports.json`** — edit that list to add or
remove airports (each needs `icao`, `iata`, `name`, `lat`, `lon`). The header dropdown is
built from it, the build generates a board per airport, and the radar centres on whichever
is selected (the choice is remembered per device).

- The **radar** is client-side, so it can centre on any airport at no API cost.
- The **boards** use AeroDataBox. In mock mode (no key) all airports show sample data with a
  "SAMPLE DATA" badge. With a real key, **each airport costs ~2 calls per refresh** — keep the
  list short or raise the cron/Actions interval to stay under the free ~600 units/month.
- To make an airport **radar-only** (no board, no API cost), add `"boards": false` to its
  entry in `airports.json`.

## Project layout
```
public/    static PWA + read-only PHP API (this is the web root)
private/   secrets (config.php) + JSON cache  — NEVER web-served
cron/      prefetch scripts + API client libs + mock fixtures
build/     optional build-time tooling (icon generation)
```
