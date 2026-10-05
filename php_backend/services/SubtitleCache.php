<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/FfmpegScanner.php';

/**
 * Extracted subtitle tracks (.ass) and embedded fonts, shared by the web requests and the background worker.
 *
 * Every file is written to a temporary name and renamed into place only when ffmpeg finished successfully, so a
 * killed or timed-out extraction can never leave a truncated file that is then served for a week. Fonts get a
 * `.complete` marker for the same reason. Extractions of the same target wait for each other (flock) instead of
 * racing, and at most SUBTITLE_MAX_PROCS ffmpeg subtitle extractions run at once so a page full of viewers
 * opening the same episode does not fork a dozen ffmpeg processes.
 */
class SubtitleCache {
    public static function dir(): string {
        $dir = getenv('SUBTITLE_CACHE_DIR');
        return ($dir !== false && $dir !== '') ? rtrim($dir, '/\\') : sys_get_temp_dir() . '/kura_subs_cache';
    }

    public static function fontsDir(string $videoPath): string {
        return self::dir() . '/fonts/' . md5($videoPath);
    }

    public static function maxProcesses(): int {
        $n = (int)(getenv('SUBTITLE_MAX_PROCS') ?: 3);
        return max(1, min(16, $n));
    }

    /** @return array{0: ?array, 1: int} the track entry the client asked for (or null) and its stream index (-1 = by position) */
    public static function resolveTrack(array $ep, $trackNum): array {
        $tracks = !empty($ep['subtitle_tracks']) ? (is_array($ep['subtitle_tracks']) ? $ep['subtitle_tracks'] : json_decode($ep['subtitle_tracks'], true)) : [];
        $t = null;
        $trackIndex = -1;
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
        return [$t, $trackIndex];
    }

    public static function trackCacheFile(string $videoPath, int $trackIndex, $trackNum): string {
        return self::dir() . '/' . md5($videoPath . '_' . $trackIndex . '_' . (int)$trackNum . '_' . @filemtime($videoPath)) . '.ass';
    }

    public static function isUsable(string $file): bool {
        return is_file($file) && filesize($file) > 0;
    }

    /** Takes one of the extraction slots, waiting up to $waitSeconds. Returns the lock handle or null. */
    private static function acquireSlot(int $waitSeconds)  {
        $dir = self::dir() . '/.slots';
        if (!is_dir($dir)) @mkdir($dir, 0777, true);
        $deadline = microtime(true) + $waitSeconds;
        do {
            for ($i = 0; $i < self::maxProcesses(); $i++) {
                $fp = @fopen($dir . '/slot' . $i, 'c');
                if ($fp && flock($fp, LOCK_EX | LOCK_NB)) {
                    return $fp;
                }
                if ($fp) fclose($fp);
            }
            usleep(100000);
        } while (microtime(true) < $deadline);
        return null;
    }

    private static function release($fp): void {
        if (is_resource($fp)) {
            flock($fp, LOCK_UN);
            fclose($fp);
        }
    }

    /** Writes $cmdFor($tmpFile) output to $target atomically. Returns whether $target is usable afterwards. */
    private static function produce(string $target, callable $cmdFor, int $timeoutSeconds): bool {
        $dir = dirname($target);
        if (!is_dir($dir)) @mkdir($dir, 0777, true);

        // Same target: one extraction at a time; the ones that waited find the file ready.
        $lockFp = @fopen($target . '.lock', 'c');
        if ($lockFp && !self::lockWithTimeout($lockFp, $timeoutSeconds + 5)) {
            fclose($lockFp);
            return self::isUsable($target);
        }
        try {
            if (self::isUsable($target)) {
                return true;
            }
            $slot = self::acquireSlot($timeoutSeconds);
            if ($slot === null) {
                return false;   // every extraction slot stayed busy: the caller answers "not available yet"
            }
            try {
                $tmp = $target . '.' . getmypid() . '.part';
                $ok = self::runFfmpeg($cmdFor($tmp), $timeoutSeconds);
                if ($ok && self::isUsable($tmp) && @rename($tmp, $target)) {
                    return true;
                }
                @unlink($tmp);
                return false;
            } finally {
                self::release($slot);
            }
        } finally {
            if ($lockFp) {
                flock($lockFp, LOCK_UN);
                fclose($lockFp);
            }
        }
    }

    private static function lockWithTimeout($fp, int $seconds): bool {
        $deadline = microtime(true) + $seconds;
        do {
            if (flock($fp, LOCK_EX | LOCK_NB)) return true;
            usleep(50000);
        } while (microtime(true) < $deadline);
        return false;
    }

