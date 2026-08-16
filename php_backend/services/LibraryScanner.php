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
        $showsCount = 0;

        foreach ($categories as $dirName => $mediaType) {
            $catPath = LIBRARY_DIR . '/' . $dirName;
            if (!is_dir($catPath)) {
                @mkdir($catPath, 0755, true);
            }
            if (!is_dir($catPath)) continue;

            $showsDirs = array_diff(scandir($catPath), ['.', '..']);
            foreach ($showsDirs as $showFolder) {
                if (str_starts_with($showFolder, '.')) continue;
                $showPath = $catPath . '/' . $showFolder;
                if (!is_dir($showPath)) continue;

                // Discover all video files recursively inside show folder (root and Season subdirectories)
                $videoFiles = self::findVideoFiles($showPath);
                if (empty($videoFiles)) {
                    continue; // Skip folders that contain no video files
                }

                $cleanTitle = preg_replace('/(\[.*?\]|\(.*?\)|1080p|720p|4k|2160p|hevc|x264|x265|aac|dvdrip|web-dl|bluray|bdrip|latino|sub|esp|dual)/i', '', $showFolder);
                $cleanTitle = trim(preg_replace('/[._\-+]+/', ' ', $cleanTitle));
                if (empty($cleanTitle)) $cleanTitle = str_replace('_', ' ', $showFolder);
                
                $dbShow = DbHelper::findShowByFolderOrTitle($showFolder, $cleanTitle);
                $showId = $dbShow['id'] ?? $showFolder;

                $posterPath = file_exists($showPath . '/poster.jpg') 
                    ? "/library/{$dirName}/{$showFolder}/poster.jpg" 
                    : (file_exists($showPath . '/poster.png') ? "/library/{$dirName}/{$showFolder}/poster.png" : ($dbShow['poster_path'] ?? ''));

                $backdropPath = file_exists($showPath . '/backdrop.jpg') 
                    ? "/library/{$dirName}/{$showFolder}/backdrop.jpg" 
                    : ($dbShow['backdrop_path'] ?? '');

                $showData = [
                    'id' => $showId,
                    'title' => $dbShow['title'] ?? $cleanTitle,
                    'synopsis' => $dbShow['synopsis'] ?? '',
                    'rating' => $dbShow['rating'] ?? 0.0,
                    'year' => $dbShow['year'] ?? null,
                    'studio' => $dbShow['studio'] ?? '',
                    'director' => $dbShow['director'] ?? '',
                    'writer' => $dbShow['writer'] ?? '',
                    'cast_members' => $dbShow['cast_members'] ?? '[]',
                    'poster_path' => $posterPath,
                    'backdrop_path' => $backdropPath,
                    'media_type' => $mediaType,
                    'backdrop_loops' => $dbShow['backdrop_loops'] ?? '[]',
                    'genres' => $dbShow['genres'] ?? '',
                    'trailer_key' => $dbShow['trailer_key'] ?? null,
                    'age_rating' => $dbShow['age_rating'] ?? 'TV-14',
                    'status' => $dbShow['status'] ?? 'finished'
                ];

                $tmdbId = 0;
                // If show is missing metadata, attempt TMDB enrichment
                if (empty($showData['synopsis']) || empty($showData['poster_path']) || empty($showData['director']) || empty($showData['writer']) || empty($showData['cast_members']) || $showData['cast_members'] === '[]') {
                    try {
                        $tmdbResults = TmdbScraper::search($cleanTitle, $mediaType);
                        if (!empty($tmdbResults)) {
                            $first = $tmdbResults[0];
                            $tmdbId = (int)$first['id'];
                            $details = TmdbScraper::getDetails($tmdbId, $mediaType);
                            if ($details) {
                                if (empty($showData['synopsis'])) $showData['synopsis'] = $details['synopsis'] ?? '';
                                if ($showData['rating'] == 0) $showData['rating'] = $details['rating'] ?? 0.0;
                                if ($showData['year'] === null) $showData['year'] = $details['year'] ?? null;
                                if (empty($showData['studio']) || in_array($showData['studio'], ['Nippon TV', 'Tokyo MX', 'TV Tokyo', 'AT-X', 'TBS'])) {
                                    if (!empty($details['studio'])) $showData['studio'] = $details['studio'];
                                }
                                if (empty($showData['director']) && !empty($details['director'])) {
                                    $showData['director'] = $details['director'];
                                }
                                if (empty($showData['writer']) && !empty($details['writer'])) {
                                    $showData['writer'] = $details['writer'];
                                }
                                if (empty($showData['cast_members']) || $showData['cast_members'] === '[]') {
                                    $showData['cast_members'] = $details['cast_members'] ?? [];
                                }
                                if (empty($showData['genres']) && !empty($details['genres'])) {
                                    $showData['genres'] = $details['genres'];
                                }
                                if (empty($showData['trailer_key']) && !empty($details['trailer_key'])) {
                                    $showData['trailer_key'] = $details['trailer_key'];
                                }
                                if (empty($showData['poster_path']) && !empty($details['poster_path'])) {
                                    $showData['poster_path'] = $details['poster_path'];
                                }
                                if (empty($showData['backdrop_path']) && !empty($details['backdrop_path'])) {
                                    $showData['backdrop_path'] = $details['backdrop_path'];
                                }
                                if (!empty($details['status'])) $showData['status'] = $details['status'];
                            }
                        }
                    } catch (Throwable $e) {
                        // Ignore network/TMDB errors gracefully
                    }
                }

                DbHelper::saveShow($showData);
                $showsCount++;

                if ($tmdbId <= 0 && $mediaType !== 'movie') {
                    try {
                        $tmdbResults = TmdbScraper::search($cleanTitle, $mediaType);
                        if (!empty($tmdbResults)) {
                            $tmdbId = (int)$tmdbResults[0]['id'];
                        }
                    } catch (Throwable $e) {}
                }

                $seasonEpsCache = [];
                if ($tmdbId > 0 && $mediaType !== 'movie') {
                    // Pre-fetch seasons for episode names and synopses
                    foreach ($videoFiles as $vf) {
                        $s = (int)$vf['season'];
                        if (!isset($seasonEpsCache[$s])) {
                            try {
                                $seasonEpsCache[$s] = TmdbScraper::getSeasonEpisodes($tmdbId, $s);
                            } catch (Throwable $e) {
                                $seasonEpsCache[$s] = [];
                            }
                        }
                    }
                }

                // Process discovered video files
                foreach ($videoFiles as $vf) {
                    $fullPath = $vf['filepath'];
                    $season = $vf['season'];
                    $episode = $vf['episode'];

                    $epId = "{$showId}_S{$season}_E{$episode}";
                    $existingEp = DbHelper::getEpisode($epId);

                    $epTitle = "Capítulo {$episode}";
                    $epSynopsis = '';
                    $tmdbStill = '';

                    if (!empty($seasonEpsCache[$season][$episode])) {
                        $meta = $seasonEpsCache[$season][$episode];
                        if (!empty($meta['title'])) $epTitle = $meta['title'];
                        if (!empty($meta['synopsis'])) $epSynopsis = $meta['synopsis'];
                        if (!empty($meta['still_path'])) $tmdbStill = $meta['still_path'];
                    }

                    if ($existingEp) {
                        // Preserve custom title only if it is not the default generic fallback
                        if (!empty($existingEp['title']) && !preg_match('/^Cap[ií]tulo\s+\d+$/i', trim($existingEp['title'])) && $existingEp['title'] !== "Capítulo {$episode}") {
                            $epTitle = $existingEp['title'];
                        }
                        if (!empty($existingEp['synopsis'])) {
                            $epSynopsis = $existingEp['synopsis'];
                        }
                    }

                    $thumbFilename = "ep_{$season}_{$episode}_thumb.jpg";
                    $thumbLocalPath = $showPath . '/' . $thumbFilename;
                    $thumbUrl = '';

                    if (file_exists($thumbLocalPath) && filesize($thumbLocalPath) > 0) {
                        $thumbUrl = "/library/{$dirName}/{$showFolder}/{$thumbFilename}";
                    } else {
                        // Extract thumbnail frame at 120s
                        $extracted = FfmpegScanner::extractThumbnail($fullPath, $thumbLocalPath, 120.0);
                        if ($extracted) {
                            $thumbUrl = "/library/{$dirName}/{$showFolder}/{$thumbFilename}";
                        } else if (!empty($tmdbStill)) {
                            $thumbUrl = $tmdbStill;
                        }
                    }

                    $probe = FfmpegScanner::probeVideo($fullPath);

                    DbHelper::saveEpisode([
                        'id' => $epId,
                        'show_id' => $showId,
                        'season_number' => $season,
                        'episode_number' => $episode,
                        'title' => $epTitle,
                        'synopsis' => $epSynopsis,
                        'filepath' => $fullPath,
                        'duration' => $probe['duration'],
                        'size' => filesize($fullPath),
                        'video_codec' => $probe['video_codec'],
                        'resolution' => $probe['resolution'],
                        'fps' => $probe['fps'],
                        'audio_tracks' => $probe['audio_tracks'],
                        'subtitle_tracks' => $probe['subtitle_tracks'],
                        'thumbnail_path' => $thumbUrl
                    ]);
                    $scannedCount++;
                }
            }
        }

        return [
            'success' => true, 
            'scanned_count' => $scannedCount,
            'shows_count' => $showsCount
        ];
    }

    private static function findVideoFiles(string $showPath): array {
        $results = [];
        $validExts = ['mkv', 'mp4', 'avi', 'webm', 'mov'];

        $entries = array_diff(scandir($showPath), ['.', '..']);
        foreach ($entries as $entry) {
            $itemPath = $showPath . '/' . $entry;
            if (is_dir($itemPath)) {
                $seasonNum = self::parseSeasonNumber($entry);

                $subFiles = array_diff(scandir($itemPath), ['.', '..']);
                foreach ($subFiles as $subFile) {
                    $ext = strtolower(pathinfo($subFile, PATHINFO_EXTENSION));
                    if (!in_array($ext, $validExts)) continue;

                    $subFilePath = $itemPath . '/' . $subFile;
                    // If episode filename contains an explicit season (e.g. S02E05), use it
                    $fileSeason = self::parseSeasonFromFilename($subFile);
                    $effectiveSeason = ($fileSeason !== null) ? $fileSeason : $seasonNum;
                    $epNum = self::parseEpisodeNumber($subFile);

                    $results[] = [
                        'filepath' => $subFilePath,
                        'season' => $effectiveSeason,
                        'episode' => $epNum
                    ];
                }
            } else if (is_file($itemPath)) {
                $ext = strtolower(pathinfo($entry, PATHINFO_EXTENSION));
                if (!in_array($ext, $validExts)) continue;

                $fileSeason = self::parseSeasonFromFilename($entry);
                $seasonNum = ($fileSeason !== null) ? $fileSeason : 1;
                $epNum = self::parseEpisodeNumber($entry);

                $results[] = [
                    'filepath' => $itemPath,
                    'season' => $seasonNum,
                    'episode' => $epNum
                ];
            }
        }

        return $results;
    }

    private static function parseSeasonNumber(string $folderName): int {
        if (preg_match('/(?:Season|Temporada|Temp\.?)\s*(\d+)/i', $folderName, $sm)) {
            return (int)$sm[1];
        }
        if (preg_match('/^(?:S|T)(\d+)$/i', trim($folderName), $sm)) {
            return (int)$sm[1];
        }
        if (preg_match('/(?:Specials|Especiales|OVA|OVAs|SP)/i', $folderName)) {
            return 0;
        }
        return 1;
    }

    private static function parseSeasonFromFilename(string $filename): ?int {
        if (preg_match('/S(\d+)E\d+/i', $filename, $m)) {
            return (int)$m[1];
        }
        if (preg_match('/(\d+)x\d+/i', $filename, $m)) {
            return (int)$m[1];
        }
        if (preg_match('/(?:Temporada|Temp\.?)\s*(\d+)/i', $filename, $m)) {
            return (int)$m[1];
        }
        return null;
    }

    private static function parseEpisodeNumber(string $filename): int {
        if (preg_match('/(?:S\d+)?E(\d+)/i', $filename, $m)) {
            return (int)$m[1];
        }
        if (preg_match('/(?:\d+x)(\d+)/i', $filename, $m)) {
            return (int)$m[1];
        }
        if (preg_match('/(?:Cap[ıí]tulo|Cap\.?|Episodio|Ep\.?)\s*(\d+)/i', $filename, $m)) {
            return (int)$m[1];
        }
        if (preg_match('/(?:-\s*|\s+#)(\d+)(?:\s|\.|\[|\(|$)/i', $filename, $m)) {
            return (int)$m[1];
        }
        return 1;
    }
}
