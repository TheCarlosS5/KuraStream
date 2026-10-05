<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/ShowController.php';
require_once __DIR__ . '/PartyController.php';
require_once __DIR__ . '/../middleware/AuthMiddleware.php';

class TranscodeLimiter {
    public static int $maxWorkers = 8;
    private static array $activeLocks = [];

    public static function acquireSlot(int $timeoutSeconds = 2): bool {
        $slotDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'kura_transcode_slots';
        if (!is_dir($slotDir)) {
            @mkdir($slotDir, 0777, true);
        }

        $start = time();
        do {
            for ($i = 0; $i < self::$maxWorkers; $i++) {
                if (isset(self::$activeLocks[$i])) {
                    continue; // Already holding this slot in this process
                }
                $file = $slotDir . DIRECTORY_SEPARATOR . "worker_{$i}.lock";
                $fp = @fopen($file, 'c+');
                if ($fp && flock($fp, LOCK_EX | LOCK_NB)) {
                    self::$activeLocks[$i] = $fp;
                    return true;
                }
                if ($fp) {
                    fclose($fp);
                }
            }
            if ($timeoutSeconds > 0) {
                usleep(50000); // 50ms
            }
        } while (time() - $start < $timeoutSeconds);

        return false;
    }

    public static function releaseSlot(): void {
        if (!empty(self::$activeLocks)) {
            $keys = array_keys(self::$activeLocks);
            $lastIndex = end($keys);
            $fp = self::$activeLocks[$lastIndex];
            @flock($fp, LOCK_UN);
            @fclose($fp);
            unset(self::$activeLocks[$lastIndex]);
        }
    }

    public static function getActiveWorkerCount(): int {
        $slotDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'kura_transcode_slots';
        if (!is_dir($slotDir)) {
            return 0;
        }
        $active = 0;
        for ($i = 0; $i < self::$maxWorkers; $i++) {
            if (isset(self::$activeLocks[$i])) {
                $active++;
                continue;
            }
            $file = $slotDir . DIRECTORY_SEPARATOR . "worker_{$i}.lock";
            if (!file_exists($file)) continue;
            $fp = @fopen($file, 'c+');
            if ($fp) {
                if (!flock($fp, LOCK_EX | LOCK_NB)) {
                    $active++;
                } else {
                    @flock($fp, LOCK_UN);
                }
                @fclose($fp);
            }
        }
        return $active;
    }

    public static function resetAllSlots(): void {
        foreach (self::$activeLocks as $fp) {
            @flock($fp, LOCK_UN);
            @fclose($fp);
        }
        self::$activeLocks = [];

        $slotDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'kura_transcode_slots';
        if (is_dir($slotDir)) {
            $files = glob($slotDir . DIRECTORY_SEPARATOR . 'worker_*.lock');
            if (is_array($files)) {
                foreach ($files as $f) {
                    @unlink($f);
                }
            }
        }
    }
}

