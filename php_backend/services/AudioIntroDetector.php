<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/FfmpegScanner.php';

/**
 * Finds an episode's opening by its sound: the opening of a sibling episode whose timings are
 * known (AniSkip, chapters) is fingerprinted with Chromaprint (ffmpeg's `chromaprint` muxer) and
 * searched for in the first minutes of the episode. Unlike comparing both files at the same second,
 * this finds the opening wherever the cold open ends.
 */
class AudioIntroDetector {
    /** Seconds of audio per Chromaprint item (4096-sample frames at 11025 Hz, 2/3 overlap). */
    public const ITEM_SECONDS = 4096 / 3 / 11025;
    /** Openings are looked for in this many first seconds of an episode. */
    private const SEARCH_SECONDS = 600;
    /** Mean share of differing fingerprint bits accepted as "the same audio" (unrelated audio ≈ 0.5). */
    private const MAX_BIT_ERROR = 0.30;
    /** A point counts as matching below this many differing bits (of 32). */
    private const POINT_BITS = 10;

    private static ?array $popcount16 = null;

    /** Raw Chromaprint fingerprint (one 32-bit value per ITEM_SECONDS) of a slice of a file. */
    public static function fingerprint(string $file, float $start, float $duration): ?array {
        $ffmpeg = FfmpegScanner::getFfmpegPath();
        if (!$ffmpeg || !is_file($file) || $duration <= 1) return null;
        $devNull = DIRECTORY_SEPARATOR === '\\' ? 'NUL' : '/dev/null';
        $cmd = escapeshellcmd($ffmpeg) . ' -nostdin -v error'
            . ' -ss ' . sprintf('%.3f', max(0, $start)) . ' -t ' . sprintf('%.3f', $duration)
            . ' -i ' . escapeshellarg($file)
            . ' -map 0:a:0 -vn -ac 1 -f chromaprint -fp_format raw pipe:1 2>' . $devNull;
        $raw = FfmpegScanner::executeBoundedCommand($cmd, 120, false);
        if (!is_string($raw) || strlen($raw) < 64) return null;
        return array_values(unpack('V*', $raw));
    }

    private static function bits(int $x): int {
        if (self::$popcount16 === null) {
            $t = [0];
            for ($i = 1; $i < 65536; $i++) $t[$i] = ($i & 1) + $t[$i >> 1];
            self::$popcount16 = $t;
        }
        return self::$popcount16[$x & 0xFFFF] + self::$popcount16[($x >> 16) & 0xFFFF];
    }

    /** Mean bit error of $needle laid over $hay at $offset, using every $step-th point. */
    private static function bitError(array $hay, array $needle, int $offset, int $step = 1): float {
        $n = count($needle);
        $sum = 0;
        $count = 0;
        for ($i = 0; $i < $n; $i += $step) {
            $sum += self::bits($hay[$offset + $i] ^ $needle[$i]);
            $count++;
        }
        return $count ? $sum / ($count * 32) : 1.0;
    }

    /**
     * Where $needle (the reference opening) sits inside $hay (the start of the episode).
     * Pure, unit-tested. Returns ['offset' => item index, 'error' => mean bit error,
     * 'first' / 'last' => first and last matching item of the needle] or null.
     */
    public static function locate(array $hay, array $needle): ?array {
        $n = count($needle);
        $h = count($hay);
        if ($n < 40 || $h < $n) return null;

        // Coarse pass on a quarter of the points, then exact around the best candidates.
        $coarse = [];
        for ($o = 0; $o <= $h - $n; $o++) {
            $coarse[$o] = self::bitError($hay, $needle, $o, 4);
        }
        asort($coarse);
        $best = null;
        foreach (array_slice(array_keys($coarse), 0, 5) as $candidate) {
            for ($o = max(0, $candidate - 3); $o <= min($h - $n, $candidate + 3); $o++) {
                $err = self::bitError($hay, $needle, $o);
                if ($best === null || $err < $best['error']) $best = ['offset' => $o, 'error' => $err];
            }
        }
        if ($best === null || $best['error'] > self::MAX_BIT_ERROR) return null;

        // An opening can be cut short (e.g. the last one of a season): keep the matching span only.
        $match = [];
        for ($i = 0; $i < $n; $i++) {
            $match[$i] = self::bits($hay[$best['offset'] + $i] ^ $needle[$i]) <= self::POINT_BITS ? 1 : 0;
        }
        $window = 16; // ~2 s
        $first = null;
        $last = null;
        for ($i = 0; $i + $window <= $n; $i++) {
            if (array_sum(array_slice($match, $i, $window)) >= $window * 0.5) {
                if ($first === null) $first = $i;
                $last = $i + $window - 1;
            }
        }
        if ($first === null || ($last - $first) < $n * 0.5) return null;
        // The window test trims a couple of seconds off intact edges; only real cuts count.
        if ($first <= $n * 0.08) $first = 0;
        if ($last >= $n * 0.92) $last = $n - 1;
        return $best + ['first' => $first, 'last' => $last];
    }

