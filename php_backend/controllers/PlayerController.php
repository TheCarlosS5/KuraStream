<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/ShowController.php';
require_once __DIR__ . '/PartyController.php';
require_once __DIR__ . '/../middleware/AuthMiddleware.php';
require_once __DIR__ . '/../services/SubtitleCache.php';

class TranscodeLimiter {
    /** Concurrent ffmpeg workers. TRANSCODE_MAX_WORKERS, else half the CPU cores (at least 2). */
    public static int $maxWorkers = 0;
    private static array $activeLocks = [];

    public static function maxWorkers(): int {
        if (self::$maxWorkers > 0) {
            return self::$maxWorkers;
        }
        $configured = (int)getenv('TRANSCODE_MAX_WORKERS');
        if ($configured > 0) {
            return self::$maxWorkers = $configured;
        }
        $cores = 0;
        if (is_readable('/proc/cpuinfo')) {
            $cores = preg_match_all('/^processor\s*:/m', (string)@file_get_contents('/proc/cpuinfo'));
        }
        if ($cores < 1) {
            $cores = 4;
        }
        return self::$maxWorkers = max(2, intdiv($cores, 2));
    }

    private static function slotDir(): string {
        $slotDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'kura_transcode_slots';
        if (!is_dir($slotDir)) {
            @mkdir($slotDir, 0777, true);
        }
        return $slotDir;
    }

    private static function writeSlotInfo($fp, array $info): void {
        @ftruncate($fp, 0);
        @rewind($fp);
        @fwrite($fp, json_encode($info));
        @fflush($fp);
    }

    /**
     * A new stream for the same session replaces the previous one: seeking in a remuxed stream starts a new ffmpeg,
     * and the old one used to keep its slot until a write to the closed socket failed (so the third seek got a 503).
     * Only a process that is still holding the slot AND is really an ffmpeg is signalled.
     */
    private static function terminateSession(string $slotDir, string $sessionKey): bool {
        $killed = false;
        for ($i = 0; $i < self::maxWorkers(); $i++) {
            $file = $slotDir . DIRECTORY_SEPARATOR . "worker_{$i}.lock";
            $info = is_file($file) ? json_decode((string)@file_get_contents($file), true) : null;
            if (!is_array($info) || ($info['key'] ?? null) !== $sessionKey || empty($info['pid']) || !is_int($info['pid'])) {
                continue;
            }
            $probe = @fopen($file, 'c+');
            if (!$probe) {
                continue;
            }
            $free = flock($probe, LOCK_EX | LOCK_NB);   // free: nobody is streaming on this slot any more
            if ($free) {
                flock($probe, LOCK_UN);
            }
            fclose($probe);
            if ($free) {
                continue;
            }
            $cmdline = @file_get_contents('/proc/' . $info['pid'] . '/cmdline');
            if ($cmdline === false || !str_contains($cmdline, 'ffmpeg')) {
                continue;
            }
            if (function_exists('posix_kill')) {
                $killed = @posix_kill($info['pid'], 9) || $killed;
            } else {
                @exec('kill -9 ' . (int)$info['pid'] . ' 2>/dev/null');
                $killed = true;
            }
        }
        return $killed;
    }

