<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/TmdbScraper.php';

class TorrentDownloader {
    private static ?string $aria2Path = null;
    private static string $stateFile = ROOT_DIR . '/php_backend/torrent_state.json';
    private static string $tempDir = LIBRARY_DIR . '/downloads/temp';
    private static string $stagedDir = LIBRARY_DIR . '/downloads/staged';

    /**
     * Resolves path to aria2c binary
     */
    public static function getAria2Path(): string {
        if (self::$aria2Path !== null) {
            return self::$aria2Path;
        }

        $candidates = [
            ROOT_DIR . '/bin/aria2c',
            dirname(ROOT_DIR) . '/bin/aria2c',
            '/usr/bin/aria2c',
            '/usr/local/bin/aria2c',
        ];

        foreach ($candidates as $cand) {
            if (file_exists($cand) && is_executable($cand)) {
                self::$aria2Path = $cand;
                return self::$aria2Path;
            }
        }

        // Try 'which aria2c'
        $which = trim(@shell_exec('which aria2c 2>/dev/null') ?: '');
        if (!empty($which) && file_exists($which) && is_executable($which)) {
            self::$aria2Path = $which;
            return self::$aria2Path;
        }

        self::$aria2Path = ROOT_DIR . '/bin/aria2c';
        return self::$aria2Path;
    }

    /**
     * Loads torrent state from JSON
     */
    public static function getState(): array {
        $default = [
            'isEnabled' => true,
            'isScanning' => false,
            'lastScanTime' => null,
            'currentDownload' => null,
            'downloadQueue' => [],
            'history' => [],
            'dismissed' => []
        ];

        if (!file_exists(self::$stateFile)) {
            self::saveState($default);
            return $default;
        }

        $json = @file_get_contents(self::$stateFile);
        $data = json_decode($json, true);
        if (!is_array($data)) {
            return $default;
        }

        return array_merge($default, $data);
    }

