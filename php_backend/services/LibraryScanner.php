<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/TmdbScraper.php';
require_once __DIR__ . '/FfmpegScanner.php';

class LibraryScanner {
    public static function runScan(): array {
        $categories = [
            'Anime' => 'anime',
            'Movies' => 'movie'
        ];

        $scannedCount = 0;

        foreach ($categories as $dirName => $mediaType) {
            $catPath = LIBRARY_DIR . '/' . $dirName;
            if (!is_dir($catPath)) {
                @mkdir($catPath, 0755, true);
            }
            if (!is_dir($catPath)) continue;

            $showsDirs = array_diff(scandir($catPath), ['.', '..']);
            foreach ($showsDirs as $showFolder) {
                $showPath = $catPath . '/' . $showFolder;
                if (!is_dir($showPath)) continue;

                $cleanTitle = str_replace('_', ' ', $showFolder);
                $dbShow = DbHelper::getShow($showFolder);
                
                $showData = [
                    'id' => $dbShow['id'] ?? (string)crc32($showFolder),
                    'title' => $dbShow['title'] ?? $cleanTitle,
                    'synopsis' => $dbShow['synopsis'] ?? '',
                    'rating' => $dbShow['rating'] ?? 0.0,
                    'year' => $dbShow['year'] ?? null,
                    'media_type' => $mediaType,
                    'poster_path' => file_exists($showPath . '/poster.jpg') ? "/library/{$dirName}/{$showFolder}/poster.jpg" : ($dbShow['poster_path'] ?? ''),
                    'backdrop_path' => file_exists($showPath . '/backdrop.jpg') ? "/library/{$dirName}/{$showFolder}/backdrop.jpg" : ($dbShow['backdrop_path'] ?? ''),
                    'status' => $dbShow['status'] ?? 'finished'
                ];

                DbHelper::saveShow($showData);

                // Scan video files
                $files = array_diff(scandir($showPath), ['.', '..']);
                foreach ($files as $file) {
                    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
                    if (!in_array($ext, ['mkv', 'mp4', 'avi', 'webm', 'mov'])) continue;

                    $fullPath = $showPath . '/' . $file;
                    $season = 1;
                    $episode = 1;

                    if (preg_match('/S(\d+)E(\d+)/i', $file, $m)) {
                        $season = (int)$m[1];
                        $episode = (int)$m[2];
                    } else if (preg_match('/Cap[ıí]tulo\s*(\d+)/i', $file, $m) || preg_match('/Cap\s*(\d+)/i', $file, $m)) {
                        $episode = (int)$m[1];
                    }

                    $epId = $showData['id'] . "_S{$season}_E{$episode}";
                    $probe = FfmpegScanner::probeVideo($fullPath);

                    DbHelper::saveEpisode([
                        'id' => $epId,
                        'show_id' => $showData['id'],
                        'season_number' => $season,
                        'episode_number' => $episode,
                        'title' => "Capítulo {$episode}",
                        'filepath' => $fullPath,
                        'duration' => $probe['duration'],
                        'size' => filesize($fullPath),
                        'video_codec' => $probe['video_codec'],
                        'resolution' => $probe['resolution'],
                        'fps' => $probe['fps'],
                        'audio_tracks' => $probe['audio_tracks'],
                        'subtitle_tracks' => $probe['subtitle_tracks']
                    ]);
                    $scannedCount++;
                }
            }
        }

        return ['success' => true, 'scanned_count' => $scannedCount];
    }
}
