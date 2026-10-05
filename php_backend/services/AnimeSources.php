<?php
require_once __DIR__ . '/../config.php';

/**
 * Anime-specific metadata sources, all free and keyless:
 * - AniList (GraphQL): the franchise as MyAnimeList sees it — one entry per season/cour, each with
 *   its own banner, cover, air dates and MAL id.
 * - ani.zip: TMDB id -> AniList/MAL id of the show's first entry.
 * - AniSkip: community opening/ending timestamps per MAL id + episode.
 * Every call fails soft (null/[]) so a server without internet keeps working.
 */
class AnimeSources {
    private const ANILIST_URL = 'https://graphql.anilist.co';
    private const USER_AGENT = 'KuraStream/2 (self-hosted media server)';
    /** Formats that make up the main watch order (movies, OVAs and specials are side stories). */
    private const SERIES_FORMATS = ['TV', 'TV_SHORT', 'ONA'];

    private const MEDIA_FIELDS = 'id idMal format type status episodes
        title { romaji english }
        startDate { year month day } endDate { year month day }
        bannerImage coverImage { extraLarge large }';

    /** Set to false after the first unreachable request so a batch does not wait on every timeout. */
    private static bool $online = true;
    private static float $lastAniListCall = 0.0;

    public static function isOnline(): bool {
        return self::$online;
    }

    public static function resetOnline(): void {
        self::$online = true;
    }

