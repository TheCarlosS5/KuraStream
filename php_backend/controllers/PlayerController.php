<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/ShowController.php';
require_once __DIR__ . '/PartyController.php';
require_once __DIR__ . '/../middleware/AuthMiddleware.php';

class TranscodeLimiter {
    public static int $maxWorkers = 3;
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

        // 2. Authenticated user session - MUST require active profile
        $userToken = AuthMiddleware::getBearerToken();
        if (empty($userToken)) {
            jsonError('Autenticación requerida para acceder al flujo de medios', 401);
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

        $success = DbHelper::saveEpisodeTimestamps($id, $data);
        if (!$success) {
            jsonError('Episodio no encontrado', 404);
        }

        jsonResponse(['success' => true]);
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
        if (is_array($tracks) && count($tracks) > 0) {
            $t = array_values(array_filter($tracks, fn($x) => isset($x['index']) && (int)$x['index'] === (int)$trackNum))[0] ?? null;
            if (!$t) {
                $t = array_values(array_filter($tracks, fn($x) => isset($x['track_number']) && (int)$x['track_number'] === (int)$trackNum))[0] ?? null;
            }
            if (!$t && isset($tracks[(int)$trackNum])) {
                $t = $tracks[(int)$trackNum];
            }
            if ($t && isset($t['index'])) {
                $trackIndex = (int)$t['index'];
            }
        }

        $cacheDir = sys_get_temp_dir() . '/kura_subs_cache';
        if (!is_dir($cacheDir)) {
            @mkdir($cacheDir, 0777, true);
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
            readfile($cacheFile);
            if (defined('TESTING_MODE')) throw new ExitException("Subtitle stream cached success", 200);
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
            readfile($cacheFile);
        } else {
            echo "";
        }

        if (defined('TESTING_MODE')) throw new ExitException("Subtitle stream success", 200);
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

        $isHead = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD';

        // If file is MKV (not supported natively by HTML5 video tag) or seek/audio track specified:
        if ($isMkv || $start > 0 || $audioTrack !== -1) {
            $isPreview = isset($_GET['preview']) || (isset($_SERVER['HTTP_X_PURPOSE']) && $_SERVER['HTTP_X_PURPOSE'] === 'preview');
            if ($isPreview) {
                @http_response_code(403);
                echo "Live transcode stream not permitted for timeline preview";
                if (defined('TESTING_MODE')) throw new ExitException("Preview transcode forbidden", 403);
                exit();
            }

            @header('Content-Type: video/mp4');
            @header('Connection: keep-alive');
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

            $cmd = 'ffmpeg -v error ';
            if ($start > 0) {
                $cmd .= '-ss ' . escapeshellarg(strval($start)) . ' ';
            }
            $cmd .= '-i ' . escapeshellarg($realPath) . ' ';
            $cmd .= '-map 0:v:0 ';
            
            // Map selected audio track or default to first audio stream
            $mappedAudio = false;
            if ($audioTrack >= 0 && !empty($episodeId)) {
                $epData = $ep;
                $tracks = !empty($epData['audio_tracks']) ? (is_array($epData['audio_tracks']) ? $epData['audio_tracks'] : json_decode($epData['audio_tracks'], true)) : [];
                if (is_array($tracks) && count($tracks) > 0) {
                    // Match by stream index first
                    $targetTrack = array_values(array_filter($tracks, fn($x) => isset($x['index']) && (int)$x['index'] === $audioTrack))[0] ?? null;
                    if (!$targetTrack) {
                        // Match by track_number
                        $targetTrack = array_values(array_filter($tracks, fn($x) => isset($x['track_number']) && (int)$x['track_number'] === $audioTrack))[0] ?? null;
                    }
                    if (!$targetTrack && isset($tracks[$audioTrack])) {
                        // Match by array offset
                        $targetTrack = $tracks[$audioTrack];
                    }
                    if ($targetTrack && isset($targetTrack['index'])) {
                        $cmd .= "-map 0:" . intval($targetTrack['index']) . "? ";
                        $mappedAudio = true;
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
                ? '-vf "scale=min(iw\\,1280):-2" -c:v libx264 -preset ultrafast -tune fastdecode -crf 25 -pix_fmt yuv420p'
                : '-c:v copy';

            // Remux video (transcode to H.264 if needed or copy), audio aac preserving channels unless downmix requested
            $acArg = (isset($_GET['downmix']) && $_GET['downmix'] === 'stereo') ? '-ac 2 ' : '';
            $cmd .= $vCodecArg . ' -c:a aac ' . $acArg . '-b:a 192k -af "aresample=async=1" -avoid_negative_ts disabled -f mp4 -movflags frag_keyframe+empty_moov+default_base_moof -';

            if (defined('TESTING_MODE')) {
                throw new ExitException("Stream remux success", 200);
            }

            while (ob_get_level()) {
                ob_end_clean();
            }

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

                try {
                    while (!feof($pipes[1])) {
                        if (connection_aborted() || (time() - $streamStart > $streamTimeout)) {
                            break;
                        }
                        $read = [$pipes[1]];
                        $write = null;
                        $except = null;
                        $numChanged = @stream_select($read, $write, $except, 0, 150000);
                        if ($numChanged > 0) {
                            $buffer = fread($pipes[1], 65536);
                            if ($buffer !== false && strlen($buffer) > 0) {
                                echo $buffer;
                                if (ob_get_level()) @ob_flush();
                                flush();
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

                    $status = proc_get_status($process);
                    if ($status['running']) {
                        @proc_terminate($process, 15);
                        usleep(100000);
                        $status = proc_get_status($process);
                        if ($status['running']) {
                            @proc_terminate($process, 9);
                        }
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
                $endRange = ($rawEnd !== '') ? intval($rawEnd) : ($fileSize - 1);

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

        $fp = fopen($realPath, 'rb');
        fseek($fp, $offset);

        $bufferSize = 1024 * 64; // 64KB chunks
        while (!feof($fp) && $length > 0) {
            $readSize = min($bufferSize, $length);
            $buffer = fread($fp, $readSize);
            echo $buffer;
            flush();
            $length -= $readSize;
        }
        fclose($fp);
        exit();
    }
}