    /**
     * The longest stretch of audio two episodes share (their opening), without knowing it before:
     * equal fingerprint values vote for an alignment (inverted index, as Jellyfin's Intro Skipper
     * does), then the best alignments are scanned for the longest run of matching points.
     * Pure, unit-tested. Returns ['a' => first item in A, 'b' => first item in B, 'length' => items,
     * 'error' => mean bit error over the run] or null.
     */
    public static function commonSegment(array $a, array $b, float $minSeconds = 30, float $maxSeconds = 180): ?array {
        $index = [];
        foreach ($b as $j => $v) $index[$v][] = $j;
        $votes = [];
        foreach ($a as $i => $v) {
            if (!isset($index[$v])) continue;
            foreach ($index[$v] as $j) {
                $shift = $j - $i;
                $votes[$shift] = ($votes[$shift] ?? 0) + 1;
            }
        }
        if (!$votes) return null;
        arsort($votes);

        $minItems = (int)ceil($minSeconds / self::ITEM_SECONDS);
        $maxItems = (int)floor($maxSeconds / self::ITEM_SECONDS);
        $best = null;
        $tried = [];
        foreach (array_keys($votes) as $shift) {
            if (count($tried) >= 6) break;
            // Neighbouring shifts are the same alignment.
            foreach ($tried as $t) if (abs($t - $shift) <= 2) continue 2;
            $tried[] = $shift;

            $from = max(0, -$shift);
            $to = min(count($a), count($b) - $shift);
            $good = [];
            for ($i = $from; $i < $to; $i++) {
                $good[$i] = self::bits($a[$i] ^ $b[$i + $shift]) <= self::POINT_BITS;
            }
            // Runs of matching points, allowing short gaps (dialogue or effects over the music).
            $runStart = null;
            $lastGood = null;
            for ($i = $from; $i <= $to; $i++) {
                if ($i < $to && $good[$i]) {
                    if ($runStart === null) $runStart = $i;
                    $lastGood = $i;
                    continue;
                }
                if ($runStart === null || ($i < $to && $i - $lastGood <= 12)) continue; // gap up to ~1.5 s
                [$s, $e] = self::trimRun($good, $runStart, $lastGood);
                $len = $e - $s + 1;
                if ($len >= $minItems && ($best === null || $len > $best['length'])) {
                    $best = ['a' => $s, 'b' => $s + $shift, 'length' => min($len, $maxItems)];
                }
                $runStart = null;
            }
        }
        if ($best === null) return null;
        $best['error'] = self::bitError(array_slice($a, $best['a'], $best['length']), array_slice($b, $best['b'], $best['length']), 0);
        return $best['error'] <= self::MAX_BIT_ERROR ? $best : null;
    }

    /** Drops isolated chance matches at both ends of a run: edges need 4 of 8 points matching. */
    private static function trimRun(array $good, int $start, int $end): array {
        $dense = function (int $from) use ($good): bool {
            $n = 0;
            for ($k = $from; $k < $from + 8; $k++) $n += !empty($good[$k]) ? 1 : 0;
            return $n >= 4;
        };
        while ($start < $end && !($good[$start] && $dense($start))) $start++;
        while ($end > $start && !($good[$end] && $dense($end - 7))) $end--;
        return [$start, $end];
    }

    /**
     * Opening of $targetFile, given references: [['file' => path, 'start' => s, 'end' => s], ...]
     * tried in order. Returns ['start' => s, 'end' => s, 'error' => e, 'reference' => index] or null.
     */
    public static function detect(string $targetFile, float $targetDuration, array $references, ?array &$cache = null): ?array {
        $searchLen = min(self::SEARCH_SECONDS, max(0, $targetDuration - 60));
        $cacheKey = 'target:' . $targetFile;
        $hay = $cache[$cacheKey] ?? self::fingerprint($targetFile, 0, $searchLen);
        if ($cache !== null) $cache[$cacheKey] = $hay;
        if (!$hay) return null;

        $bestResult = null;
        foreach ($references as $idx => $ref) {
            $len = (float)$ref['end'] - (float)$ref['start'];
            if ($len < 20 || $len > 240) continue;
            $refKey = 'ref:' . $ref['file'] . ':' . $ref['start'] . ':' . $ref['end'];
            $needle = $cache[$refKey] ?? self::fingerprint($ref['file'], (float)$ref['start'], $len);
            if ($cache !== null) $cache[$refKey] = $needle;
            if (!$needle) continue;

            $found = self::locate($hay, $needle);
            if ($found === null) continue;
            $result = [
                'start' => ($found['offset'] + $found['first']) * self::ITEM_SECONDS,
                'end' => ($found['offset'] + $found['last'] + 1) * self::ITEM_SECONDS,
                'error' => $found['error'],
                'reference' => $idx,
            ];
            // An almost exact match will not get better: stop looking.
            if ($result['error'] < 0.12) return $result;
            if ($bestResult === null || $result['error'] < $bestResult['error']) $bestResult = $result;
        }
        return $bestResult;
    }
}