    private static function request(string $url, ?array $jsonBody = null, int $timeout = 10): ?array {
        if (!self::$online) return null;
        $headers = ['Accept: application/json', 'User-Agent: ' . self::USER_AGENT];
        $opts = [
            CURLOPT_URL => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ];
        if ($jsonBody !== null) {
            $headers[] = 'Content-Type: application/json';
            $opts[CURLOPT_POST] = true;
            $opts[CURLOPT_POSTFIELDS] = json_encode($jsonBody);
        }
        $opts[CURLOPT_HTTPHEADER] = $headers;
        if (defined('CURLSSLOPT_NATIVE_CA')) $opts[CURLOPT_SSL_OPTIONS] = CURLSSLOPT_NATIVE_CA;

        for ($attempt = 0; $attempt < 3; $attempt++) {
            $ch = curl_init();
            if ($ch === false) return null;
            $responseHeaders = [];
            curl_setopt_array($ch, $opts);
            curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($ch, $line) use (&$responseHeaders) {
                $parts = explode(':', $line, 2);
                if (count($parts) === 2) $responseHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
                return strlen($line);
            });
            $raw = curl_exec($ch);
            $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $errno = curl_errno($ch);
            curl_close($ch);

            if ($raw === false || $status === 0) {
                // DNS/connect failure: the server is offline, stop trying for this run.
                if (in_array($errno, [CURLE_COULDNT_RESOLVE_HOST, CURLE_COULDNT_CONNECT, CURLE_OPERATION_TIMEDOUT], true)) {
                    self::$online = false;
                }
                return null;
            }
            if ($status === 429) {
                $wait = (int)($responseHeaders['retry-after'] ?? 5);
                sleep(max(1, min(65, $wait)));
                continue;
            }
            if ($status >= 500) {
                usleep(500000);
                continue;
            }
            $data = json_decode((string)$raw, true);
            // AniSkip answers "not found" with a 404 JSON body, which is a valid answer.
            return is_array($data) ? $data : null;
        }
        return null;
    }

    private static function aniList(string $query, array $variables): ?array {
        // AniList allows ~30 requests/minute; keep well under it during batch syncs.
        $since = microtime(true) - self::$lastAniListCall;
        if ($since < 0.7) usleep((int)((0.7 - $since) * 1000000));
        self::$lastAniListCall = microtime(true);
        $res = self::request(self::ANILIST_URL, ['query' => $query, 'variables' => $variables]);
        return $res['data'] ?? null;
    }

    /** One AniList entry with its anime relations (prequels, sequels, side stories). */
    public static function aniListMedia(int $id): ?array {
        $fields = self::MEDIA_FIELDS;
        $query = "query (\$id: Int) { Media(id: \$id, type: ANIME) { {$fields}
            relations { edges { relationType node { id type format startDate { year month day } } } } } }";
        $data = self::aniList($query, ['id' => $id]);
        return $data['Media'] ?? null;
    }

    /** AniList id of a TMDB show's first entry: ani.zip mapping, then a title search. */
    public static function findAniListId(int $tmdbId, string $title, ?int $year): ?int {
        if ($tmdbId > 0) {
            $map = self::request('https://api.ani.zip/mappings?themoviedb_id=' . $tmdbId, null, 8);
            $id = (int)($map['mappings']['anilist_id'] ?? 0);
            if ($id > 0) return $id;
        }
        if (trim($title) === '') return null;
        $query = 'query ($q: String) { Page(perPage: 10) { media(search: $q, type: ANIME, sort: SEARCH_MATCH) {
            id format startDate { year } } } }';
        $data = self::aniList($query, ['q' => $title]);
        $candidates = $data['Page']['media'] ?? [];
        $series = array_values(array_filter($candidates, fn($m) => in_array($m['format'] ?? '', self::SERIES_FORMATS, true)));
        if ($year) {
            foreach ($series as $m) {
                if (abs((int)($m['startDate']['year'] ?? 0) - $year) <= 1) return (int)$m['id'];
            }
        }
        return isset($series[0]) ? (int)$series[0]['id'] : null;
    }

    /**
     * The main series of a franchise in watch order: walks prequels back to the first TV entry,
     * then sequels forward. OVAs, specials and movies between two seasons (NEW GAME! -> OVA ->
     * NEW GAME!!) are walked through but left out. Each item is an AniList media without relations.
     */
    public static function franchise(int $startId, int $maxEntries = 16): array {
        $cache = [];
        $media = self::cachedMedia($startId, $cache);
        if (!$media) return [];

        // Back to the beginning.
        $first = $media;
        $seen = [$first['id'] => true];
        while (count($seen) < $maxEntries * 2) {
            $prev = self::stepSeries($first, 'PREQUEL', $cache, $seen);
            if ($prev === null) break;
            $first = $prev;
        }

        $chain = [$first];
        $seen = [$first['id'] => true];
        $current = $first;
        while (count($chain) < $maxEntries) {
            $next = self::stepSeries($current, 'SEQUEL', $cache, $seen);
            if ($next === null) break;
            $chain[] = $next;
            $current = $next;
        }
        return array_map(function ($m) {
            unset($m['relations']);
            return $m;
        }, $chain);
    }

    private static function cachedMedia(int $id, array &$cache): ?array {
        if (!array_key_exists($id, $cache)) $cache[$id] = self::aniListMedia($id);
        return $cache[$id];
    }

    /**
     * Next (or previous) series entry from $media, going through at most two non-series entries
     * (OVA, special, movie) when the series one is not linked directly. Marks visited ids in $seen.
     */
    private static function stepSeries(array $media, string $relation, array &$cache, array &$seen): ?array {
        $frontier = [$media];
        for ($hop = 0; $hop < 3 && !empty($frontier); $hop++) {
            $nextFrontier = [];
            foreach ($frontier as $m) {
                $id = self::relatedSeries($m, $relation);
                if ($id !== null && !isset($seen[$id])) {
                    $found = self::cachedMedia($id, $cache);
                    if ($found) {
                        $seen[$id] = true;
                        return $found;
                    }
                }
                if ($hop === 2) continue;
                foreach (self::relatedOther($m, $relation) as $otherId) {
                    if (isset($seen[$otherId])) continue;
                    $seen[$otherId] = true;
                    $other = self::cachedMedia($otherId, $cache);
                    if ($other) $nextFrontier[] = $other;
                }
            }
            $frontier = $nextFrontier;
        }
        return null;
    }

    private static function relatedSeries(array $media, string $relation): ?int {
        $best = null;
        foreach ($media['relations']['edges'] ?? [] as $edge) {
            $node = $edge['node'] ?? [];
            if (($edge['relationType'] ?? '') !== $relation || ($node['type'] ?? '') !== 'ANIME') continue;
            if (!in_array($node['format'] ?? '', self::SERIES_FORMATS, true)) continue;
            // Several sequels (e.g. a TV season and a short): keep the earliest one.
            if ($best === null || self::dateKey($node['startDate'] ?? []) < self::dateKey($best['startDate'] ?? [])) {
                $best = $node;
            }
        }
        return $best ? (int)$best['id'] : null;
    }

    /** Non-series anime linked by $relation, earliest first (at most two, to bound requests). */
    private static function relatedOther(array $media, string $relation): array {
        $nodes = [];
        foreach ($media['relations']['edges'] ?? [] as $edge) {
            $node = $edge['node'] ?? [];
            if (($edge['relationType'] ?? '') !== $relation || ($node['type'] ?? '') !== 'ANIME') continue;
            if (in_array($node['format'] ?? '', self::SERIES_FORMATS, true)) continue;
            $nodes[] = $node;
        }
        usort($nodes, fn($a, $b) => strcmp(self::dateKey($a['startDate'] ?? []), self::dateKey($b['startDate'] ?? [])));
        if ($relation === 'PREQUEL') $nodes = array_reverse($nodes);
        return array_map(fn($n) => (int)$n['id'], array_slice($nodes, 0, 2));
    }

    /** "YYYY-MM-DD" (missing parts become the latest possible value) for comparisons. */
    public static function dateKey(array $date): string {
        $y = (int)($date['year'] ?? 0);
        if ($y <= 0) return '9999-12-31';
        return sprintf('%04d-%02d-%02d', $y, (int)($date['month'] ?? 0) ?: 12, (int)($date['day'] ?? 0) ?: 28);
    }

    /**
     * Opening/ending of one episode from AniSkip. Only submissions for a video of about the same
     * length are accepted (AniSkip filters them), so a release with a different cut gets nothing
     * rather than a wrong skip. Returns ['op' => [start, end]|null, 'ed' => [start, end]|null] or
     * null when AniSkip could not be reached.
     */
    public static function skipTimes(int $malId, int $episode, float $duration): ?array {
        if ($malId <= 0 || $episode <= 0 || $duration <= 0) return ['op' => null, 'ed' => null];
        $url = sprintf(
            'https://api.aniskip.com/v2/skip-times/%d/%d?types%%5B%%5D=op&types%%5B%%5D=ed&episodeLength=%d',
            $malId, $episode, (int)round($duration)
        );
        $res = self::request($url, null, 10);
        if ($res === null) return null;
        $out = ['op' => null, 'ed' => null];
        foreach ($res['results'] ?? [] as $r) {
            $type = $r['skipType'] ?? '';
            if (!array_key_exists($type, $out) || $out[$type] !== null) continue;
            $start = (float)($r['interval']['startTime'] ?? -1);
            $end = (float)($r['interval']['endTime'] ?? -1);
            if ($start < 0 || $end <= $start || $start >= $duration) continue;
            $out[$type] = [$start, min($end, $duration)];
        }
        return $out;
    }
}