    public static function acquireSlot(int $timeoutSeconds = 2, ?string $sessionKey = null): bool {
        $slotDir = self::slotDir();
        $start = time();
        $terminated = false;
        do {
            if ($sessionKey !== null && !$terminated) {
                $terminated = self::terminateSession($slotDir, $sessionKey);
            }
            for ($i = 0; $i < self::maxWorkers(); $i++) {
                if (isset(self::$activeLocks[$i])) {
                    continue; // Already holding this slot in this process
                }
                $file = $slotDir . DIRECTORY_SEPARATOR . "worker_{$i}.lock";
                $fp = @fopen($file, 'c+');
                if ($fp && flock($fp, LOCK_EX | LOCK_NB)) {
                    self::$activeLocks[$i] = $fp;
                    self::writeSlotInfo($fp, ['key' => $sessionKey, 'pid' => null, 'php' => getmypid()]);
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

    /** Records the ffmpeg pid on the slot this process holds so a newer stream of the same session can stop it. */
    public static function setProcessPid(int $pid, ?string $sessionKey): void {
        if (empty(self::$activeLocks)) {
            return;
        }
        $keys = array_keys(self::$activeLocks);
        self::writeSlotInfo(self::$activeLocks[end($keys)], ['key' => $sessionKey, 'pid' => $pid, 'php' => getmypid()]);
    }

    public static function releaseSlot(): void {
        if (!empty(self::$activeLocks)) {
            $keys = array_keys(self::$activeLocks);
            $lastIndex = end($keys);
            $fp = self::$activeLocks[$lastIndex];
            self::writeSlotInfo($fp, ['key' => null, 'pid' => null]);
            @flock($fp, LOCK_UN);
            @fclose($fp);
            unset(self::$activeLocks[$lastIndex]);
        }
    }

    /** Whether a live stream of this session key currently holds a slot (so its next stream will take it over). */
    public static function sessionHoldsSlot(string $sessionKey): bool {
        $slotDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'kura_transcode_slots';
        for ($i = 0; is_dir($slotDir) && $i < self::maxWorkers(); $i++) {
            $file = $slotDir . DIRECTORY_SEPARATOR . "worker_{$i}.lock";
            $info = is_file($file) ? json_decode((string)@file_get_contents($file), true) : null;
            if (!is_array($info) || ($info['key'] ?? null) !== $sessionKey) {
                continue;
            }
            $probe = @fopen($file, 'c+');
            if (!$probe) {
                continue;
            }
            $free = flock($probe, LOCK_EX | LOCK_NB);
            if ($free) {
                flock($probe, LOCK_UN);
            }
            fclose($probe);
            if (!$free) {
                return true;
            }
        }
        return false;
    }

    public static function getActiveWorkerCount(): int {
        $slotDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'kura_transcode_slots';
        if (!is_dir($slotDir)) {
            return 0;
        }
        $active = 0;
        for ($i = 0; $i < self::maxWorkers(); $i++) {
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
    /**
     * Bit depth of an episode's video. Scans record it; for a library scanned before that existed it is probed once
     * on first playback and stored. Unknown or unreadable counts as 8-bit (the behaviour before this existed).
     */
    public static function resolveBitDepth(array $ep, string $realPath): int {
        if (isset($ep['bit_depth']) && $ep['bit_depth'] !== null && $ep['bit_depth'] !== '') {
            return (int)$ep['bit_depth'];
        }
        $codec = strtolower($ep['video_codec'] ?? '');
        if (!in_array($codec, ['', 'h264', 'avc1', 'avc'], true)) {
            return 8; // transcoded anyway
        }
        $format = FfmpegScanner::probeVideoFormat($realPath);
        if ($format === null) {
            return 8;
        }
        if (!empty($ep['id'])) {
            DbHelper::setEpisodeVideoFormat($ep['id'], $format['pix_fmt'], $format['bit_depth']);
        }
        return $format['bit_depth'];
    }

    /**
     * Whether a stream can be served as plain HTTP-Range file bytes (no ffmpeg): an H.264 8-bit MP4/WebM/M4V, default
     * audio track, no downmix/forced transcode and no start offset. Shared by streamVideo and the availability probe.
     * @param array $query the request's query parameters (audio, downmix, transcode, start)
     */
    public static function canDirectPlay(array $ep, string $realPath, array $query): bool {
        // A native player (ExoPlayer) that knows its decoders asks for the raw file with ?direct=1: any container
        // and codec, audio/subtitle tracks chosen on the client. Only server-side processing the client also
        // requested (downmix, forced transcode) overrides it.
        if (($query['direct'] ?? '') === '1' && ($query['downmix'] ?? '') !== 'stereo' && ($query['transcode'] ?? '') != '1') {
            return true;
        }
        $ext = strtolower(pathinfo($realPath, PATHINFO_EXTENSION));
        $videoCodec = strtolower($ep['video_codec'] ?? '');
        $tracks = !empty($ep['audio_tracks']) ? (is_array($ep['audio_tracks']) ? $ep['audio_tracks'] : json_decode($ep['audio_tracks'], true)) : [];
        if (!is_array($tracks)) {
            $tracks = [];
        }
        $audioTrack = isset($query['audio']) ? (int)$query['audio'] : -1;
        $isDirectContainer = in_array($ext, ['mp4', 'webm', 'm4v'], true);
        $isDirectCodec = in_array($videoCodec, ['', 'h264', 'avc1', 'avc'], true);
        $isDefaultAudio = ($audioTrack <= 0 || count($tracks) <= 1);
        $downmix = (($query['downmix'] ?? '') === 'stereo');
        $forced = (($query['transcode'] ?? '') == '1');
        $start = isset($query['start']) ? (float)$query['start'] : 0.0;
        if (!($isDirectContainer && $isDirectCodec && $isDefaultAudio && !$downmix && !$forced && $start <= 0)) {
            return false;
        }
        // Only 10-bit-and-deeper H.264 needs a transcode even though container and codec look playable.
        return self::resolveBitDepth($ep, $realPath) <= 8;
    }

    /**
     * True when nginx fronts PHP and can serve the file itself. nginx sets SERVER_SOFTWARE for FastCGI; X_ACCEL=1/0
     * overrides the detection (for a setup where PHP sits behind another kind of proxy, or to disable it).
     */
    public static function useAccelRedirect(): bool {
        $force = getenv('X_ACCEL');
        if ($force === '0') return false;
        if ($force === '1') return true;
        return str_contains(strtolower((string)($_SERVER['SERVER_SOFTWARE'] ?? '')), 'nginx');
    }

    /** The internal nginx URI (`/_media/...`) of a library file, or null when it lies outside the library. */
    public static function accelUri(string $realPath, string $realLibrary): ?string {
        $prefix = rtrim($realLibrary, '/\\') . DIRECTORY_SEPARATOR;
        if (!str_starts_with($realPath, $prefix)) {
            return null;
        }
        $rel = str_replace('\\', '/', substr($realPath, strlen($prefix)));
        return '/_media/' . implode('/', array_map('rawurlencode', explode('/', $rel)));
    }

    /** A stable key for "this viewer's current stream of this episode" (the player sends a per-instance `session`). */
    public static function streamSessionKey(string $episodeId): string {
        $session = (string)($_GET['session'] ?? '');
        if (preg_match('/^[A-Za-z0-9_-]{8,64}$/', $session)) {
            return $episodeId . '|s:' . $session;
        }
        return $episodeId . '|ip:' . RateLimiter::getClientIp();
    }

    /** GET /api/stream/{id}/availability: how the episode would be served and whether a transcode slot is free. */
    public static function streamAvailability(string $episodeId): void {
        self::authorizeStreamAccess($episodeId);
        $ep = DbHelper::getEpisode($episodeId);
        if (!$ep) {
            jsonError('Episodio no encontrado en el catálogo', 404);
        }
        $realPath = realpath($ep['filepath'] ?? '');
        $realLibrary = realpath(LIBRARY_DIR);
        if (!$realPath || !is_file($realPath) || !$realLibrary || !str_starts_with($realPath, rtrim($realLibrary, '/\\') . DIRECTORY_SEPARATOR)) {
            jsonError('Archivo de video no disponible', 404);
        }
        $direct = self::canDirectPlay($ep, $realPath, $_GET);
        $active = TranscodeLimiter::getActiveWorkerCount();
        $max = TranscodeLimiter::maxWorkers();
        jsonResponse([
            'success' => true,
            'mode' => $direct ? 'direct' : 'transcode',
            // A viewer's own seek takes over the slot of the stream it replaces, so it is never "busy" for them.
            'busy' => !$direct && $active >= $max && !TranscodeLimiter::sessionHoldsSlot(self::streamSessionKey($episodeId)),
            'active_transcodes' => $active,
            'max_transcodes' => $max,
        ]);
    }

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
                if (DbHelper::isGuestMember($member) && empty($room['allow_guests'])) {
                    jsonError('Esta sala ya no admite invitados sin cuenta', 403);
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
            // An expired or foreign room ticket must not lock out someone who is also signed in (the Android app
            // sends both): fall back to the session. Without a session the ticket is all there is, and it is refused.
            if (AuthMiddleware::getBearerToken() === null) {
                jsonError('Ticket de reproducción inválido o expirado', 403);
            }
        }

        // 2. Authenticated user session
        $userToken = AuthMiddleware::getBearerToken();
        if (empty($userToken)) {
            jsonError('Autenticación requerida para acceder al flujo de medios', 401);
        }

        $tokenData = AuthMiddleware::sessionPayload($userToken);
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

    /**
     * Whether the active profile may open this show: kids rules, its rating cap and, when $enforceScreenTime,
     * its daily screen-time budget (progress saves skip that last one so the final position is still stored).
     */
    public static function checkKidsModeAccess(string $showId, bool $enforceScreenTime = true): void {
        // Most profiles have no restriction at all: then there is no need to load the show
        if (ShowController::isKidsProfileActive() || ShowController::activeMaxLevel() !== null) {
            $show = DbHelper::getShow($showId);
            if ($show && ShowController::isRestrictedForActiveProfile($show)) {
                jsonError('Contenido restringido por el perfil activo', 403);
            }
        }
        if ($enforceScreenTime) {
            self::enforceScreenTime();
        }
    }

    /** @return array{limit_seconds:int, used_seconds:int}|null null when the active profile has no daily limit */
    public static function screenTimeStatus(): ?array {
        $payload = AuthMiddleware::sessionPayload(AuthMiddleware::getBearerToken());
        $limit = (int)($payload['daily_limit_minutes'] ?? 0);
        if (!$payload || $limit <= 0 || empty($payload['profile_name'])) {
            return null;
        }
        return [
            'limit_seconds' => $limit * 60,
            'used_seconds' => DbHelper::getWatchSecondsToday((string)$payload['username'], (string)$payload['profile_name']),
        ];
    }

    private static function enforceScreenTime(): void {
        $status = self::screenTimeStatus();
        if ($status !== null && $status['used_seconds'] >= $status['limit_seconds']) {
            jsonError('Se alcanzó el tiempo de pantalla de hoy para este perfil', 403, ['code' => 'SCREEN_TIME_LIMIT']);
        }
    }

    public static function getEpisodeDetails(string $id): void {
        AuthMiddleware::requireCatalogAccess();
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
        [$t, $trackIndex] = SubtitleCache::resolveTrack($ep, $trackNum);

        if ($t && !empty($t['is_bitmap'])) {
            jsonError('Pista de subtítulos bitmap (PGS/VobSub) no compatible con renderizador de texto libass', 400);
        }

        $cacheDir = SubtitleCache::dir();
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
                $sidecarCacheFile = SubtitleCache::ensureSidecarAss($sidecarPath);
                if ($sidecarCacheFile !== null) {
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

        @header('Content-Type: text/plain; charset=utf-8');
        setCorsHeaders();
        @header('Cache-Control: public, max-age=86400');

        while (ob_get_level()) {
            ob_end_clean();
        }

        // Pre-extracted by the worker in most cases; otherwise extracted now, atomically and with a bounded
        // number of concurrent ffmpeg processes.
        $cacheFile = SubtitleCache::ensureTrack($filepath, $trackIndex, $trackNum);

        if ($cacheFile !== null) {
            $content = file_get_contents($cacheFile);
            if ($startOffset > 0) $content = self::shiftAssTimestamps($content, $startOffset);
            echo $content;
            if (defined('TESTING_MODE')) throw new ExitException("Subtitle stream success", 200, $content);
        } else {
            @http_response_code(404);
            @header('Cache-Control: no-store');
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
        if (!is_array($tracks)) {
            $tracks = [];
        }

        // Can we Direct Play using HTTP Range? (container, codec, 8-bit depth, audio track, no offset)
        $canDirectPlay = self::canDirectPlay($ep, $realPath, $_GET);

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
            $sessionKey = self::streamSessionKey($episodeId);
            if (!TranscodeLimiter::acquireSlot(2, $sessionKey)) {
                @http_response_code(503);
                @header('Retry-After: 5');
                @header('X-Transcode-Busy: ' . TranscodeLimiter::getActiveWorkerCount() . '/' . TranscodeLimiter::maxWorkers());
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
            $bitDepth = self::resolveBitDepth($ep, $realPath);
            // Hi10P and deeper H.264 is copied by a plain remux but cannot be decoded by browsers or most phones.
            $needTranscodeVideo = $forceH264 || $bitDepth > 8 || ($videoCodec !== '' && $videoCodec !== 'h264' && $videoCodec !== 'avc1' && $videoCodec !== 'avc');

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
                $procStatus = proc_get_status($process);
                if (!empty($procStatus['pid'])) {
                    // A newer stream of this session (a seek) can now stop this ffmpeg instead of waiting for it.
                    TranscodeLimiter::setProcessPid((int)$procStatus['pid'], $sessionKey);
                }
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

        $mimeTypes = [
            'mp4' => 'video/mp4',
            'webm' => 'video/webm',
            'mkv' => 'video/x-matroska',
            'avi' => 'video/x-msvideo',
            'mov' => 'video/quicktime',
            'm4v' => 'video/mp4',
            'ts' => 'video/mp2t'
        ];

        // Behind nginx, PHP only authorizes: nginx sends the bytes (sendfile, ranges, HEAD, aborted clients) so a
        // viewer no longer occupies a PHP process for the whole episode.
        if (self::useAccelRedirect() && ($accelUri = self::accelUri($realPath, $realLibrary)) !== null) {
            setCorsHeaders();
            @header('Content-Type: ' . ($mimeTypes[$ext] ?? (@mime_content_type($realPath) ?: 'video/mp4')));
            @header('X-Accel-Redirect: ' . $accelUri);
            @header('Cache-Control: private, no-cache');
            if (defined('TESTING_MODE')) throw new ExitException("Stream accel redirect", 200, $accelUri);
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

        $cacheDir = SubtitleCache::fontsDir($ep['filepath']);
        $fontPath = $cacheDir . '/' . $cleanFont;

        if (str_starts_with($cleanFont, '.')) {
            jsonError('Nombre de fuente inválido', 400);
        }
        if (!is_file($fontPath)) {
            SubtitleCache::ensureFonts($ep['filepath']);
        }

        if (!is_file($fontPath)) {
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

        $fonts = [];
        foreach (SubtitleCache::ensureFonts($ep['filepath']) as $base) {
            $fonts[] = [
                'name' => $base,
                'url' => "/api/episodes/" . urlencode($episodeId) . "/fonts/" . urlencode($base)
            ];
        }
        jsonResponse(['fonts' => $fonts]);
    }
}