    /**
     * Saves torrent state to JSON
     */
    public static function saveState(array $state): void {
        @file_put_contents(self::$stateFile, json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    /**
     * Parses raw torrent / anime filename to extract clean title, season, and episode.
     */
    public static function parseAnimeFilename(string $filename): array {
        if (empty($filename)) {
            return ['animeTitle' => 'Anime', 'season' => 1, 'episode' => 1, 'isBatch' => false];
        }

        // Remove video extensions
        $clean = preg_replace('/\.(mkv|mp4|avi|webm|ts)$/i', '', $filename);

        // Detect if it's a batch/season pack
        $isBatch = (bool)preg_match('/(batch|completa|completo|01[\s\-_~]+\d{2}|S\d+[\s\-_]+Complete|season\s*\d+\s*complete|\b01\s*-\s*\d{2}\b)/i', $clean);

        $season = 1;
        $episode = 1;

        // Season & Episode (e.g. S02E05, S2E5, 02x05)
        if (preg_match('/S(\d+)[\s._\-]*E(\d+)/i', $clean, $m)) {
            $season = (int)$m[1];
            $episode = (int)$m[2];
        } elseif (preg_match('/(\d+)x(\d+)/i', $clean, $m)) {
            $season = (int)$m[1];
            $episode = (int)$m[2];
        } elseif (preg_match('/[\s\-_]+(\d{1,3})[\s\-_\[\.]/i', $clean, $m)) {
            $episode = (int)$m[1];
        } elseif (preg_match('/(?:Cap[ií]tulo|Cap|Episodio|Episode|Ep)\.?\s*(\d{1,3})/i', $clean, $m)) {
            $episode = (int)$m[1];
        }

        // Remove bracketed tags [Fansub], [1080p], [Latino], etc.
        $titleOnly = preg_replace('/\[.*?\]/', '', $clean);
        $titleOnly = preg_replace('/\(.*?\)/', '', $titleOnly);

        // Remove episode patterns from title
        $titleOnly = preg_replace('/S\d+[\s._\-]*E\d+/i', '', $titleOnly);
        $titleOnly = preg_replace('/\d+x\d+/i', '', $titleOnly);
        $titleOnly = preg_replace('/(?:Cap[ií]tulo|Cap|Episodio|Episode|Ep)\.?\s*\d{1,3}/i', '', $titleOnly);
        $titleOnly = preg_replace('/[\s\-_]+\d{1,3}.*$/', '', $titleOnly);
        if (strpos($titleOnly, '|') !== false) {
            $parts = explode('|', $titleOnly);
            $titleOnly = trim($parts[0]);
        }
        $titleOnly = preg_replace('/\s+/', ' ', $titleOnly);
        $titleOnly = trim(preg_replace('/^[\s\-_|:]+|[\s\-_|:]+$/', '', $titleOnly));

        return [
            'animeTitle' => !empty($titleOnly) ? $titleOnly : 'Anime',
            'season' => $season > 0 ? $season : 1,
            'episode' => $episode > 0 ? $episode : 1,
            'isBatch' => $isBatch
        ];
    }

    /**
     * Filters torrent items targeting Spanish (Latino, Castellano, Sub Español, Multi-Audio, Dual Audio)
     */
    public static function filterSpanishTorrents(array $items): array {
        $spanishRegex = '/(latino|español|espanol|castellano|spanish|sub[\s\._\-]*español|sub[\s\._\-]*espanol|sub[\s\._\-]*esp|multi[\s\._\-]*audio|dual[\s\._\-]*audio|multi[\s\._\-]*sub|multi[\s\._\-]*subs|es\-la|es\-es|spa|vostfr[\/\-_]*es)/i';
        $rawChineseRegex = '/\[(RAW|Chinese|BIG5|GB|CHS|CHT|Russian)\]/i';

        $filtered = [];
        foreach ($items as $item) {
            if (empty($item['title'])) continue;
            $fullText = $item['title'] . ' ' . ($item['description'] ?? '');
            $hasSpanish = (bool)preg_match($spanishRegex, $fullText);
            $isRawChinese = (bool)preg_match($rawChineseRegex, $item['title']) && !$hasSpanish;

            if ($hasSpanish && !$isRawChinese) {
                $filtered[] = $item;
            }
        }

        return $filtered;
    }

    /**
     * Checks if an episode or anime is already present in Library, Staging, Queue, or Dismissed list
     */
    public static function isAlreadyInLibraryOrQueue(string $animeTitle, int $season, int $episode, string $guid = '', string $torrentUrl = ''): bool {
        $state = self::getState();

        // 1. Check dismissed list
        $dismissed = $state['dismissed'] ?? [];
        if (!empty($guid) && in_array($guid, $dismissed, true)) return true;
        if (!empty($torrentUrl) && in_array($torrentUrl, $dismissed, true)) return true;

        // 2. Check current active download and queue
        if (!empty($state['currentDownload'])) {
            $cur = $state['currentDownload'];
            if ((!empty($guid) && ($cur['guid'] ?? '') === $guid) ||
                (!empty($torrentUrl) && ($cur['torrentUrl'] ?? '') === $torrentUrl)) {
                return true;
            }
            if (strcasecmp($cur['cleanTitle'] ?? '', $animeTitle) === 0 &&
                (int)($cur['season'] ?? 1) === $season &&
                (int)($cur['episode'] ?? 1) === $episode) {
                return true;
            }
        }

        foreach ($state['downloadQueue'] ?? [] as $q) {
            if ((!empty($guid) && ($q['guid'] ?? '') === $guid) ||
                (!empty($torrentUrl) && ($q['torrentUrl'] ?? '') === $torrentUrl)) {
                return true;
            }
            if (strcasecmp($q['cleanTitle'] ?? '', $animeTitle) === 0 &&
                (int)($q['season'] ?? 1) === $season &&
                (int)($q['episode'] ?? 1) === $episode) {
                return true;
            }
        }

        // 3. Check DB episodes
        try {
            $db = Database::getConnection();
            $stmt = $db->prepare("
                SELECT e.id FROM episodes e
                JOIN shows s ON e.show_id = s.id
                WHERE (LOWER(s.title) = LOWER(:title) OR LOWER(s.title) LIKE LOWER(:title_like))
                  AND e.season_number = :season
                  AND e.episode_number = :episode
                LIMIT 1
            ");
            $stmt->execute([
                'title' => $animeTitle,
                'title_like' => "%{$animeTitle}%",
                'season' => $season,
                'episode' => $episode
            ]);
            if ($stmt->fetch()) {
                return true;
            }

            // 4. Check staged_imports table
            $stmtStage = $db->prepare("
                SELECT id FROM staged_imports
                WHERE (LOWER(clean_title) = LOWER(:title) OR LOWER(clean_title) LIKE LOWER(:title_like))
                  AND season = :season
                  AND episode = :episode
                LIMIT 1
            ");
            $stmtStage->execute([
                'title' => $animeTitle,
                'title_like' => "%{$animeTitle}%",
                'season' => $season,
                'episode' => $episode
            ]);
            if ($stmtStage->fetch()) {
                return true;
            }
        } catch (\Exception $e) {
            // DB check error ignored
        }

        return false;
    }

    /**
     * Parses simple RSS XML into array of torrent items
     */
    public static function parseRSSXml(string $xmlText): array {
        $items = [];
        if (empty($xmlText)) return $items;

        if (preg_match_all('/<item>(.*?)<\/item>/si', $xmlText, $matches)) {
            foreach ($matches[1] as $content) {
                $title = '';
                $link = '';
                $guid = '';
                $description = '';
                $seeders = 0;
                $leechers = 0;
                $size = 'N/A';
                $pubDate = '';

                if (preg_match('/<title>(?:<!\[CDATA\[)?(.*?)(\]\]>)?<\/title>/si', $content, $m)) {
                    $title = trim($m[1]);
                }
                if (preg_match('/<link>(?:<!\[CDATA\[)?(.*?)(\]\]>)?<\/link>/si', $content, $m)) {
                    $link = trim($m[1]);
                }
                if (preg_match('/<guid[^>]*>(?:<!\[CDATA\[)?(.*?)(\]\]>)?<\/guid>/si', $content, $m)) {
                    $guid = trim($m[1]);
                }
                if (preg_match('/<description>(?:<!\[CDATA\[)?(.*?)(\]\]>)?<\/description>/si', $content, $m)) {
                    $description = trim($m[1]);
                }
                if (preg_match('/<nyaa:seeders>(\d+)<\/nyaa:seeders>/si', $content, $m)) {
                    $seeders = (int)$m[1];
                }
                if (preg_match('/<nyaa:leechers>(\d+)<\/nyaa:leechers>/si', $content, $m)) {
                    $leechers = (int)$m[1];
                }
                if (preg_match('/<nyaa:size>(.*?)<\/nyaa:size>/si', $content, $m)) {
                    $size = trim($m[1]);
                }
                if (preg_match('/<pubDate>(.*?)<\/pubDate>/si', $content, $m)) {
                    $pubDate = trim($m[1]);
                }

                if (!empty($title)) {
                    $items[] = [
                        'title' => html_entity_decode($title, ENT_QUOTES | ENT_XML1, 'UTF-8'),
                        'link' => $link,
                        'guid' => !empty($guid) ? $guid : (!empty($link) ? $link : $title),
                        'description' => $description,
                        'seeders' => $seeders,
                        'leechers' => $leechers,
                        'size' => $size,
                        'pubDate' => $pubDate
                    ];
                }
            }
        }

        return $items;
    }

    /**
     * HTTP GET request helper using curl or file_get_contents
     */
    private static function httpGet(string $url): ?string {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
            curl_setopt($ch, CURLOPT_USERAGENT, 'KuraStream/2.0 AutoDownloader');
            curl_setopt($ch, CURLOPT_TIMEOUT, 10);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            $resp = curl_exec($ch);
            $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if ($code >= 200 && $code < 300 && is_string($resp)) {
                return $resp;
            }
        }

        $opts = [
            'http' => [
                'method' => 'GET',
                'header' => "User-Agent: KuraStream/2.0 AutoDownloader\r\n",
                'timeout' => 10,
                'ignore_errors' => true
            ],
            'ssl' => [
                'verify_peer' => false,
                'verify_peer_name' => false
            ]
        ];
        $ctx = stream_context_create($opts);
        $resp = @file_get_contents($url, false, $ctx);
        return is_string($resp) ? $resp : null;
    }

    /**
     * Searches Nyaa.si torrents
     */
    public static function searchNyaa(string $query = '', bool $filterSpanish = false): array {
        $cleanQuery = trim($query);
        $cat = $filterSpanish ? '1_2' : '1_0';
        $url = !empty($cleanQuery)
            ? 'https://nyaa.si/?page=rss&q=' . urlencode($cleanQuery) . '&c=' . $cat . '&f=0'
            : 'https://nyaa.si/?page=rss&c=1_2&f=0';

        $xml = self::httpGet($url);
        $items = $xml ? self::parseRSSXml($xml) : [];

        // If c=1_2 returned nothing and filterSpanish is requested, search c=1_0 and filter
        if (empty($items) && !empty($cleanQuery) && $cat === '1_2') {
            $fallbackUrl = 'https://nyaa.si/?page=rss&q=' . urlencode($cleanQuery) . '&c=1_0&f=0';
            $fallbackXml = self::httpGet($fallbackUrl);
            if ($fallbackXml) {
                $items = self::parseRSSXml($fallbackXml);
            }
        }

        if ($filterSpanish) {
            $items = self::filterSpanishTorrents($items);
        }

        return $items;
    }

    /**
     * Fetches latest Spanish releases from Nyaa RSS feeds
     */
    public static function fetchSpanishAnimeRSS(): array {
        $feeds = [
            'https://nyaa.si/?page=rss&c=1_2',
            'https://nyaa.si/?page=rss&q=latino&c=1_0',
            'https://nyaa.si/?page=rss&q=espa%C3%B1ol&c=1_0',
            'https://nyaa.si/?page=rss&q=castellano&c=1_0',
            'https://nyaa.si/?page=rss&q=multi-audio&c=1_0'
        ];

        $allItems = [];
        $seenKeys = [];

        foreach ($feeds as $url) {
            $xml = self::httpGet($url);
            if (!$xml) continue;

            $items = self::parseRSSXml($xml);
            $filtered = self::filterSpanishTorrents($items);

            foreach ($filtered as $item) {
                $key = $item['guid'] ?? ($item['link'] ?? $item['title']);
                if (!isset($seenKeys[$key])) {
                    $seenKeys[$key] = true;
                    $allItems[] = $item;
                }
            }
        }

        return $allItems;
    }

    /**
     * Searches for all available episodes of an anime to detect missing ones
     */
    public static function searchAllAnimeEpisodes(string $animeTitle): array {
        $parsedInput = self::parseAnimeFilename($animeTitle);
        $cleanTitle = !empty($parsedInput['animeTitle']) ? $parsedInput['animeTitle'] : trim($animeTitle);
        if (empty($cleanTitle)) return [];

        // Search with clean title on Nyaa (all categories)
        $items = self::searchNyaa($cleanTitle, false);
        if (empty($items) && $cleanTitle !== trim($animeTitle)) {
            $items = self::searchNyaa(trim($animeTitle), false);
        }

        $results = [];
        $seenKeys = [];

        foreach ($items as $item) {
            $key = $item['guid'] ?? $item['link'];
            if (isset($seenKeys[$key])) continue;
            $seenKeys[$key] = true;

            $parsed = self::parseAnimeFilename($item['title']);
            $alreadyExists = self::isAlreadyInLibraryOrQueue(
                $parsed['animeTitle'],
                $parsed['season'],
                $parsed['episode'],
                $item['guid'],
                $item['link']
            );

            $results[] = [
                'title' => $item['title'],
                'link' => $item['link'],
                'guid' => $item['guid'],
                'size' => $item['size'],
                'seeders' => $item['seeders'],
                'leechers' => $item['leechers'],
                'season' => $parsed['season'],
                'episode' => $parsed['episode'],
                'isBatch' => $parsed['isBatch'],
                'cleanTitle' => $parsed['animeTitle'],
                'alreadyInLibrary' => $alreadyExists
            ];
        }

        // Sort by episode ascending
        usort($results, fn($a, $b) => $a['episode'] <=> $b['episode']);

        return $results;
    }

    /**
     * Executes auto-scan of RSS feeds and enqueues new non-duplicate Spanish anime episodes
     */
    public static function runAutoScan(): array {
        $state = self::getState();
        if ($state['isScanning']) {
            return ['status' => 'already_scanning', 'state' => $state];
        }

        $state['isScanning'] = true;
        $state['lastScanTime'] = date('c');
        self::saveState($state);

        $enqueued = 0;
        try {
            $items = self::fetchSpanishAnimeRSS();
            foreach ($items as $item) {
                $parsed = self::parseAnimeFilename($item['title']);
                $exists = self::isAlreadyInLibraryOrQueue(
                    $parsed['animeTitle'],
                    $parsed['season'],
                    $parsed['episode'],
                    $item['guid'],
                    $item['link']
                );

                if (!$exists) {
                    self::addToQueue($item['link'], $item['title'], $item['guid'], $item['size'], $item['seeders'], false);
                    $enqueued++;
                }
            }
        } catch (\Exception $e) {
            error_log('[AutoDownloader] Auto-scan error: ' . $e->getMessage());
        } finally {
            $state = self::getState();
            $state['isScanning'] = false;
            self::saveState($state);
        }

        // If not downloading, process queue
        self::processQueue();

        return [
            'status' => 'scan_complete',
            'enqueuedCount' => $enqueued,
            'state' => self::getState()
        ];
    }

    /**
     * Adds an item to the download queue
     */
    public static function addToQueue(string $torrentUrl, string $title, string $guid = '', string $size = 'N/A', int $seeders = 0, bool $autoStart = true): array {
        if (empty($torrentUrl) && empty($title)) {
            return ['success' => false, 'error' => 'URL o título de torrent requerido'];
        }

        $state = self::getState();
        $parsed = self::parseAnimeFilename($title);
        $id = 'tor_' . substr(md5($torrentUrl . $title . microtime(true)), 0, 10);

        $queueItem = [
            'id' => $id,
            'title' => $title,
            'cleanTitle' => $parsed['animeTitle'],
            'season' => $parsed['season'],
            'episode' => $parsed['episode'],
            'isBatch' => $parsed['isBatch'],
            'torrentUrl' => $torrentUrl,
            'guid' => !empty($guid) ? $guid : $torrentUrl,
            'size' => $size,
            'seeders' => $seeders,
            'status' => 'pending',
            'addedAt' => date('c')
        ];

        $state['downloadQueue'][] = $queueItem;
        self::saveState($state);

        if ($autoStart) {
            self::processQueue();
        }

        return ['success' => true, 'item' => $queueItem, 'state' => self::getState()];
    }

    /**
     * Processes queue sequentially (1 by 1)
     */
    public static function processQueue(): void {
        $state = self::getState();

        // Check if there is already an active download running
        if (!empty($state['currentDownload'])) {
            self::checkActiveDownload();
            $state = self::getState();
            if (!empty($state['currentDownload'])) {
                return; // Still running
            }
        }

        if (empty($state['downloadQueue'])) {
            return; // Nothing in queue
        }

        // Pop first pending item
        $nextItem = null;
        $nextIdx = -1;
        foreach ($state['downloadQueue'] as $idx => $item) {
            if ($item['status'] === 'pending') {
                $nextItem = $item;
                $nextIdx = $idx;
                break;
            }
        }

        if (!$nextItem) return;

        // Remove from queue array and make active
        array_splice($state['downloadQueue'], $nextIdx, 1);

        @mkdir(self::$tempDir, 0777, true);
        @mkdir(self::$stagedDir, 0777, true);

        $downloadId = $nextItem['id'];
        $logFile = sys_get_temp_dir() . "/kura_aria2_{$downloadId}.log";
        @file_put_contents($logFile, '');

        $aria2c = self::getAria2Path();
        $targetUrl = $nextItem['torrentUrl'];

        // Execute aria2c in background
        $cmd = sprintf(
            '%s --dir=%s --seed-time=0 --max-connection-per-server=8 --split=8 --min-split-size=1M --summary-interval=1 --enable-dht=true --dht-listen-port=6881 --follow-torrent=mem --allow-overwrite=true %s > %s 2>&1 & echo $!',
            escapeshellarg($aria2c),
            escapeshellarg(self::$tempDir),
            escapeshellarg($targetUrl),
            escapeshellarg($logFile)
        );

        $pid = trim(@shell_exec($cmd) ?: '');

        $state['currentDownload'] = [
            'id' => $downloadId,
            'title' => $nextItem['title'],
            'cleanTitle' => $nextItem['cleanTitle'],
            'animeTitle' => !empty($nextItem['cleanTitle']) ? $nextItem['cleanTitle'] : $nextItem['title'],
            'season' => $nextItem['season'],
            'episode' => $nextItem['episode'],
            'isBatch' => $nextItem['isBatch'] ?? false,
            'torrentUrl' => $targetUrl,
            'guid' => $nextItem['guid'],
            'size' => $nextItem['size'],
            'percent' => 0,
            'loadedMB' => '0.0 MB',
            'totalMB' => $nextItem['size'],
            'speedMBs' => '0.0',
            'status' => 'downloading',
            'pid' => (int)$pid,
            'logFile' => $logFile,
            'startedAt' => date('c')
        ];

        self::saveState($state);
    }

    /**
     * Checks progress and completion of the active download
     */
    public static function checkActiveDownload(): array {
        $state = self::getState();
        if (empty($state['currentDownload'])) {
            return ['active' => false];
        }

        $cur = &$state['currentDownload'];
        $logFile = $cur['logFile'] ?? '';
        $pid = (int)($cur['pid'] ?? 0);

        // Check if process is still alive
        $isAlive = false;
        if ($pid > 0) {
            $check = trim(@shell_exec("ps -p {$pid} -o pid= 2>/dev/null") ?: '');
            $isAlive = !empty($check);
        }

        // If paused by user, keep paused state without failing
        if ($cur['status'] === 'paused') {
            return ['active' => true, 'current' => $cur];
        }

        // Read log file for progress parsing
        if (!empty($logFile) && file_exists($logFile)) {
            $lines = @file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
            $recent = array_slice($lines, -15);

            foreach (array_reverse($recent) as $line) {
                // Pattern: [#xxxxxx 150MiB/1.2GiB(12%) CN:4 DL:15.2MiB ETA:1m10s]
                if (preg_match('/\[#[a-f0-9]+\s+([0-9\.]+[A-Za-z]+)\/([0-9\.]+[A-Za-z]+)\((\d+)%\).*?DL:([0-9\.]+[A-Za-z]+)/i', $line, $m)) {
                    $cur['loadedMB'] = $m[1];
                    $cur['totalMB'] = $m[2];
                    $cur['percent'] = (int)$m[3];
                    $cur['speedMBs'] = $m[4];
                    break;
                }
            }
        }

        // If process finished
        if (!$isAlive) {
            $cur['percent'] = 100;
            $cur['status'] = 'ingesting';
            self::saveState($state);

            // Ingest video files to Staging ("Por Organizar")
            $ingested = self::ingestCompletedDownloads();

            // Record to history
            $state['history'][] = [
                'id' => $cur['id'],
                'title' => $cur['title'],
                'anime_title' => $cur['cleanTitle'] ?? $cur['title'],
                'season' => $cur['season'],
                'episode' => $cur['episode'],
                'size' => $cur['totalMB'] ?? 'OK',
                'ingested_count' => $ingested,
                'completedAt' => date('c')
            ];

            // Limit history to 50 items
            if (count($state['history']) > 50) {
                $state['history'] = array_slice($state['history'], -50);
            }

            @unlink($logFile);
            $state['currentDownload'] = null;
            self::saveState($state);

            // Continue with next queued item
            self::processQueue();
        } else {
            self::saveState($state);
        }

        return ['active' => !empty($state['currentDownload']), 'current' => $state['currentDownload']];
    }

    /**
     * Ingests completed video files from temp download folder into staging folder ("Por Organizar")
     */
    public static function ingestCompletedDownloads(): int {
        @mkdir(self::$stagedDir, 0777, true);
        if (!is_dir(self::$tempDir)) return 0;

        $files = scandir(self::$tempDir) ?: [];
        $stagedCount = 0;

        foreach ($files as $f) {
            if ($f === '.' || $f === '..' || str_ends_with($f, '.aria2')) continue;
            $fullPath = self::$tempDir . '/' . $f;

            if (is_file($fullPath)) {
                $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
                if (in_array($ext, ['mkv', 'mp4', 'avi', 'webm', 'ts'], true)) {
                    $targetPath = self::$stagedDir . '/' . $f;
                    @rename($fullPath, $targetPath);

                    $parsed = self::parseAnimeFilename($f);
                    $newId = 'staged_' . md5($targetPath . $f);

                    try {
                        $db = Database::getConnection();
                        $chk = $db->prepare("SELECT id FROM staged_imports WHERE filepath = :fp OR original_filename = :fn");
                        $chk->execute(['fp' => $targetPath, 'fn' => $f]);
                        if (!$chk->fetch()) {
                            $stmt = $db->prepare("
                                INSERT INTO staged_imports (id, original_filename, filepath, media_type, clean_title, season, episode, filesize, created_at)
                                VALUES (:id, :fn, :fp, :media_type, :clean_title, :season, :episode, :filesize, NOW())
                            ");
                            $stmt->execute([
                                'id' => $newId,
                                'fn' => $f,
                                'fp' => $targetPath,
                                'media_type' => 'anime',
                                'clean_title' => $parsed['animeTitle'],
                                'season' => $parsed['season'],
                                'episode' => $parsed['episode'],
                                'filesize' => filesize($targetPath) ?: 0
                            ]);
                        }
                    } catch (\Exception $e) {
                        error_log('[AutoDownloader] Staging DB insert error: ' . $e->getMessage());
                    }

                    $stagedCount++;
                } else {
                    @unlink($fullPath);
                }
            } elseif (is_dir($fullPath)) {
                // If aria2 created a subfolder for a multi-file torrent, scan inside
                $subFiles = scandir($fullPath) ?: [];
                foreach ($subFiles as $sf) {
                    if ($sf === '.' || $sf === '..' || str_ends_with($sf, '.aria2')) continue;
                    $subFull = $fullPath . '/' . $sf;
                    if (is_file($subFull)) {
                        $ext = strtolower(pathinfo($sf, PATHINFO_EXTENSION));
                        if (in_array($ext, ['mkv', 'mp4', 'avi', 'webm', 'ts'], true)) {
                            $targetPath = self::$stagedDir . '/' . $sf;
                            @rename($subFull, $targetPath);

                            $parsed = self::parseAnimeFilename($sf);
                            $newId = 'staged_' . md5($targetPath . $sf);

                            try {
                                $db = Database::getConnection();
                                $chk = $db->prepare("SELECT id FROM staged_imports WHERE filepath = :fp OR original_filename = :fn");
                                $chk->execute(['fp' => $targetPath, 'fn' => $sf]);
                                if (!$chk->fetch()) {
                                    $stmt = $db->prepare("
                                        INSERT INTO staged_imports (id, original_filename, filepath, media_type, clean_title, season, episode, filesize, created_at)
                                        VALUES (:id, :fn, :fp, :media_type, :clean_title, :season, :episode, :filesize, NOW())
                                    ");
                                    $stmt->execute([
                                        'id' => $newId,
                                        'fn' => $sf,
                                        'fp' => $targetPath,
                                        'media_type' => 'anime',
                                        'clean_title' => $parsed['animeTitle'],
                                        'season' => $parsed['season'],
                                        'episode' => $parsed['episode'],
                                        'filesize' => filesize($targetPath) ?: 0
                                    ]);
                                }
                            } catch (\Exception $e) {
                                error_log('[AutoDownloader] Staging subfile insert error: ' . $e->getMessage());
                            }

                            $stagedCount++;
                        }
                    }
                }
            }
        }

        return $stagedCount;
    }

    /**
     * Pauses an active or queued download
     */
    public static function pauseDownload(string $id = ''): array {
        $state = self::getState();

        // If it's the active download or id is empty
        if (!empty($state['currentDownload']) && (empty($id) || $state['currentDownload']['id'] === $id)) {
            $pid = (int)($state['currentDownload']['pid'] ?? 0);
            if ($pid > 0) {
                @shell_exec("kill -STOP {$pid} 2>/dev/null");
            }
            $state['currentDownload']['status'] = 'paused';
            self::saveState($state);
            return ['success' => true, 'status' => self::getState()];
        }

        // If in queue
        if (!empty($id)) {
            foreach ($state['downloadQueue'] as &$q) {
                if ($q['id'] === $id) {
                    $q['status'] = 'paused';
                    self::saveState($state);
                    return ['success' => true, 'status' => self::getState()];
                }
            }
        }

        return ['success' => false, 'error' => 'Descarga no encontrada'];
    }

    /**
     * Resumes a paused download
     */
    public static function resumeDownload(string $id = ''): array {
        $state = self::getState();

        if (!empty($state['currentDownload']) && (empty($id) || $state['currentDownload']['id'] === $id)) {
            $pid = (int)($state['currentDownload']['pid'] ?? 0);
            if ($pid > 0) {
                @shell_exec("kill -CONT {$pid} 2>/dev/null");
            }
            $state['currentDownload']['status'] = 'downloading';
            self::saveState($state);
            return ['success' => true, 'status' => self::getState()];
        }

        if (!empty($id)) {
            foreach ($state['downloadQueue'] as &$q) {
                if ($q['id'] === $id) {
                    $q['status'] = 'pending';
                    self::saveState($state);
                    self::processQueue();
                    return ['success' => true, 'status' => self::getState()];
                }
            }
        }

        // If no active download is running, start next in queue
        if (empty($state['currentDownload'])) {
            self::processQueue();
            return ['success' => true, 'status' => self::getState()];
        }

        return ['success' => false, 'error' => 'Descarga no encontrada'];
    }

    /**
     * Removes an item from the queue or cancels it if active
     */
    public static function removeFromQueue(string $idOrIndex): array {
        $state = self::getState();

        // Check if index was passed as integer
        if (is_numeric($idOrIndex)) {
            $idx = (int)$idOrIndex;
            if (isset($state['downloadQueue'][$idx])) {
                array_splice($state['downloadQueue'], $idx, 1);
                self::saveState($state);
                return ['success' => true, 'status' => self::getState()];
            }
        }

        // Check by ID in queue
        foreach ($state['downloadQueue'] as $idx => $q) {
            if ($q['id'] === $idOrIndex) {
                array_splice($state['downloadQueue'], $idx, 1);
                self::saveState($state);
                return ['success' => true, 'status' => self::getState()];
            }
        }

        // If it was active
        if (!empty($state['currentDownload']) && $state['currentDownload']['id'] === $idOrIndex) {
            return self::cancelActiveDownload();
        }

        return ['success' => true, 'status' => self::getState()];
    }

    /**
     * Clears all pending items from download queue
     */
    public static function clearQueue(): array {
        $state = self::getState();
        $state['downloadQueue'] = [];
        self::saveState($state);
        return ['success' => true, 'status' => self::getState()];
    }

    /**
     * Cancels active download process and deletes temporary chunks
     */
    public static function cancelActiveDownload(): array {
        $state = self::getState();
        if (!empty($state['currentDownload'])) {
            $pid = (int)($state['currentDownload']['pid'] ?? 0);
            if ($pid > 0) {
                @shell_exec("kill -9 {$pid} 2>/dev/null");
            }
            if (!empty($state['currentDownload']['logFile'])) {
                @unlink($state['currentDownload']['logFile']);
            }
            $state['currentDownload'] = null;
            self::saveState($state);

            // Trigger next item in queue
            self::processQueue();
        }

        return ['success' => true, 'status' => self::getState()];
    }

    /**
     * Dismisses a torrent GUID or title so auto-scan never re-adds it
     */
    public static function dismissTorrent(string $guidOrTitle): array {
        $state = self::getState();
        if (!in_array($guidOrTitle, $state['dismissed'], true)) {
            $state['dismissed'][] = $guidOrTitle;
            self::saveState($state);
        }
        return ['success' => true, 'dismissed' => $state['dismissed']];
    }
}
