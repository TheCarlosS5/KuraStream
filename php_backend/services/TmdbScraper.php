<?php
require_once __DIR__ . '/../config.php';

class TmdbScraper {
    private static ?string $apiKey = null;
    private static ?string $readToken = null;
    private static string $baseUrl = 'https://api.themoviedb.org/3';
    private static array $cache = [];

    private static function initConfig(): void {
        if (self::$apiKey !== null) return;
        self::$apiKey = '15d2ea6d0dc1d476efbca3eba2b9bbfb';
        self::$readToken = '';

        $keyFile = ROOT_DIR . '/apikeys.txt';
        if (file_exists($keyFile)) {
            $content = file_get_contents($keyFile);
            if (preg_match('/API Read Access Token\s+([A-Za-z0-9\-_.]+)/i', $content, $m)) {
                self::$readToken = trim($m[1]);
            }
            if (preg_match('/API Key\s+([a-f0-9]{32})/i', $content, $m)) {
                self::$apiKey = trim($m[1]);
            }
        }
    }

    private static function fetch(string $endpoint, array $params = []): array {
        self::initConfig();
        
        $cacheKey = $endpoint . '?' . http_build_query($params);
        if (isset(self::$cache[$cacheKey])) {
            return self::$cache[$cacheKey];
        }

        $headers = ['Accept: application/json'];

        if (!empty(self::$readToken)) {
            $headers[] = 'Authorization: Bearer ' . self::$readToken;
        } else if (!empty(self::$apiKey)) {
            $params['api_key'] = self::$apiKey;
        }

        $query = http_build_query($params);
        $url = self::$baseUrl . $endpoint . ($query ? '?' . $query : '');

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => false
        ]);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode !== 200 || !$response) {
            return [];
        }
        $data = json_decode($response, true) ?: [];
        self::$cache[$cacheKey] = $data;
        return $data;
    }

    public static function search(string $query, string $type = 'anime'): array {
        $endpoint = ($type === 'movie') ? '/search/movie' : '/search/tv';
        $data = self::fetch($endpoint, ['query' => $query, 'language' => 'es-ES']);
        $results = $data['results'] ?? [];

        return array_map(function($item) use ($type) {
            $releaseDate = $item['first_air_date'] ?? $item['release_date'] ?? '';
            $year = !empty($releaseDate) ? (int)substr($releaseDate, 0, 4) : null;
            return [
                'id' => (string)$item['id'],
                'title' => $item['name'] ?? $item['title'] ?? '',
                'overview' => $item['overview'] ?? '',
                'poster_path' => !empty($item['poster_path']) ? "https://image.tmdb.org/t/p/w500" . $item['poster_path'] : '',
                'backdrop_path' => !empty($item['backdrop_path']) ? "https://image.tmdb.org/t/p/w1280" . $item['backdrop_path'] : '',
                'vote_average' => (float)($item['vote_average'] ?? 0),
                'first_air_date' => $releaseDate,
                'year' => $year,
                'media_type' => ($type === 'movie') ? 'movie' : 'anime'
            ];
        }, array_slice($results, 0, 10));
    }

    public static function getDetails(int $tmdbId, string $type = 'anime'): ?array {
        $endpoint = ($type === 'movie') ? "/movie/{$tmdbId}" : "/tv/{$tmdbId}";
        $details = self::fetch($endpoint, ['language' => 'es-ES', 'append_to_response' => 'credits,aggregate_credits,videos']);
        if (empty($details)) return null;

        // Fallback overview to English if Spanish is empty
        $overview = trim($details['overview'] ?? '');
        if (empty($overview)) {
            $enDetails = self::fetch($endpoint, ['language' => 'en-US']);
            $overview = trim($enDetails['overview'] ?? '');
        }

        // Identify studio: Prioritize animation / production company over broadcasting network
        $studio = '';
        $companies = $details['production_companies'] ?? [];
        if (!empty($companies) && is_array($companies)) {
            // Pick first production company (which in anime is usually the primary animation studio)
            $studio = $companies[0]['name'] ?? '';
        }
        if (empty($studio) && !empty($details['networks'][0]['name'])) {
            $studio = $details['networks'][0]['name'];
        }

        // Identify Director & Writer
        $crew = array_merge(
            $details['credits']['crew'] ?? [],
            $details['aggregate_credits']['crew'] ?? []
        );

        $director = '';
        $writer = '';

        foreach ($crew as $cr) {
            $job = strtolower($cr['job'] ?? '');
            $dept = strtolower($cr['department'] ?? '');
            $name = $cr['name'] ?? '';

            if (empty($director) && (str_contains($job, 'director') || $dept === 'directing')) {
                $director = $name;
            }
            if (empty($writer) && (str_contains($job, 'writer') || str_contains($job, 'author') || str_contains($job, 'novel') || str_contains($job, 'comic') || str_contains($job, 'original story') || str_contains($job, 'creator') || $dept === 'writing')) {
                $writer = $name;
            }
        }

        if (empty($writer) && !empty($details['created_by'][0]['name'])) {
            $writer = $details['created_by'][0]['name'];
        }

        // Parse Cast & Voice Actors
        $castRaw = !empty($details['aggregate_credits']['cast']) ? $details['aggregate_credits']['cast'] : ($details['credits']['cast'] ?? []);
        $castMembers = [];

        foreach (array_slice($castRaw, 0, 20) as $c) {
            $actorName = $c['name'] ?? '';
            $charName = '';

            if (!empty($c['roles'][0]['character'])) {
                $charName = $c['roles'][0]['character'];
            } else if (!empty($c['character'])) {
                $charName = $c['character'];
            }

            // Clean '(voice)' or '(voz)' suffix
            $charName = trim(preg_replace('/\s*\((?:voice|voz|japanese)\)/i', '', $charName));

            if (!empty($actorName)) {
                $castMembers[] = [
                    'name' => $actorName,
                    'character' => $charName ?: 'Personaje'
                ];
            }
        }

        // Extract YouTube trailer key
        $trailerKey = null;
        $videos = $details['videos']['results'] ?? [];
        foreach ($videos as $v) {
            if (($v['site'] ?? '') === 'YouTube' && (($v['type'] ?? '') === 'Trailer' || ($v['type'] ?? '') === 'Teaser')) {
                $trailerKey = $v['key'];
                break;
            }
        }

        $genres = implode(', ', array_map(fn($g) => $g['name'], $details['genres'] ?? []));
        $releaseDate = $details['first_air_date'] ?? $details['release_date'] ?? '';
        $year = !empty($releaseDate) ? (int)substr($releaseDate, 0, 4) : null;
        
        // Smart 3-state status calculation: 'airing' (En Emisión), 'upcoming' (En Espera / Próx. Temp.), 'finished' (Finalizado)
        $rawStatus = $details['status'] ?? '';
        $inProduction = ($details['in_production'] ?? false) === true;
        $lastAirDate = $details['last_air_date'] ?? '';
        $nextEp = $details['next_episode_to_air'] ?? null;

        $computedStatus = 'finished';
        if ($type === 'movie') {
            $computedStatus = 'finished';
        } else if ($rawStatus === 'Returning Series' || $rawStatus === 'In Production' || $inProduction) {
            $isCurrentlyAiring = false;

            if (!empty($nextEp) && !empty($nextEp['air_date'])) {
                $nextTs = strtotime($nextEp['air_date']);
                $diffDays = ($nextTs - time()) / 86400;
                if ($diffDays >= -7 && $diffDays <= 35) {
                    $isCurrentlyAiring = true;
                }
            }

            if (!$isCurrentlyAiring && !empty($lastAirDate)) {
                $lastTs = strtotime($lastAirDate);
                $daysSinceLast = (time() - $lastTs) / 86400;
                if ($daysSinceLast >= 0 && $daysSinceLast <= 35) {
                    $isCurrentlyAiring = true;
                }
            }

            $computedStatus = $isCurrentlyAiring ? 'airing' : 'upcoming';
        } else if ($rawStatus === 'Planned') {
            $computedStatus = 'upcoming';
        } else {
            $computedStatus = 'finished';
        }

        return [
            'id' => (string)$tmdbId,
            'title' => $details['name'] ?? $details['title'] ?? '',
            'synopsis' => $overview,
            'rating' => (float)($details['vote_average'] ?? 0),
            'year' => $year,
            'studio' => $studio,
            'director' => $director,
            'writer' => $writer,
            'cast_members' => $castMembers,
            'trailer_key' => $trailerKey,
            'genres' => $genres,
            'poster_path' => !empty($details['poster_path']) ? "https://image.tmdb.org/t/p/original" . $details['poster_path'] : '',
            'backdrop_path' => !empty($details['backdrop_path']) ? "https://image.tmdb.org/t/p/original" . $details['backdrop_path'] : '',
            'status' => $computedStatus
        ];
    }

    public static function getSeasonEpisodes(int $tmdbId, int $seasonNumber = 1): array {
        $dataEs = self::fetch("/tv/{$tmdbId}/season/{$seasonNumber}", ['language' => 'es-ES']);
        $episodesEs = $dataEs['episodes'] ?? [];

        // Fetch English fallback for missing titles/descriptions
        $episodesEn = [];
        $hasMissing = false;
        foreach ($episodesEs as $ep) {
            if (empty($ep['name']) || empty($ep['overview'])) {
                $hasMissing = true;
                break;
            }
        }
        if ($hasMissing || empty($episodesEs)) {
            $dataEn = self::fetch("/tv/{$tmdbId}/season/{$seasonNumber}", ['language' => 'en-US']);
            foreach ($dataEn['episodes'] ?? [] as $ep) {
                $episodesEn[(int)$ep['episode_number']] = $ep;
            }
        }

        $result = [];
        // Index ES episodes
        foreach ($episodesEs as $ep) {
            $num = (int)($ep['episode_number'] ?? 0);
            if ($num <= 0) continue;

            $title = trim($ep['name'] ?? '');
            $synopsis = trim($ep['overview'] ?? '');
            $still = !empty($ep['still_path']) ? "https://image.tmdb.org/t/p/w500" . $ep['still_path'] : '';

            // English fallback
            if (isset($episodesEn[$num])) {
                if (empty($title) || preg_match('/^Episodio\s+\d+$/i', $title) || preg_match('/^Episode\s+\d+$/i', $title)) {
                    if (!empty($episodesEn[$num]['name'])) {
                        $title = $episodesEn[$num]['name'];
                    }
                }
                if (empty($synopsis) && !empty($episodesEn[$num]['overview'])) {
                    $synopsis = $episodesEn[$num]['overview'];
                }
                if (empty($still) && !empty($episodesEn[$num]['still_path'])) {
                    $still = "https://image.tmdb.org/t/p/w500" . $episodesEn[$num]['still_path'];
                }
            }

            $result[$num] = [
                'title' => $title,
                'synopsis' => $synopsis,
                'still_path' => $still
            ];
        }

        // Include any EN episode not in ES
        foreach ($episodesEn as $num => $ep) {
            if (!isset($result[$num])) {
                $result[$num] = [
                    'title' => $ep['name'] ?? '',
                    'synopsis' => $ep['overview'] ?? '',
                    'still_path' => !empty($ep['still_path']) ? "https://image.tmdb.org/t/p/w500" . $ep['still_path'] : ''
                ];
            }
        }

        return $result;
    }

    public static function downloadFile(string $url, string $destPath): bool {
        if (empty($url)) return false;
        $dir = dirname($destPath);
        if (!is_dir($dir)) @mkdir($dir, 0755, true);

        $ch = curl_init($url);
        $fp = fopen($destPath, 'wb');
        curl_setopt_array($ch, [
            CURLOPT_FILE => $fp,
            CURLOPT_HEADER => 0,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_FOLLOWLOCATION => true
        ]);
        $success = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        fclose($fp);

        if (!$success || $httpCode !== 200 || filesize($destPath) === 0) {
            @unlink($destPath);
            return false;
        }
        return true;
    }
}