class PlayerController {
    public static function authorizeStreamAccess(string $episodeId): void {
        if (defined('TESTING_MODE') && empty($_SERVER['HTTP_AUTHORIZATION']) && empty($_COOKIE['kurastream_token']) && empty($_GET['ticket']) && empty($_GET['capability'])) {
            return;
        }

        // 1. Watch party capability token
        $ticket = $_GET['ticket'] ?? ($_GET['capability'] ?? ($_SERVER['HTTP_X_STREAM_CAPABILITY'] ?? null));
        if (!empty($ticket)) {
            $cap = AuthMiddleware::verifyToken($ticket);
            if ($cap && ($cap['type'] ?? '') === 'watch_party_stream'
                && !empty($cap['room_id'])
                && (!isset($cap['exp']) || $cap['exp'] > time())
            ) {
                if (empty($cap['member_id'])) {
                    jsonError('Ticket de sala expirado o miembro inactivo', 403);
                }

                $member = DbHelper::getPartyMemberById($cap['room_id'], $cap['member_id']);
                if (!$member || !DbHelper::isPartyMemberActive($cap['room_id'], $cap['member_id'])) {
                    jsonError('Ticket de sala expirado o miembro inactivo', 403);
                }

                $room = DbHelper::getPartyRoom($cap['room_id']);
                if (!$room || empty($room['episode_id'])) {
                    jsonError('Sala no encontrada o inactiva', 404);
                }
                if ($room['episode_id'] !== $episodeId) {
                    jsonError('El ticket no corresponde al episodio activo de la sala', 403);
                }

                $currentProfile = PartyController::validatePartyMemberProfileContext($member);
                $isKids = $currentProfile ? !empty($currentProfile['is_kids']) : !empty($member['is_kids']);

                if ($isKids) {
                    $ep = DbHelper::getEpisode($episodeId);
                    if ($ep && !empty($ep['show_id'])) {
                        $show = DbHelper::getShow($ep['show_id']);
                        if ($show && ShowController::isAdultOrMaturityRestricted($show)) {
                            jsonError('Contenido restringido por el perfil infantil activo', 403);
                        }
                    }
                }

                return;
            }
            jsonError('Ticket de reproducción inválido o expirado', 403);
        }

        // 2. Authenticated user session
        $userToken = AuthMiddleware::getBearerToken();
        if (empty($userToken)) {
            jsonError('Autenticación requerida para acceder al flujo de medios', 401);
        }

        $tokenData = AuthMiddleware::verifyToken($userToken);
        if (!$tokenData) {
            jsonError('Token inválido o expirado', 401);
        }

        // Admin preview playback: Allow admin role without requiring active profile
        if (($tokenData['role'] ?? '') === 'admin') {
            return;
        }

        $payload = AuthMiddleware::requireProfile();

        // 3. Kids mode check: enforce restriction if active profile is kids
        if (!empty($payload['is_kids'])) {
            $ep = DbHelper::getEpisode($episodeId);
            if ($ep && !empty($ep['show_id'])) {
                self::checkKidsModeAccess($ep['show_id']);
            }
        }
    }

    public static function checkKidsModeAccess(string $showId): void {
        if (!ShowController::isKidsProfileActive()) {
            return;
        }
        $show = DbHelper::getShow($showId);
        if ($show && ShowController::isAdultOrMaturityRestricted($show)) {
            jsonError('Contenido restringido por el perfil infantil activo', 403);
        }
    }

    public static function getEpisodeDetails(string $id): void {
        $ep = DbHelper::getEpisode($id);
        if (!$ep) {
            jsonError('Episodio no encontrado', 404);
        }
        if (!empty($ep['show_id'])) {
            self::checkKidsModeAccess($ep['show_id']);
        }
        jsonResponse(DbHelper::serializeEpisodeForClient($ep));
    }

    public static function saveTimestamps(string $id): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $success = DbHelper::saveEpisodeTimestamps($id, DbHelper::manualTimings($data));
        if (!$success) {
            jsonError('Episodio no encontrado', 404);
        }

