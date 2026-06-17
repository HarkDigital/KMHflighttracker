<?php
/**
 * AeroDataBox.php — thin cURL client for the AeroDataBox API (via RapidAPI),
 * with monthly unit accounting and a hard-stop when the budget is exhausted.
 *
 * The browser never touches this class — only the cron prefetch scripts do.
 */

class AeroDataBoxException extends RuntimeException {}

class AeroDataBox
{
    public const PROVIDER = 'aerodatabox';

    private string $key;
    private string $host;
    private Cache $cache;
    private int $budget;
    private bool $mock;
    private string $mockDir;

    public function __construct(array $config, Cache $cache)
    {
        $this->key     = $config['rapidapi_key'] ?? '';
        $this->host    = $config['rapidapi_host'] ?? 'aerodatabox.p.rapidapi.com';
        $this->cache   = $cache;
        $this->budget  = (int)($config['monthly_unit_budget'] ?? 600);
        $this->mock    = !empty($config['mock']) || getenv('MOCK') === '1';
        $this->mockDir = __DIR__ . '/../mock';
    }

    /** Units remaining in this month's budget. */
    public function unitsRemaining(): int
    {
        return max(0, $this->budget - $this->cache->unitsUsed(self::PROVIDER));
    }

    /**
     * Airport departures or arrivals (FIDS). This is the expensive call.
     * $type is 'departures' or 'arrivals'.
     */
    public function airportBoard(string $icao, string $type, int $windowHours): array
    {
        $from = gmdate('Y-m-d\TH:i', time());
        $to   = gmdate('Y-m-d\TH:i', time() + $windowHours * 3600);
        $dir  = $type === 'arrivals' ? 'Arrival' : 'Departure';

        $path = sprintf(
            '/flights/airports/icao/%s/%s/%s',
            rawurlencode($icao),
            rawurlencode($from),
            rawurlencode($to)
        );
        $query = http_build_query([
            'direction'             => $dir,
            'withLeg'               => 'true',
            'withCancelled'         => 'true',
            'withCodeshared'        => 'false',
            'withCargo'             => 'false',
            'withPrivate'           => 'false',
            'withLocation'          => 'false',
        ]);

        // FIDS is a multi-result endpoint; treat as a higher-cost tier.
        return $this->get($path . '?' . $query, 'fids', /*units*/ 1);
    }

    /** Flight status/route by flight number (e.g. "AA123"). */
    public function flightByNumber(string $number): array
    {
        $path = '/flights/number/' . rawurlencode($number);
        return $this->get($path . '?withAircraftImage=false&withLocation=false', 'flight_' . $number, 1);
    }

    /** Aircraft details (model/type) by registration/tail number. */
    public function aircraftByReg(string $reg): array
    {
        $path = '/aircrafts/reg/' . rawurlencode($reg);
        return $this->get($path, 'aircraft_' . $reg, 1);
    }

    /**
     * Core GET with budget enforcement and mock support.
     * @param string $mockName base filename (without .json) under cron/mock/
     */
    private function get(string $path, string $mockName, int $units): array
    {
        if ($this->mock) {
            return $this->loadMock($mockName);
        }

        if ($this->unitsRemaining() < $units) {
            throw new AeroDataBoxException('Monthly AeroDataBox unit budget exhausted');
        }
        if ($this->key === '' || $this->key === 'YOUR_RAPIDAPI_KEY_HERE') {
            throw new AeroDataBoxException('AeroDataBox API key not configured');
        }

        $url = 'https://' . $this->host . $path;
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_HTTPHEADER     => [
                'X-RapidAPI-Key: ' . $this->key,
                'X-RapidAPI-Host: ' . $this->host,
                'Accept: application/json',
            ],
        ]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);

        // Count the unit regardless of success — RapidAPI bills attempts.
        $this->cache->addUnits(self::PROVIDER, $units);

        if ($body === false) {
            throw new AeroDataBoxException('cURL error: ' . $err);
        }
        if ($code === 204 || $body === '') {
            return [];   // no flights in window — valid empty result
        }
        if ($code < 200 || $code >= 300) {
            throw new AeroDataBoxException("AeroDataBox HTTP $code");
        }
        $data = json_decode($body, true);
        if (!is_array($data)) {
            throw new AeroDataBoxException('Invalid JSON from AeroDataBox');
        }
        return $data;
    }

    private function loadMock(string $name): array
    {
        // Map specific mock names to generic fixtures where useful.
        $candidates = [$name, preg_replace('/_.*$/', '', $name)];
        foreach ($candidates as $c) {
            $file = $this->mockDir . '/' . preg_replace('/[^A-Za-z0-9_]/', '_', $c) . '.json';
            if (is_file($file)) {
                $data = json_decode((string)file_get_contents($file), true);
                if (is_array($data)) {
                    return $data;
                }
            }
        }
        return [];
    }
}
