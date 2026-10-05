<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';

/**
 * Weekly simulcast schedule: { Monday: [...], ..., Sunday: [...], TBA: [...] }.
 *
 * Only titles that are airing appear. With internet the week comes from AniList; offline it comes
 * from the library shows marked "airing" (placed on the weekday AniList last reported for them, or
 * under TBA). It never fills the week with finished library shows.
 */
class CalendarController {
    public const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    /** Airing library shows with no known weekday (offline and never seen in an AniList week). */
    public const UNSCHEDULED = 'TBA';

    private static int $ttl = 21600; // 6 hours
    /** A stale AniList week is still a better guess than nothing for this long. */
    private static int $staleTtl = 14 * 86400;
    private const ANILIST_MAX_PAGES = 4;

    // Kept out of the code tree so they can never be served or committed by accident.
    private static function cacheFile(): string {
        return sys_get_temp_dir() . '/kura_calendar_cache.json';
    }

    /** library show id => last weekday/time AniList reported for it (survives offline periods). */
    private static function slotsFile(): string {
        return sys_get_temp_dir() . '/kura_calendar_slots.json';
    }

    /** 0 (Sunday) .. 6 for a unix timestamp in the server's configured time zone. */
    public static function localWeekday(int $timestamp): int {
        // "@ts" DateTimes are always UTC; convert before reading the weekday.
        $date = (new DateTime('@' . $timestamp))->setTimezone(new DateTimeZone(date_default_timezone_get()));
        return (int)$date->format('w');
    }