        jsonResponse(['success' => true]);
    }

    /**
     * Extracted subtitles and fonts are regenerated on demand, so anything untouched for a week
     * can go. Runs at most once per hour (marker file) to keep requests cheap.
     */
    public static function pruneCacheDir(string $dir, int $maxAgeSeconds = 604800, int $everySeconds = 3600): int {
        $marker = $dir . '/.last_prune';
        if (is_file($marker) && (time() - (int)@filemtime($marker)) < $everySeconds) {
            return 0;
        }
        @touch($marker);
        $removed = 0;
        try {
            $it = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
                RecursiveIteratorIterator::CHILD_FIRST
            );
            foreach ($it as $file) {
                $path = $file->getPathname();
                if ($path === $marker) continue;
                if ($file->isDir()) {
                    @rmdir($path); // only succeeds once empty
                } elseif ((time() - $file->getMTime()) > $maxAgeSeconds && @unlink($path)) {
                    $removed++;
                }
            }
        } catch (Throwable $e) {
            error_log('pruneCacheDir failed: ' . $e->getMessage());
        }
        return $removed;
    }

    public static function shiftAssTimestamps(string $ass, float $offset): string {
        if ($offset <= 0) return $ass;

        $lines = explode("\n", $ass);
        $result = [];
        foreach ($lines as $line) {
            $lineTrim = trim($line);
            if (str_starts_with($lineTrim, 'Dialogue:')) {
                if (preg_match('/^Dialogue:\s*([^,]+),([^,]+),([^,]+),(.*)$/', $lineTrim, $matches)) {
                    $layer = $matches[1];
                    $startStr = trim($matches[2]);
                    $endStr = trim($matches[3]);
                    $rest = $matches[4];

                    $startSec = self::assTimeToSeconds($startStr) - $offset;
                    $endSec = self::assTimeToSeconds($endStr) - $offset;

                    if ($endSec <= 0) {
                        continue;
                    }
                    if ($startSec < 0) {
                        $startSec = 0;
                    }

                    $newStart = self::secondsToAssTime($startSec);
                    $newEnd = self::secondsToAssTime($endSec);

                    $result[] = "Dialogue: {$layer},{$newStart},{$newEnd},{$rest}";
                } else {
                    $result[] = $lineTrim;
                }
            } else {
                // Keep \r formatting if it existed by re-imploding with original array, but explode uses \n
                // so we just append the original string (minus newline, which explode removed)
                $result[] = str_replace("\r", "", $line);
            }
        }
        // Use CRLF for ASS if the original used it, but \n is fine for webvtt/ass in most players.
        // We will just use \n
        return implode("\n", $result);
    }

    private static function assTimeToSeconds(string $time): float {
        $parts = explode(':', $time);
        if (count($parts) === 3) {
            $h = (float)$parts[0];
            $m = (float)$parts[1];
            $s = (float)$parts[2];
            return $h * 3600 + $m * 60 + $s;
        }
        return 0.0;
    }

    private static function secondsToAssTime(float $seconds): string {
        // Round to whole centiseconds first; formatting a float with %05.2f can yield "60.00".
        $cs = (int)round(max(0.0, $seconds) * 100);
        $h = intdiv($cs, 360000);
        $m = intdiv($cs % 360000, 6000);
        $s = intdiv($cs % 6000, 100);
        return sprintf("%d:%02d:%02d.%02d", $h, $m, $s, $cs % 100);
    }

    public static function streamSubtitle(string $episodeId, $trackNum = 0): void {
        self::authorizeStreamAccess($episodeId);
        $ep = DbHelper::getEpisode($episodeId);
        if (!$ep || empty($ep['filepath']) || !file_exists($ep['filepath'])) {
            @header('Content-Type: text/plain; charset=utf-8');
            echo "";
            if (defined('TESTING_MODE')) throw new ExitException("Subtitle not found", 404);
            exit();
        }

        if (!empty($ep['show_id'])) {
            self::checkKidsModeAccess($ep['show_id']);
        }

        $filepath = $ep['filepath'];
        $trackIndex = -1;
        $tracks = !empty($ep['subtitle_tracks']) ? (is_array($ep['subtitle_tracks']) ? $ep['subtitle_tracks'] : json_decode($ep['subtitle_tracks'], true)) : [];
        $t = null;
        if (is_array($tracks) && count($tracks) > 0) {
            $t = array_values(array_filter($tracks, fn($x) => isset($x['track_number']) && (string)$x['track_number'] === (string)$trackNum))[0] ?? null;
            if (!$t && isset($tracks[(int)$trackNum])) {
                $t = $tracks[(int)$trackNum];
            }
            if (!$t) {
                $t = array_values(array_filter($tracks, fn($x) => isset($x['index']) && (string)$x['index'] === (string)$trackNum))[0] ?? null;
            }
            if ($t && isset($t['index'])) {
                $trackIndex = is_numeric($t['index']) ? (int)$t['index'] : -1;
            }
        }

        if ($t && !empty($t['is_bitmap'])) {
            jsonError('Pista de subtítulos bitmap (PGS/VobSub) no compatible con renderizador de texto libass', 400);
        }

        $cacheDir = sys_get_temp_dir() . '/kura_subs_cache';
        if (!is_dir($cacheDir)) {
            @mkdir($cacheDir, 0777, true);
        }
        self::pruneCacheDir($cacheDir);

        $startOffset = isset($_GET['start']) && is_numeric($_GET['start']) ? (float)$_GET['start'] : 0.0;
        if (!is_finite($startOffset) || $startOffset < 0) {
            $startOffset = 0.0;
        }

        // External sidecar subtitle check (.ass, .ssa, .srt, .vtt)
        if ($t && isset($t['source']) && $t['source'] === 'external' && !empty($t['filepath']) && file_exists($t['filepath'])) {
            $sidecarPath = $t['filepath'];
            $sidecarExt = strtolower(pathinfo($sidecarPath, PATHINFO_EXTENSION));
            if ($sidecarExt === 'ass' || $sidecarExt === 'ssa') {
                @header('Content-Type: text/plain; charset=utf-8');
                setCorsHeaders();
                @header('Cache-Control: public, max-age=86400');
                while (ob_get_level()) { ob_end_clean(); }
                $content = file_get_contents($sidecarPath);
                if ($startOffset > 0) $content = self::shiftAssTimestamps($content, $startOffset);
                echo $content;
                if (defined('TESTING_MODE')) throw new ExitException("Subtitle stream success", 200, $content);
                exit();
            } else {
                // Convert SRT/VTT to ASS and cache
                $sidecarCacheKey = md5($sidecarPath . '_' . filemtime($sidecarPath));
                $sidecarCacheFile = $cacheDir . '/' . $sidecarCacheKey . '.ass';
                if (!file_exists($sidecarCacheFile) || filesize($sidecarCacheFile) === 0) {
                    require_once __DIR__ . '/../services/FfmpegScanner.php';
                    $cmd = sprintf('ffmpeg -y -v error -i %s -f ass %s', escapeshellarg($sidecarPath), escapeshellarg($sidecarCacheFile));
                    FfmpegScanner::executeBoundedCommand($cmd, 15);
                }
                if (file_exists($sidecarCacheFile) && filesize($sidecarCacheFile) > 0) {
                    @header('Content-Type: text/plain; charset=utf-8');
                    setCorsHeaders();
                    @header('Cache-Control: public, max-age=86400');
                    while (ob_get_level()) { ob_end_clean(); }
                    $content = file_get_contents($sidecarCacheFile);
                    if ($startOffset > 0) $content = self::shiftAssTimestamps($content, $startOffset);
                    echo $content;
                    if (defined('TESTING_MODE')) throw new ExitException("Subtitle stream success", 200, $content);
                    exit();
                }
            }
        }

        $cacheKey = md5($filepath . '_' . $trackIndex . '_' . (int)$trackNum . '_' . @filemtime($filepath));
        $cacheFile = $cacheDir . '/' . $cacheKey . '.ass';

        @header('Content-Type: text/plain; charset=utf-8');
        setCorsHeaders();
        @header('Cache-Control: public, max-age=86400');

        while (ob_get_level()) {
            ob_end_clean();
        }

        if (file_exists($cacheFile) && filesize($cacheFile) > 0) {
            $content = file_get_contents($cacheFile);
            if ($startOffset > 0) $content = self::shiftAssTimestamps($content, $startOffset);
            echo $content;
            if (defined('TESTING_MODE')) throw new ExitException("Subtitle stream cached success", 200, $content);
            exit();
        }

        $mapArg = ($trackIndex !== -1) ? "-map 0:{$trackIndex}" : "-map 0:s:" . (int)$trackNum . "?";
        $cmd = sprintf('ffmpeg -y -v error -i %s %s -f ass %s', escapeshellarg($filepath), $mapArg, escapeshellarg($cacheFile));

        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w']
        ];
        $subProc = @proc_open($cmd, $descriptors, $pipes);
        if (is_resource($subProc)) {
            @fclose($pipes[0]);
            $subStart = time();
            $subTimeout = 20; // 20s hard timeout
            while (time() - $subStart < $subTimeout) {
                $status = proc_get_status($subProc);
                if (!$status['running']) {
                    break;
                }
                usleep(50000);
            }
            $status = proc_get_status($subProc);
            if ($status['running']) {
                @proc_terminate($subProc, 9);
            }
            @fclose($pipes[1]);
            @fclose($pipes[2]);
            @proc_close($subProc);
        }

        if (file_exists($cacheFile) && filesize($cacheFile) > 0) {
            $content = file_get_contents($cacheFile);
            if ($startOffset > 0) $content = self::shiftAssTimestamps($content, $startOffset);
            echo $content;
            if (defined('TESTING_MODE')) throw new ExitException("Subtitle stream success", 200, $content);
        } else {
            @http_response_code(404);
            echo "Subtitle track not available";
            if (defined('TESTING_MODE')) throw new ExitException("Subtitle not found", 404);
        }
        exit();
    }

    public static function streamVideo(?string $episodeId = null): void {
        $episodeId = $episodeId ?: ($_GET['id'] ?? ($_GET['episode_id'] ?? ''));
        if (empty($episodeId) || str_contains($episodeId, '/') || str_contains($episodeId, '\\')) {
            jsonError('Identificador de episodio inválido', 400);
        }

        self::authorizeStreamAccess($episodeId);

        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM episodes WHERE id = :id");
        $stmt->execute(['id' => $episodeId]);
        $ep = $stmt->fetch();

        if (!$ep) {
            jsonError('Episodio no encontrado en el catálogo', 404);
        }

        if (!empty($ep['show_id'])) {
            self::checkKidsModeAccess($ep['show_id']);
        }

        $realPath = realpath($ep['filepath'] ?? '');
        $realLibrary = realpath(LIBRARY_DIR);

        if (!$realPath || !file_exists($realPath) || !is_file($realPath)) {
            @http_response_code(404);
            echo "Video file not found";
            if (defined('TESTING_MODE')) throw new ExitException("Video file not found", 404);
            exit();
        }

        // Ensure the path is strictly within the library directory
        $libraryPrefix = rtrim($realLibrary, '/\\') . DIRECTORY_SEPARATOR;
        if (!$realLibrary || ($realPath !== $realLibrary && !str_starts_with($realPath, $libraryPrefix))) {
            @http_response_code(403);
            echo "Access denied: File must reside within the library directory";
            if (defined('TESTING_MODE')) throw new ExitException("Access denied: File must reside within the library directory", 403);
            exit();
        }

        $ext = strtolower(pathinfo($realPath, PATHINFO_EXTENSION));
        $isMkv = ($ext === 'mkv');
        $start = isset($_GET['start']) ? (float)$_GET['start'] : 0.0;
        $audioTrack = isset($_GET['audio']) ? (int)$_GET['audio'] : -1;

        $epData = $ep;
        $tracks = !empty($epData['audio_tracks']) ? (is_array($epData['audio_tracks']) ? $epData['audio_tracks'] : json_decode($epData['audio_tracks'], true)) : [];
        $videoCodec = strtolower($epData['video_codec'] ?? '');
        $isDirectCodec = ($videoCodec === '' || $videoCodec === 'h264' || $videoCodec === 'avc1' || $videoCodec === 'avc');
        $isDirectContainer = ($ext === 'mp4' || $ext === 'webm' || $ext === 'm4v');
        $isDownmixRequested = (isset($_GET['downmix']) && $_GET['downmix'] === 'stereo');
        $isForceTranscode = isset($_GET['transcode']) && $_GET['transcode'] == '1';

        if (!is_array($tracks)) {
            $tracks = [];
        }
        $isDefaultAudio = ($audioTrack <= 0 || count($tracks) <= 1);

        // Can we Direct Play using HTTP Range?
        $canDirectPlay = $isDirectContainer && $isDirectCodec && $isDefaultAudio && !$isDownmixRequested && !$isForceTranscode && ($start <= 0);

        $isHead = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD';

        // If file is not direct-playable (MKV container, seek offset, non-default audio track, or downmix):
        if (!$canDirectPlay) {
            $isPreview = isset($_GET['preview']) || (isset($_SERVER['HTTP_X_PURPOSE']) && $_SERVER['HTTP_X_PURPOSE'] === 'preview');
            if ($isPreview) {
                @http_response_code(403);
                echo "Live transcode stream not permitted for timeline preview";
                if (defined('TESTING_MODE')) throw new ExitException("Preview transcode forbidden", 403);
                exit();
            }

            @header('Content-Type: video/mp4');
            @header('Connection: keep-alive');
            // A live remux has no length and cannot be range-requested. Without no-store the browser
            // tried to write it into its HTTP cache, failed (ERR_CACHE_WRITE_FAILURE) and treated the
            // failure as the end of the video.
            @header('Cache-Control: no-store');
            @header('Accept-Ranges: none');
            setCorsHeaders();
            @header('X-Content-Type-Options: nosniff');

            if ($isHead) {
                if (defined('TESTING_MODE')) throw new ExitException("Stream remux HEAD success", 200);
                exit();
            }

            // Concurrency guard for FFmpeg transcode workers
            if (!TranscodeLimiter::acquireSlot(2)) {
                @http_response_code(503);
                @header('Retry-After: 5');
                echo "Servidor de transcodificación ocupado, por favor intenta en unos instantes.";
                if (defined('TESTING_MODE')) throw new ExitException("Transcode limiter busy", 503);
                exit();
            }
            register_shutdown_function([TranscodeLimiter::class, 'releaseSlot']);

            // -readrate paces the remux at 2x real time after a 20 s burst. Unpaced, a stream copy
            // finished the whole episode in seconds and pushed hundreds of MB at a browser that
            // cannot seek in it; its media cache gave up and playback "ended" ~35 s in.
            $cmd = 'ffmpeg -v error -readrate 2 -readrate_initial_burst 20 -fflags +nobuffer+fastseek -probesize 1M -analyzeduration 1M ';
            if ($start > 0) {
                $startStr = (fmod($start, 1) !== 0.0) ? number_format($start, 3, '.', '') : strval((int)$start);
                $cmd .= '-ss ' . escapeshellarg($startStr) . ' ';
            }
            $cmd .= '-i ' . escapeshellarg($realPath) . ' ';
            $cmd .= '-map 0:v:0 ';
            
            // Map selected audio track or default to first audio stream
            $mappedAudio = false;
            $selectedTrackMeta = null;
            if ($audioTrack >= 0 && !empty($episodeId)) {
                $epData = $ep;
                $tracks = !empty($epData['audio_tracks']) ? (is_array($epData['audio_tracks']) ? $epData['audio_tracks'] : json_decode($epData['audio_tracks'], true)) : [];
                if (is_array($tracks) && count($tracks) > 0) {
                    // Match by track_number first, then array offset, then container stream index
                    $targetTrack = array_values(array_filter($tracks, fn($x) => isset($x['track_number']) && (int)$x['track_number'] === $audioTrack))[0] ?? null;
                    if (!$targetTrack && isset($tracks[$audioTrack])) {
                        // Match by array offset
                        $targetTrack = $tracks[$audioTrack];
                    }
                    if (!$targetTrack) {
                        // Fallback: match by container stream index
                        $targetTrack = array_values(array_filter($tracks, fn($x) => isset($x['index']) && (int)$x['index'] === $audioTrack))[0] ?? null;
                    }
                    if ($targetTrack && isset($targetTrack['index'])) {
                        $cmd .= "-map 0:" . intval($targetTrack['index']) . "? ";
                        $mappedAudio = true;
                        $selectedTrackMeta = $targetTrack;
                    }
                }
            }
            if (!$mappedAudio) {
                if ($audioTrack >= 0) {
                    $cmd .= "-map 0:a:{$audioTrack}? ";
                } else {
                    $cmd .= '-map 0:a:0? ';
                }
            }

            $epData = $ep;
            $videoCodec = strtolower($epData['video_codec'] ?? '');
            $forceH264 = isset($_GET['codec']) && strtolower($_GET['codec']) === 'h264';
            $needTranscodeVideo = $forceH264 || ($videoCodec !== '' && $videoCodec !== 'h264' && $videoCodec !== 'avc1' && $videoCodec !== 'avc');

            $vCodecArg = $needTranscodeVideo
                ? '-vf "scale=min(iw\\,1280):-2" -c:v libx264 -preset ultrafast -tune fastdecode,zerolatency -crf 25 -pix_fmt yuv420p'
                : '-c:v copy';

            // Audio downmix check
            $needsDownmix = (isset($_GET['downmix']) && $_GET['downmix'] === 'stereo');
            if (!$needsDownmix && $selectedTrackMeta && isset($selectedTrackMeta['channels']) && (int)$selectedTrackMeta['channels'] > 2) {
                $needsDownmix = true;
            }

            $trackAudioCodec = strtolower($selectedTrackMeta['codec'] ?? '');
            if (!$trackAudioCodec && !empty($tracks[0]['codec'])) {
                $trackAudioCodec = strtolower($tracks[0]['codec']);
            }
            $canCopyAudio = !$needsDownmix && ($trackAudioCodec === 'aac' || $trackAudioCodec === 'mp4a');

            $acArg = $needsDownmix ? '-ac 2 ' : '';
            $afFilter = $needsDownmix
                ? 'pan=stereo|c0=c0+0.707*c2+0.707*c4|c1=c1+0.707*c2+0.707*c5,aresample=async=1'
                : 'aresample=async=1';

            $aCodecArg = $canCopyAudio
                ? '-c:a copy '
                : ('-c:a aac ' . $acArg . '-b:a 192k -af ' . escapeshellarg($afFilter) . ' ');

            $cmd .= $vCodecArg . ' ' . $aCodecArg . '-avoid_negative_ts make_zero -f mp4 -movflags frag_keyframe+empty_moov+default_base_moof -flush_packets 1 -';

            if (defined('TESTING_MODE')) {
                throw new ExitException("Stream remux success", 200, ['cmd' => $cmd, 'needs_downmix' => $needsDownmix]);
            }

            while (ob_get_level()) {
                ob_end_clean();
            }

            @ignore_user_abort(true);

            // Stream chunks in real-time with managed subprocess lifecycle and timeout
            $descriptors = [
                0 => ['pipe', 'r'],
                1 => ['pipe', 'w'],
                2 => ['pipe', 'w']
            ];

            $process = @proc_open($cmd, $descriptors, $pipes);
            if (is_resource($process)) {
                @fclose($pipes[0]);
                stream_set_blocking($pipes[1], false);
                stream_set_blocking($pipes[2], false);

                $streamTimeout = 7200; // 2 hours max per transcode stream
                $streamStart = time();
                $stderrTail = '';

                try {
                    while (!feof($pipes[1])) {
                        if (connection_aborted() || (time() - $streamStart > $streamTimeout)) {
                            break;
                        }
                        $read = [$pipes[1]];
                        $write = null;
                        $except = null;
                        // Drain stderr so a chatty ffmpeg can never block on a full pipe; keep the tail for the log.
                        $errChunk = @fread($pipes[2], 8192);
                        if ($errChunk !== false && $errChunk !== '') {
                            $stderrTail = substr($stderrTail . $errChunk, -2000);
                        }
                        $numChanged = @stream_select($read, $write, $except, 0, 25000);
                        if ($numChanged > 0) {
                            $buffer = fread($pipes[1], 16384);
                            if ($buffer !== false && strlen($buffer) > 0) {
                                echo $buffer;
                                if (ob_get_level()) @ob_flush();
                                @flush();
                            }
                        } else {
                            $status = proc_get_status($process);
                            if (!$status['running']) {
                                break;
                            }
                        }
                    }
                } finally {
                    @fclose($pipes[1]);
                    @fclose($pipes[2]);
                    if (trim($stderrTail) !== '') {
                        error_log('[KuraStream] ffmpeg stream ' . $episodeId . ': ' . trim($stderrTail));
                    }

                    $status = proc_get_status($process);
                    if ($status['running']) {
                        @proc_terminate($process, 9);
                    }
                    @proc_close($process);
                    TranscodeLimiter::releaseSlot();
                }
            } else {
                TranscodeLimiter::releaseSlot();
            }
            exit();
        }

        $fileSize = filesize($realPath);
        $offset = 0;
        $length = $fileSize;
        $isPartial = false;

        if (isset($_SERVER['HTTP_RANGE']) && preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'], $matches)) {
            $rawStart = $matches[1];
            $rawEnd = $matches[2];

            if ($rawStart === '' && $rawEnd !== '') {
                // Suffix range: bytes=-500 (last 500 bytes)
                $suffixLen = intval($rawEnd);
                if ($suffixLen > 0) {
                    $offset = max(0, $fileSize - $suffixLen);
                    $length = $fileSize - $offset;
                    $end = $fileSize - 1;
                    $isPartial = true;
                    @header('HTTP/1.1 206 Partial Content');
                    @header("Content-Range: bytes {$offset}-{$end}/{$fileSize}");
                }
            } elseif ($rawStart !== '') {
                $startRange = intval($rawStart);
                // Answer browsers' open-ended ranges ("bytes=N-") in bounded chunks: they simply request the
                // next range, and a single playing video no longer holds a server worker for the whole file.
                // Native players (ExoPlayer on Android) may treat a short answer as end of file, so they get it whole.
                $isBrowser = str_contains($_SERVER['HTTP_USER_AGENT'] ?? '', 'Mozilla/');
                $maxChunk = 8 * 1024 * 1024;
                $endRange = ($rawEnd !== '') ? intval($rawEnd) : ($isBrowser ? min($fileSize - 1, $startRange + $maxChunk - 1) : ($fileSize - 1));

                if ($startRange <= $endRange && $startRange < $fileSize) {
                    $offset = $startRange;
                    $end = min($endRange, $fileSize - 1);
                    $length = $end - $offset + 1;
                    $isPartial = true;

                    @header('HTTP/1.1 206 Partial Content');
                    @header("Content-Range: bytes {$offset}-{$end}/{$fileSize}");
                } else {
                    @http_response_code(416);
                    @header('HTTP/1.1 416 Requested Range Not Satisfiable');
                    @header("Content-Range: bytes */{$fileSize}");
                    if (defined('TESTING_MODE')) throw new ExitException("416 Range Not Satisfiable", 416);
                    exit();
                }
            }
        } else {
            @header('HTTP/1.1 200 OK');
        }

        // Detect correct video MIME type
        $mimeTypes = [
            'mp4' => 'video/mp4',
            'webm' => 'video/webm',
            'avi' => 'video/x-msvideo',
            'mov' => 'video/quicktime',
            'm4v' => 'video/mp4'
        ];
        $mime = $mimeTypes[$ext] ?? (@mime_content_type($realPath) ?: 'video/mp4');

        setCorsHeaders();
        @header("Content-Type: {$mime}");
        @header('Accept-Ranges: bytes');
        @header("Content-Length: {$length}");

        if ($isHead) {
            if (defined('TESTING_MODE')) throw new ExitException("Stream HEAD success", $isPartial ? 206 : 200);
            exit();
        }

        if (defined('TESTING_MODE')) {
            throw new ExitException("Stream success", $isPartial ? 206 : 200);
        }

        @ignore_user_abort(true);
        $fp = fopen($realPath, 'rb');
        fseek($fp, $offset);

        $bufferSize = 1024 * 64; // 64KB chunks
        while (!feof($fp) && $length > 0 && !connection_aborted()) {
            $readSize = min($bufferSize, $length);
            $buffer = fread($fp, $readSize);
            if ($buffer === false || $buffer === '') {
                break;
            }
            echo $buffer;
            flush();
            $length -= strlen($buffer);
        }
        fclose($fp);
        exit();
    }

    public static function streamFont(string $episodeId, string $fontName): void {
        self::authorizeStreamAccess($episodeId);
        $cleanFont = preg_replace('/[^a-zA-Z0-9_\-\.]/', '', basename($fontName));
        if (empty($cleanFont)) {
            jsonError('Nombre de fuente inválido', 400);
        }

        $ep = DbHelper::getEpisode($episodeId);
        if (!$ep || empty($ep['filepath']) || !file_exists($ep['filepath'])) {
            jsonError('Episodio no encontrado', 404);
        }

        $cacheDir = sys_get_temp_dir() . '/kura_subs_cache/fonts/' . md5($ep['filepath']);
        $fontPath = $cacheDir . '/' . $cleanFont;

        if (!file_exists($fontPath)) {
            require_once __DIR__ . '/../services/FfmpegScanner.php';
            FfmpegScanner::extractFonts($ep['filepath'], $cacheDir);
        }

        if (!file_exists($fontPath)) {
            jsonError('Fuente no encontrada', 404);
        }

        $ext = strtolower(pathinfo($fontPath, PATHINFO_EXTENSION));
        $mimes = [
            'ttf' => 'font/ttf',
            'otf' => 'font/otf',
            'woff' => 'font/woff',
            'woff2' => 'font/woff2'
        ];
        $contentType = $mimes[$ext] ?? 'application/octet-stream';

        @header("Content-Type: {$contentType}");
        setCorsHeaders();
        @header('Cache-Control: public, max-age=86400');
        @header('Content-Length: ' . filesize($fontPath));

        if (defined('TESTING_MODE')) {
            throw new ExitException("Font stream success", 200, basename($fontPath));
        }

        readfile($fontPath);
        exit();
    }

    public static function getEpisodeFonts(string $episodeId): void {
        self::authorizeStreamAccess($episodeId);
        $ep = DbHelper::getEpisode($episodeId);
        if (!$ep || empty($ep['filepath']) || !file_exists($ep['filepath'])) {
            jsonError('Episodio no encontrado', 404);
        }

        $cacheDir = sys_get_temp_dir() . '/kura_subs_cache/fonts/' . md5($ep['filepath']);
        if (!is_dir($cacheDir)) {
            require_once __DIR__ . '/../services/FfmpegScanner.php';
            FfmpegScanner::extractFonts($ep['filepath'], $cacheDir);
        }

        $fonts = [];
        if (is_dir($cacheDir)) {
            $files = glob($cacheDir . '/*.{ttf,otf,woff,woff2}', GLOB_BRACE) ?: [];
            foreach ($files as $f) {
                $base = basename($f);
                $fonts[] = [
                    'name' => $base,
                    'url' => "/api/episodes/" . urlencode($episodeId) . "/fonts/" . urlencode($base)
                ];
            }
        }
        jsonResponse(['fonts' => $fonts]);
    }
}
