<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';

class CalendarController {
    private static string $cacheFile = ROOT_DIR . '/php_backend/cache_calendar.json';
    private static int $ttl = 21600; // 6 hours

    public static function getSchedule(): void {
        if (file_exists(self::$cacheFile) && (time() - filemtime(self::$cacheFile) < self::$ttl)) {
            $cached = json_decode(file_get_contents(self::$cacheFile), true) ?: [];
            jsonResponse(self::attachLibraryMatches($cached));
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

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => 'https://graphql.anilist.co',
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode(['query' => $query, 'variables' => ['start' => $startOfWeek, 'end' => $endOfWeek]]),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
            CURLOPT_TIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => false
        ]);

        $res = curl_exec($ch);
        curl_close($ch);

        $daysMap = [
            'Monday' => [], 'Tuesday' => [], 'Wednesday' => [],
            'Thursday' => [], 'Friday' => [], 'Saturday' => [], 'Sunday' => []
        ];

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
                }
            }
        }

        @file_put_contents(self::$cacheFile, json_encode($daysMap));
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

                $item['in_library'] = ($match !== null);
                $item['library_show_id'] = $match ? $match['id'] : null;
                return $item;
            }, $items);
        }

        return $result;
    }
}