    /** Runs a command and returns true only when it exited 0 within the time limit. */
    private static function runFfmpeg(string $cmd, int $timeoutSeconds): bool {
        $proc = @proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($proc)) {
            return false;
        }
        fclose($pipes[0]);
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);
        $start = microtime(true);
        $exit = null;
        while (true) {
            // Drain the pipes so ffmpeg never blocks writing diagnostics.
            fread($pipes[1], 8192);
            fread($pipes[2], 8192);
            $status = proc_get_status($proc);
            if (!$status['running']) {
                $exit = $status['exitcode'];
                break;
            }
            if (microtime(true) - $start > $timeoutSeconds) {
                @proc_terminate($proc, 9);
                break;
            }
            usleep(20000);
        }
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($proc);
        return $exit === 0;
    }

    /** Extracts an embedded text track as ASS into the cache (atomically). */
    public static function ensureTrack(string $videoPath, int $trackIndex, $trackNum, int $timeoutSeconds = 20): ?string {
        $cacheFile = self::trackCacheFile($videoPath, $trackIndex, $trackNum);
        if (self::isUsable($cacheFile)) {
            return $cacheFile;
        }
        $mapArg = ($trackIndex !== -1) ? "-map 0:{$trackIndex}" : '-map 0:s:' . (int)$trackNum . '?';
        $ok = self::produce($cacheFile, fn(string $tmp) =>
            sprintf('ffmpeg -nostdin -y -v error -i %s %s -f ass %s', escapeshellarg($videoPath), $mapArg, escapeshellarg($tmp)), $timeoutSeconds);
        return $ok ? $cacheFile : null;
    }

    /** Converts an external SRT/VTT sidecar to ASS in the cache (atomically). */
    public static function ensureSidecarAss(string $sidecarPath, int $timeoutSeconds = 15): ?string {
        $cacheFile = self::dir() . '/' . md5($sidecarPath . '_' . @filemtime($sidecarPath)) . '.ass';
        if (self::isUsable($cacheFile)) {
            return $cacheFile;
        }
        $ok = self::produce($cacheFile, fn(string $tmp) =>
            sprintf('ffmpeg -nostdin -y -v error -i %s -f ass %s', escapeshellarg($sidecarPath), escapeshellarg($tmp)), $timeoutSeconds);
        return $ok ? $cacheFile : null;
    }

    public static function fontsReady(string $videoPath): bool {
        return is_file(self::fontsDir($videoPath) . '/.complete');
    }

    /**
     * Extracts the attached fonts into fonts/<md5(video)>/ via a temporary directory. The `.complete` marker is
     * written only after ffmpeg ran to the end (it exits non-zero on "no output file", which is expected here, so
     * a timeout/kill is what counts as failure), so an interrupted run is repeated instead of trusted.
     * @return string[] font file names
     */
    public static function ensureFonts(string $videoPath, int $timeoutSeconds = 15): array {
        $dest = self::fontsDir($videoPath);
        if (!self::fontsReady($videoPath)) {
            if (!is_dir(dirname($dest))) @mkdir(dirname($dest), 0777, true);
            $lockFp = @fopen($dest . '.lock', 'c');
            if ($lockFp && self::lockWithTimeout($lockFp, $timeoutSeconds + 5) && !self::fontsReady($videoPath)) {
                $tmpDir = $dest . '.' . getmypid() . '.tmp';
                self::removeTree($tmpDir);
                $slot = self::acquireSlot($timeoutSeconds);
                if ($slot !== null) {
                    try {
                        $result = FfmpegScanner::extractFonts($videoPath, $tmpDir, $timeoutSeconds, $finished);
                    } finally {
                        self::release($slot);
                    }
                    if ($finished) {
                        if (!is_dir($dest)) @mkdir($dest, 0777, true);
                        foreach ($result as $font) {
                            @rename($tmpDir . '/' . $font, $dest . '/' . $font);
                        }
                        @touch($dest . '/.complete');
                    }
                }
                self::removeTree($tmpDir);
            }
            if ($lockFp) {
                flock($lockFp, LOCK_UN);
                fclose($lockFp);
            }
        }
        $fonts = [];
        foreach (glob($dest . '/*.{ttf,otf,woff,woff2,TTF,OTF}', GLOB_BRACE) ?: [] as $f) {
            $fonts[] = basename($f);
        }
        return $fonts;
    }

    private static function removeTree(string $path): void {
        if (is_link($path) || is_file($path)) { @unlink($path); return; }
        if (!is_dir($path)) return;
        foreach (array_diff(scandir($path) ?: [], ['.', '..']) as $entry) {
            self::removeTree($path . '/' . $entry);
        }
        @rmdir($path);
    }

    /**
     * Prepares everything a player asks for on an episode: each text subtitle track and the fonts.
     * @return array{tracks:int, fonts:int, failed:int}
     */
    public static function prepareEpisode(array $ep): array {
        $out = ['tracks' => 0, 'fonts' => 0, 'failed' => 0];
        $file = (string)($ep['filepath'] ?? '');
        if ($file === '' || !is_file($file)) {
            return $out;
        }
        $tracks = !empty($ep['subtitle_tracks']) ? (is_array($ep['subtitle_tracks']) ? $ep['subtitle_tracks'] : json_decode($ep['subtitle_tracks'], true)) : [];
        $hasEmbeddedText = false;
        foreach (is_array($tracks) ? $tracks : [] as $pos => $t) {
            if (!empty($t['is_bitmap'])) continue;
            if (($t['source'] ?? '') === 'external') {
                if (!empty($t['filepath']) && is_file($t['filepath']) && !in_array(strtolower(pathinfo($t['filepath'], PATHINFO_EXTENSION)), ['ass', 'ssa'], true)) {
                    self::ensureSidecarAss($t['filepath']) !== null ? $out['tracks']++ : $out['failed']++;
                }
                continue;
            }
            $hasEmbeddedText = true;
            // The same lookup streamSubtitle does for the track number the client sends.
            $trackNum = $t['track_number'] ?? $pos;
            [, $trackIndex] = self::resolveTrack($ep, $trackNum);
            self::ensureTrack($file, $trackIndex, $trackNum) !== null ? $out['tracks']++ : $out['failed']++;
        }
        if ($hasEmbeddedText && !self::fontsReady($file)) {
            $out['fonts'] = count(self::ensureFonts($file));
        }
        return $out;
    }
}
