<?php
require_once __DIR__ . '/../config.php';

class TmdbScraper {
    private static ?string $apiKey = null;
    private static ?string $readToken = null;
    private static string $baseUrl = 'https://api.themoviedb.org/3';

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
        return json_decode($response, true) ?: [];
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
        $details = self::fetch($endpoint, ['language' => 'es-ES', 'append_to_response' => 'credits,videos']);
        if (empty($details)) return null;

        $studio = ($type === 'movie') 
            ? ($details['production_companies'][0]['name'] ?? '') 
            : ($details['networks'][0]['name'] ?? $details['production_companies'][0]['name'] ?? '');

        $genres = implode(', ', array_map(fn($g) => $g['name'], $details['genres'] ?? []));
        $releaseDate = $details['first_air_date'] ?? $details['release_date'] ?? '';
        $year = !empty($releaseDate) ? (int)substr($releaseDate, 0, 4) : null;
        $isAiring = ($details['in_production'] ?? false) === true || ($details['status'] ?? '') === 'Returning Series';

        return [
            'id' => (string)$tmdbId,
            'title' => $details['name'] ?? $details['title'] ?? '',
            'synopsis' => $details['overview'] ?? '',
            'rating' => (float)($details['vote_average'] ?? 0),
            'year' => $year,
            'studio' => $studio,
            'genres' => $genres,
            'poster_path' => !empty($details['poster_path']) ? "https://image.tmdb.org/t/p/w500" . $details['poster_path'] : '',
            'backdrop_path' => !empty($details['backdrop_path']) ? "https://image.tmdb.org/t/p/w1280" . $details['backdrop_path'] : '',
            'status' => $isAiring ? 'airing' : 'finished'
        ];
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
