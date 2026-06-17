<?php
/**
 * OpenSky.php — cURL client for the OpenSky Network REST API (live aircraft
 * positions for the map). Handles the OAuth2 client-credentials flow and
 * caches the bearer token (30-min expiry) so we don't re-auth every call.
 *
 * If no client credentials are configured, falls back to anonymous access
 * (reduced rate limits, but still works for a low-traffic hobby site).
 */

class OpenSkyException extends RuntimeException {}

class OpenSky
{
    private const TOKEN_URL =
        'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
    private const API_BASE = 'https://opensky-network.org/api';

    private string $clientId;
    private string $clientSecret;
    private Cache $cache;
    private bool $mock;
    private string $mockDir;

    public function __construct(array $config, Cache $cache)
    {
        $this->clientId     = $config['opensky_client_id'] ?? '';
        $this->clientSecret = $config['opensky_client_secret'] ?? '';
        $this->cache        = $cache;
        $this->mock         = !empty($config['mock']) || getenv('MOCK') === '1';
        $this->mockDir      = __DIR__ . '/../mock';
    }

    /**
     * Aircraft state vectors within a bounding box.
     * Returns the raw OpenSky response: { time, states: [ [...], ... ] }.
     */
    public function statesInBbox(array $bbox): array
    {
        if ($this->mock) {
            $file = $this->mockDir . '/states.json';
            $data = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
            return is_array($data) ? $data : ['time' => time(), 'states' => []];
        }

        $query = http_build_query([
            'lamin' => $bbox['lamin'],
            'lomin' => $bbox['lomin'],
            'lamax' => $bbox['lamax'],
            'lomax' => $bbox['lomax'],
        ]);
        $headers = ['Accept: application/json'];
        $token = $this->token();
        if ($token !== null) {
            $headers[] = 'Authorization: Bearer ' . $token;
        }

        $ch = curl_init(self::API_BASE . '/states/all?' . $query);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_HTTPHEADER     => $headers,
        ]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);

        if ($body === false) {
            throw new OpenSkyException('cURL error: ' . $err);
        }
        if ($code === 429) {
            throw new OpenSkyException('OpenSky rate limit hit (HTTP 429)');
        }
        if ($code < 200 || $code >= 300) {
            throw new OpenSkyException("OpenSky HTTP $code");
        }
        $data = json_decode($body, true);
        if (!is_array($data)) {
            throw new OpenSkyException('Invalid JSON from OpenSky');
        }
        return $data;
    }

    /** Get a valid bearer token (cached), or null for anonymous access. */
    private function token(): ?string
    {
        if ($this->clientId === '' || $this->clientSecret === '') {
            return null;   // anonymous
        }

        $cached = $this->cache->read('opensky_token');
        $payload = $cached['payload'] ?? null;
        if (is_array($payload)
            && !empty($payload['access_token'])
            && ($payload['expires_at'] ?? 0) > time() + 60) {
            return $payload['access_token'];
        }

        // Request a fresh token.
        $ch = curl_init(self::TOKEN_URL);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_POSTFIELDS     => http_build_query([
                'grant_type'    => 'client_credentials',
                'client_id'     => $this->clientId,
                'client_secret' => $this->clientSecret,
            ]),
            CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
        ]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($body === false || $code < 200 || $code >= 300) {
            // Auth failed — fall back to anonymous rather than breaking the map.
            return null;
        }
        $data = json_decode($body, true);
        if (!is_array($data) || empty($data['access_token'])) {
            return null;
        }
        $expiresIn = (int)($data['expires_in'] ?? 1800);
        $this->cache->write('opensky_token', [
            'access_token' => $data['access_token'],
            'expires_at'   => time() + $expiresIn,
        ]);
        return $data['access_token'];
    }
}