    private static function dayName(int $timestamp): string {
        return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][self::localWeekday($timestamp)];
    }

    private static function emptyWeek(): array {
        $week = array_fill_keys(self::DAYS, []);
        $week[self::UNSCHEDULED] = [];
        return $week;
    }

    private static function countItems(array $week): int {
        $count = 0;
        foreach ($week as $items) $count += is_array($items) ? count($items) : 0;
        return $count;
    }

    private static function readJson(string $file): array {
        if (!is_file($file)) return [];
        return json_decode((string)@file_get_contents($file), true) ?: [];
    }

    public static function getSchedule(): void {
        $force = !empty($_GET['force']);
        $cacheFile = self::cacheFile();
        $cacheAge = is_file($cacheFile) ? time() - filemtime($cacheFile) : PHP_INT_MAX;

        if (!$force && $cacheAge < self::$ttl) {
            $cached = self::readJson($cacheFile);
            if (self::countItems($cached) > 0) {
                jsonResponse(self::finalize($cached));
                return;
            }
        }

        $week = self::fetchAniListWeek();
        if ($week !== null && self::countItems($week) > 0) {
            @file_put_contents($cacheFile, json_encode($week));
            $result = self::finalize($week);
            self::rememberLibrarySlots($result);
            jsonResponse($result);
            return;
        }

        // Offline: last AniList week while it is recent enough to still describe the season.
        if ($cacheAge < self::$staleTtl) {
            $cached = self::readJson($cacheFile);
            if (self::countItems($cached) > 0) {
                jsonResponse(self::finalize($cached));
                return;
            }
        }

        jsonResponse(self::finalize(self::libraryAiringWeek(DbHelper::getShows('anime'), self::readJson(self::slotsFile()))));
    }

    /** AniList airing schedules for the next 7 days (paginated); null when unreachable. */
    private static function fetchAniListWeek(): ?array {
        $now = time();
        $query = 'query ($start: Int, $end: Int, $page: Int) {
          Page(page: $page, perPage: 50) {
            pageInfo { hasNextPage }
            airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
              id airingAt timeUntilAiring episode
              media {
                id status isAdult title { romaji english native }
                coverImage { extraLarge large }
                genres studios(isMain: true) { nodes { name } }
              }
            }
          }
        }';

        $week = self::emptyWeek();
        $reached = false;
        for ($page = 1; $page <= self::ANILIST_MAX_PAGES; $page++) {
            $res = self::postJson('https://graphql.anilist.co', [
                'query' => $query,
                'variables' => ['start' => $now - 3600, 'end' => $now + 7 * 86400, 'page' => $page],
            ]);
            if ($res === null) break;
            $reached = true;
            $pageData = $res['data']['Page'] ?? [];
            foreach ($pageData['airingSchedules'] ?? [] as $item) {
                $media = $item['media'] ?? null;
                if (empty($media) || !empty($media['isAdult'])) continue;
                if (!in_array($media['status'] ?? 'RELEASING', ['RELEASING', 'NOT_YET_RELEASED'], true)) continue;
                $tObj = $media['title'] ?? [];
                $week[self::dayName((int)$item['airingAt'])][] = [
                    'schedule_id' => $item['id'],
                    'airing_at' => (int)$item['airingAt'],
                    'time_until' => (int)$item['timeUntilAiring'],
                    'episode' => $item['episode'] !== null ? (int)$item['episode'] : null,
                    'title' => $tObj['english'] ?? $tObj['romaji'] ?? $tObj['native'] ?? 'Anime',
                    'romaji_title' => $tObj['romaji'] ?? '',
                    'english_title' => $tObj['english'] ?? '',
                    'cover_image' => $media['coverImage']['extraLarge'] ?? $media['coverImage']['large'] ?? '',
                    'genres' => implode(', ', $media['genres'] ?? []),
                    'studio' => implode(', ', array_map(fn($s) => $s['name'], $media['studios']['nodes'] ?? [])),
                ];
            }
            if (empty($pageData['pageInfo']['hasNextPage'])) break;
        }
        return $reached ? $week : null;
    }

    private static function postJson(string $url, array $body): ?array {
        $opts = [
            CURLOPT_URL => $url,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($body),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT => 6,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ];
        if (defined('CURLSSLOPT_NATIVE_CA')) $opts[CURLOPT_SSL_OPTIONS] = CURLSSLOPT_NATIVE_CA;
        try {
            $ch = curl_init();
            if ($ch === false) return null;
            curl_setopt_array($ch, $opts);
            $raw = curl_exec($ch);
            $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
        } catch (Throwable $e) {
            return null;
        }
        if ($raw === false || $status !== 200) return null;
        $data = json_decode((string)$raw, true);
        return is_array($data) ? $data : null;
    }

    /**
     * Offline week from the library: shows with status "airing" only. A show AniList placed before
     * keeps that weekday/time (projected onto this week); the rest go under TBA.
     */
    public static function libraryAiringWeek(array $shows, array $slots, ?int $now = null): array {
        $now = $now ?? time();
        $week = self::emptyWeek();
        foreach ($shows as $show) {
            if (($show['status'] ?? '') !== 'airing') continue;
            $id = (string)$show['id'];
            $item = [
                'schedule_id' => 'local_' . $id,
                'airing_at' => null,
                'time_until' => null,
                'episode' => null,
                'title' => $show['title'],
                'romaji_title' => $show['title'],
                'english_title' => $show['title'],
                'cover_image' => $show['poster_path'] ?? '',
                'genres' => $show['genres'] ?? '',
                'studio' => $show['studio'] ?? '',
                'in_library' => true,
                'library_show_id' => $id,
                'local_show_id' => $id,
            ];
            $slot = $slots[$id] ?? null;
            if ($slot && !empty($slot['airing_at'])) {
                // Same weekday and time, moved to the upcoming occurrence.
                $at = (int)$slot['airing_at'];
                if ($at < $now - 86400) $at += (int)ceil(($now - 86400 - $at) / (7 * 86400)) * 7 * 86400;
                $item['airing_at'] = $at;
                $item['time_until'] = $at - $now;
                $week[self::dayName($at)][] = $item;
            } else {
                $week[self::UNSCHEDULED][] = $item;
            }
        }
        return $week;
    }

    private static function rememberLibrarySlots(array $week): void {
        $slots = self::readJson(self::slotsFile());
        foreach (self::DAYS as $day) {
            foreach ($week[$day] ?? [] as $item) {
                if (empty($item['library_show_id']) || empty($item['airing_at'])) continue;
                $slots[(string)$item['library_show_id']] = ['airing_at' => (int)$item['airing_at'], 'episode' => $item['episode'] ?? null];
            }
        }
        @file_put_contents(self::slotsFile(), json_encode($slots));
    }

    /** Library matches, every key present, each day sorted by time, library titles first on ties. */
    private static function finalize(array $week): array {
        $week = self::attachLibraryMatches($week);
        $result = self::emptyWeek();
        foreach ($week as $day => $items) {
            if (!array_key_exists($day, $result) || !is_array($items)) continue;
            usort($items, function ($a, $b) {
                return [(int)($a['airing_at'] ?? PHP_INT_MAX), empty($a['in_library']) ? 1 : 0, (string)$a['title']]
                    <=> [(int)($b['airing_at'] ?? PHP_INT_MAX), empty($b['in_library']) ? 1 : 0, (string)$b['title']];
            });
            $result[$day] = array_values($items);
        }
        return $result;
    }

    private static function normalizeTitle(string $title): string {
        $t = mb_strtolower($title);
        $t = preg_replace('/\b(season|temporada|part|parte|cour)\s*\d+\b/u', ' ', $t);
        $t = preg_replace('/\b\d+(st|nd|rd|th)\s+season\b/u', ' ', $t);
        $t = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $t);
        return trim(preg_replace('/\s+/', ' ', $t));
    }

    private static function attachLibraryMatches(array $scheduleData): array {
        $localShows = array_map(fn($s) => $s + ['_norm' => self::normalizeTitle((string)$s['title'])], DbHelper::getShows('anime'));
        $result = [];

        foreach ($scheduleData as $day => $items) {
            if (!is_array($items)) continue;
            $result[$day] = array_map(function ($item) use ($localShows) {
                if (!empty($item['library_show_id'])) {
                    $item['in_library'] = true;
                    $item['local_show_id'] = $item['library_show_id'];
                    return $item;
                }
                $candidates = array_filter(array_unique([
                    self::normalizeTitle((string)($item['title'] ?? '')),
                    self::normalizeTitle((string)($item['romaji_title'] ?? '')),
                    self::normalizeTitle((string)($item['english_title'] ?? '')),
                ]), fn($t) => mb_strlen($t) >= 3);

                $match = null;
                foreach ($localShows as $s) {
                    if ($s['_norm'] === '') continue;
                    foreach ($candidates as $c) {
                        if ($s['_norm'] === $c || str_contains($s['_norm'], $c) || (mb_strlen($s['_norm']) >= 5 && str_contains($c, $s['_norm']))) {
                            $match = $s;
                            break 2;
                        }
                    }
                }

                $item['in_library'] = $match !== null;
                $item['library_show_id'] = $match ? $match['id'] : null;
                $item['local_show_id'] = $item['library_show_id'];
                return $item;
            }, $items);
        }

        return $result;
    }
}
