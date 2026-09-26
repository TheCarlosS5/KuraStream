<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/TmdbScraper.php';
require_once __DIR__ . '/FfmpegScanner.php';

class LibraryScanner {
    public static function runScan(): array {
        $lockFile = sys_get_temp_dir() . '/kurastream_scanner.lock';
        $lockFp = @fopen($lockFile, 'c+');
        if (!$lockFp || !@flock($lockFp, LOCK_EX | LOCK_NB)) {
            if ($lockFp) @fclose($lockFp);
            return [
                'success' => false,
                'error' => 'El escaneo de biblioteca ya está en ejecución',
                'scanned_count' => 0,
                'shows_count' => 0
            ];
        }

        try {
            if (!is_dir(LIBRARY_DIR) || !is_readable(LIBRARY_DIR)) {
                return [
                    'success' => false,
                    'error' => 'LIBRARY_DIR no existe o no tiene permisos de lectura',
                    'scanned_count' => 0,
                    'shows_count' => 0
                ];
            }

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
                    $videoFiles = self::findVideoFiles($showPath, $mediaType);
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

                    $tmdbId = (int)($dbShow['tmdb_id'] ?? 0);
                    // If show is missing metadata, attempt TMDB enrichment
                    if (empty($showData['synopsis']) || empty($showData['poster_path']) || empty($showData['director']) || empty($showData['writer']) || empty($showData['cast_members']) || $showData['cast_members'] === '[]') {
                        try {
                            if ($tmdbId <= 0) {
                                $tmdbResults = TmdbScraper::search($cleanTitle, $mediaType);
                                if (!empty($tmdbResults)) {
                                    $first = $tmdbResults[0];
                                    $candTitle = $first['title'] ?? ($first['name'] ?? '');
                                    similar_text(mb_strtolower($cleanTitle), mb_strtolower($candTitle), $similarityPercent);
                                    // If multiple ambiguous candidates exist and similarity is below 65%, do not auto-bind
                                    if (!(count($tmdbResults) > 1 && $similarityPercent < 65.0)) {
                                        $tmdbId = (int)$first['id'];
                                    }
                                }
                            }
                            if ($tmdbId > 0) {
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

                    if ($tmdbId > 0) {
                        $showData['tmdb_id'] = $tmdbId;
                    }
                    DbHelper::saveShow($showData);
                    $showsCount++;

                    if ($tmdbId <= 0 && $mediaType !== 'movie') {
                        try {
                            $tmdbResults = TmdbScraper::search($cleanTitle, $mediaType);
                            if (!empty($tmdbResults)) {
                                $first = $tmdbResults[0];
                                $candTitle = $first['title'] ?? ($first['name'] ?? '');
                                similar_text(mb_strtolower($cleanTitle), mb_strtolower($candTitle), $similarityPercent);
                                if (!(count($tmdbResults) > 1 && $similarityPercent < 65.0)) {
                                    $tmdbId = (int)$first['id'];
                                    DbHelper::updateShowTmdbId($showId, (string)$tmdbId);
                                }
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

                    // Collision detection: group files by season_episode and resolve duplicates honestly
                    $uniqueVideoFiles = [];
                    foreach ($videoFiles as $vf) {
                        $epKey = "S{$vf['season']}_E{$vf['episode']}";
                        if (isset($uniqueVideoFiles[$epKey])) {
                            $existingVf = $uniqueVideoFiles[$epKey];
                            $size1 = @filesize($existingVf['filepath']) ?: 0;
                            $size2 = @filesize($vf['filepath']) ?: 0;
                            error_log("[LibraryScanner] COLISIÓN DETECTADA: Dos archivos mapean al mismo episodio ({$showId} {$epKey}): '{$existingVf['filepath']}' ({$size1} bytes) y '{$vf['filepath']}' ({$size2} bytes). Se conserva el archivo inicial sin sobrescritura destructiva basada en heurísticas de tamaño.");
                        } else {
                            $uniqueVideoFiles[$epKey] = $vf;
                        }
                    }

                    // Process discovered video files
                    foreach ($uniqueVideoFiles as $vf) {
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

                        $fileSize = (int)filesize($fullPath);
                        $fileMtime = (int)@filemtime($fullPath);
                        $realFullPath = realpath($fullPath) ?: $fullPath;
                        $existingReal = !empty($existingEp['filepath']) ? (realpath($existingEp['filepath']) ?: $existingEp['filepath']) : '';
                        $probe = null;

                        // Fingerprint cache check: canonical filepath, size, valid duration, and file_mtime match
                        if (
                            $existingEp 
                            && $realFullPath === $existingReal
                            && !empty($existingEp['duration']) 
                            && (float)$existingEp['duration'] > 0 
                            && (int)($existingEp['size'] ?? 0) === $fileSize
                            && isset($existingEp['file_mtime'])
                            && (int)$existingEp['file_mtime'] === $fileMtime
                        ) {
                            $probe = [
                                'duration' => (float)$existingEp['duration'],
                                'video_codec' => $existingEp['video_codec'] ?? 'unknown',
                                'resolution' => $existingEp['resolution'] ?? 'unknown',
                                'fps' => (float)($existingEp['fps'] ?? 0.0),
                                'audio_tracks' => is_array($existingEp['audio_tracks']) ? $existingEp['audio_tracks'] : json_decode($existingEp['audio_tracks'] ?? '[]', true),
                                'subtitle_tracks' => is_array($existingEp['subtitle_tracks']) ? $existingEp['subtitle_tracks'] : json_decode($existingEp['subtitle_tracks'] ?? '[]', true)
                            ];
                        } else {
                            try {
                                $probe = FfmpegScanner::probeVideo($fullPath);
                            } catch (Throwable $e) {
                                error_log("[LibraryScanner] No se pudo leer el archivo multimedia {$fullPath}: " . $e->getMessage());
                                continue;
                            }
                        }

                        $thumbFilename = "ep_{$season}_{$episode}_thumb.jpg";
                        $thumbLocalPath = $showPath . '/' . $thumbFilename;
                        $thumbUrl = '';

                        if (file_exists($thumbLocalPath) && filesize($thumbLocalPath) > 0) {
                            $thumbUrl = "/library/{$dirName}/{$showFolder}/{$thumbFilename}";
                        } else {
                            // Extract percentage-based thumbnail frame (15% of duration, bounded between 5s and 180s)
                            $duration = (float)($probe['duration'] ?? 0.0);
                            $seekSeconds = ($duration > 10.0) ? min(max($duration * 0.15, 5.0), 180.0) : max($duration * 0.2, 1.0);
                            $extracted = FfmpegScanner::extractThumbnail($fullPath, $thumbLocalPath, $seekSeconds);
                            if ($extracted) {
                                $thumbUrl = "/library/{$dirName}/{$showFolder}/{$thumbFilename}";
                            } else if (!empty($tmdbStill)) {
                                $thumbUrl = $tmdbStill;
                            }
                        }

                        DbHelper::saveEpisode([
                            'id' => $epId,
                            'show_id' => $showId,
                            'season_number' => $season,
                            'episode_number' => $episode,
                            'title' => $epTitle,
                            'synopsis' => $epSynopsis,
                            'filepath' => $fullPath,
                            'duration' => $probe['duration'],
                            'size' => $fileSize,
                            'file_mtime' => $fileMtime,
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

            // DB reconciliation: mark missing files instead of destructive delete
            try {
                $db = Database::getConnection();
                $stmt = $db->query("SELECT id, filepath FROM episodes");
                $allEps = $stmt->fetchAll(PDO::FETCH_ASSOC);
                $updateMissingStmt = $db->prepare("
                    UPDATE episodes 
                    SET availability_status = 'missing',
                        missing_scan_count = missing_scan_count + 1,
                        missing_since = COALESCE(missing_since, NOW())
                    WHERE id = :id
                ");
                foreach ($allEps as $dbEp) {
                    if (!empty($dbEp['filepath']) && !file_exists($dbEp['filepath'])) {
                        $updateMissingStmt->execute(['id' => $dbEp['id']]);
                    }
                }
            } catch (Throwable $e) {
                error_log("[LibraryScanner] DB reconciliation error: " . $e->getMessage());
            }

            return [
                'success' => true, 
                'scanned_count' => $scannedCount,
                'shows_count' => $showsCount
            ];
        } finally {
            if ($lockFp) {
                @flock($lockFp, LOCK_UN);
                @fclose($lockFp);
                @unlink($lockFile);
            }
        }
    }

    /**
     * Library Scan Depth Specification:
     * The scanner inspects media files across two distinct directory depth tiers:
     * Tier 1 (Show Root): Files directly inside the show directory (e.g. /library/anime/ShowName/Episode 01.mp4).
     * Tier 2 (Season Subfolder): Exactly one subfolder level deep for season organization (e.g. /library/anime/ShowName/Season 1/Episode 01.mp4).
     * Deeper nested directory trees (>1 subfolder) are intentionally ignored to prevent infinite loops, performance bottlenecks, and non-canonical episode naming.
     */
    private static function findVideoFiles(string $showPath, string $mediaType = 'anime'): array {
        $results = [];
        $validExts = ['mkv', 'mp4', 'avi', 'webm', 'mov'];

        $realShowRoot = realpath($showPath);
        if (!$realShowRoot || !is_dir($realShowRoot)) {
            return $results;
        }

        $entries = array_diff(scandir($showPath), ['.', '..']);
        foreach ($entries as $entry) {
            $itemPath = $showPath . '/' . $entry;
            $realItemPath = realpath($itemPath);
            if (!$realItemPath || !str_starts_with($realItemPath, $realShowRoot)) {
                error_log("[LibraryScanner] Enlace simbólico o ruta externa ignorada por seguridad: '{$itemPath}'");
                continue;
            }

            if (is_dir($itemPath)) {
                $seasonNum = self::parseSeasonNumber($entry);

                $subFiles = array_diff(scandir($itemPath), ['.', '..']);
                foreach ($subFiles as $subFile) {
                    $ext = strtolower(pathinfo($subFile, PATHINFO_EXTENSION));
                    if (!in_array($ext, $validExts)) continue;

                    $subFilePath = $itemPath . '/' . $subFile;
                    $realSubFilePath = realpath($subFilePath);
                    if (!$realSubFilePath || !str_starts_with($realSubFilePath, $realShowRoot)) {
                        error_log("[LibraryScanner] Enlace simbólico o ruta externa ignorada por seguridad: '{$subFilePath}'");
                        continue;
                    }

                    // If episode filename contains an explicit season (e.g. S02E05), use it
                    $fileSeason = self::parseSeasonFromFilename($subFile);
                    $effectiveSeason = ($fileSeason !== null) ? $fileSeason : $seasonNum;
                    $epNum = self::parseEpisodeNumber($subFile);

                    if ($epNum === null) {
                        if ($mediaType === 'movie') {
                            $epNum = 1;
                        } else {
                            error_log("[LibraryScanner] Archivo ignorado: no se pudo detectar el número de episodio para '{$subFile}'");
                            continue;
                        }
                    }

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

                if ($epNum === null) {
                    if ($mediaType === 'movie') {
                        $epNum = 1;
                    } else {
                        error_log("[LibraryScanner] Archivo ignorado: no se pudo detectar el número de episodio para '{$entry}'");
                        continue;
                    }
                }

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

    private static function parseEpisodeNumber(string $filename): ?int {
        // Strip out resolution, year, codec tokens first so numbers like 1080p, 720p, 2024 don't get matched as episode numbers
        $clean = preg_replace('/(\b\d{4}p\b|\b\d{3,4}p\b|\b(19|20)\d{2}\b|x264|x265|hevc|h264|h265|10bit|8bit|aac|ac3|dts)/i', ' ', $filename);

        if (preg_match('/(?:S\d+)?E(\d+)/i', $clean, $m)) {
            return (int)$m[1];
        }
        if (preg_match('/(?:\d+x)(\d+)/i', $clean, $m)) {
            return (int)$m[1];
        }
        if (preg_match('/(?:Cap[ıí]tulo|Cap\.?|Episodio|Ep\.?)\s*(\d+)/i', $clean, $m)) {
            return (int)$m[1];
        }
        if (preg_match('/(?:-\s*|\s+#)(\d+)(?:\s|\.|\[|\(|$)/i', $clean, $m)) {
            return (int)$m[1];
        }
        if (preg_match('/(?:\b|_|-)(\d{1,3})(?:\b|_|\.|\))/i', $clean, $m)) {
            return (int)$m[1];
        }
        return null;
    }
}
