<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';

class CalendarController {
    private static string $cacheFile = ROOT_DIR . '/php_backend/cache_calendar.json';
    private static int $ttl = 21600; // 6 hours

    public static function getSchedule(): void {
        $force = !empty($_GET['force']);
        if (!$force && file_exists(self::$cacheFile) && (time() - filemtime(self::$cacheFile) < self::$ttl)) {
            $cached = json_decode(file_get_contents(self::$cacheFile), true) ?: [];
            $cachedCount = 0;
            foreach ($cached as $items) {
                $cachedCount += is_array($items) ? count($items) : 0;
            }
            if ($cachedCount > 0) {
                jsonResponse(self::attachLibraryMatches($cached));
                return;
            }
        }

        $now = time();
        $startOfWeek = $now - (24 * 3600);
        $endOfWeek = $now + (7 * 24 * 3600);

        $query = 'query ($start: Int, $end: Int) {
          Page(page: 1, perPage: 50) {
            airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
              id airingAt timeUntilAiring episode
              media {
                id title { romaji english native }
                coverImage { extraLarge large }
                genres studios(isMain: true) { nodes { name } }
              }
            }
          }
        }';

        $curlOpts = [
            CURLOPT_URL => 'https://graphql.anilist.co',
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode(['query' => $query, 'variables' => ['start' => $startOfWeek, 'end' => $endOfWeek]]),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
            CURLOPT_TIMEOUT => 5,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2
        ];
        if (defined('CURLSSLOPT_NATIVE_CA')) {
            $curlOpts[CURLOPT_SSL_OPTIONS] = CURLSSLOPT_NATIVE_CA;
        }

        $res = false;
        try {
            $ch = curl_init();
            if ($ch !== false) {
                curl_setopt_array($ch, $curlOpts);
                $res = curl_exec($ch);
                curl_close($ch);
            }
        } catch (Throwable $e) {
            $res = false;
        }

        $daysMap = [
            'Monday' => [], 'Tuesday' => [], 'Wednesday' => [],
            'Thursday' => [], 'Friday' => [], 'Saturday' => [], 'Sunday' => []
        ];

        $totalAiring = 0;
        if ($res) {
            $data = json_decode($res, true) ?: [];
            $schedules = $data['data']['Page']['airingSchedules'] ?? [];
            $daysName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

            foreach ($schedules as $item) {
                if (empty($item['media'])) continue;
                $date = new DateTime("@" . $item['airingAt']);
                $dayName = $daysName[(int)$date->format('w')];

                $tObj = $item['media']['title'] ?? [];
                $title = $tObj['english'] ?? $tObj['romaji'] ?? $tObj['native'] ?? 'Anime';
                $studios = implode(', ', array_map(fn($s) => $s['name'], $item['media']['studios']['nodes'] ?? []));

                if (isset($daysMap[$dayName])) {
                    $daysMap[$dayName][] = [
                        'schedule_id' => $item['id'],
                        'airing_at' => $item['airingAt'],
                        'time_until' => $item['timeUntilAiring'],
                        'episode' => $item['episode'],
                        'title' => $title,
                        'romaji_title' => $tObj['romaji'] ?? '',
                        'english_title' => $tObj['english'] ?? '',
                        'cover_image' => $item['media']['coverImage']['extraLarge'] ?? $item['media']['coverImage']['large'] ?? '',
                        'genres' => implode(', ', $item['media']['genres'] ?? []),
                        'studio' => $studios
                    ];
                    $totalAiring++;
                }
            }
        }

        if ($totalAiring > 0) {
            @file_put_contents(self::$cacheFile, json_encode($daysMap));
            jsonResponse(self::attachLibraryMatches($daysMap));
            return;
        }

        // Fallback: If AniList returned 0 or was offline, check previous non-empty cache
        if (file_exists(self::$cacheFile)) {
            $cached = json_decode(file_get_contents(self::$cacheFile), true) ?: [];
            $cachedCount = 0;
            foreach ($cached as $items) {
                $cachedCount += count($items);
            }
            if ($cachedCount > 0) {
                jsonResponse(self::attachLibraryMatches($cached));
                return;
            }
        }

        // Secondary fallback: Generate schedule from local library anime so calendar is never empty
        $localShows = DbHelper::getShows('anime');
        $weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        if (!empty($localShows)) {
            foreach ($localShows as $idx => $show) {
                $assignedDay = $weekdays[$idx % count($weekdays)];
                $daysMap[$assignedDay][] = [
                    'schedule_id' => 'local_' . $show['id'],
                    'airing_at' => time() + ($idx * 86400),
                    'time_until' => ($idx * 86400),
                    'episode' => 1,
                    'title' => $show['title'],
                    'romaji_title' => $show['title'],
                    'english_title' => $show['title'],
                    'cover_image' => $show['poster_path'] ?? '',
                    'genres' => $show['genres'] ?? 'Anime',
                    'studio' => $show['studio'] ?? 'KuraStream Local',
                    'in_library' => true,
                    'library_show_id' => $show['id'],
                    'local_show_id' => $show['id']
                ];
            }
        }

        jsonResponse(self::attachLibraryMatches($daysMap));
    }

    private static function attachLibraryMatches(array $scheduleData): array {
        $localShows = DbHelper::getShows('anime');
        $result = [];

        foreach ($scheduleData as $day => $items) {
            $result[$day] = array_map(function($item) use ($localShows) {
                $match = null;
                $tLower = strtolower($item['title']);
                $rLower = strtolower($item['romaji_title']);
                $eLower = strtolower($item['english_title']);

                foreach ($localShows as $s) {
                    $sLower = strtolower($s['title']);
                    if (!empty($tLower) && strpos($sLower, $tLower) !== false ||
                        !empty($rLower) && strpos($sLower, $rLower) !== false ||
                        !empty($eLower) && strpos($sLower, $eLower) !== false) {
                        $match = $s;
                        break;
                    }
                }

                $item['in_library'] = ($match !== null) || !empty($item['in_library']);
                $item['library_show_id'] = $match ? $match['id'] : ($item['library_show_id'] ?? null);
                $item['local_show_id'] = $item['library_show_id'];
                return $item;
            }, $items);
        }

        return $result;
    }
}
