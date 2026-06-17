<?php
/**
 * Cache.php — atomic JSON cache read/write plus monthly API-unit accounting.
 *
 * All cache files live in $config['cache_dir'] (private/cache by default).
 * Writes are atomic (temp file + rename) so a reader never sees a half file.
 */

class Cache
{
    private string $dir;

    public function __construct(string $dir)
    {
        $this->dir = rtrim($dir, '/');
        if (!is_dir($this->dir)) {
            @mkdir($this->dir, 0775, true);
        }
    }

    private function path(string $key): string
    {
        // Keep keys filesystem-safe.
        $safe = preg_replace('/[^A-Za-z0-9_.-]/', '_', $key);
        return $this->dir . '/' . $safe . '.json';
    }

    /** Read a cache entry. Returns null if missing/corrupt. */
    public function read(string $key): ?array
    {
        $file = $this->path($key);
        if (!is_file($file)) {
            return null;
        }
        $raw = @file_get_contents($file);
        if ($raw === false) {
            return null;
        }
        $data = json_decode($raw, true);
        return is_array($data) ? $data : null;
    }

    /**
     * Write a cache entry, wrapping the payload with metadata:
     *   { fetchedAt: <unix>, payload: <data> }
     */
    public function write(string $key, $payload): bool
    {
        $envelope = [
            'fetchedAt' => time(),
            'payload'   => $payload,
        ];
        return $this->writeRaw($key, $envelope);
    }

    /** Write an arbitrary array verbatim (used for tokens, usage counters). */
    public function writeRaw(string $key, array $data): bool
    {
        $file = $this->path($key);
        $tmp  = $file . '.' . getmypid() . '.tmp';
        $json = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($json === false) {
            return false;
        }
        if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
            return false;
        }
        return @rename($tmp, $file);
    }

    /** Age in seconds of a cache entry, or null if missing. */
    public function ageSeconds(string $key): ?int
    {
        $data = $this->read($key);
        if ($data === null || !isset($data['fetchedAt'])) {
            return null;
        }
        return time() - (int)$data['fetchedAt'];
    }

    // ---- Monthly API-unit accounting (per provider) ----

    private function usageKey(): string
    {
        return 'api_usage_' . date('Y-m');   // resets each calendar month
    }

    /** Units consumed so far this month for a provider. */
    public function unitsUsed(string $provider): int
    {
        $u = $this->read($this->usageKey());
        $payload = $u['payload'] ?? [];
        return (int)($payload[$provider] ?? 0);
    }

    /** Add to a provider's monthly unit total. */
    public function addUnits(string $provider, int $units): void
    {
        $key = $this->usageKey();
        $u = $this->read($key);
        $payload = $u['payload'] ?? [];
        $payload[$provider] = (int)($payload[$provider] ?? 0) + $units;
        $this->write($key, $payload);
    }
}
