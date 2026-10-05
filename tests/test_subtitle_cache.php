<?php
$work = sys_get_temp_dir() . '/kura_subcache_' . getmypid();
@mkdir($work . '/bin', 0777, true);
putenv('SUBTITLE_CACHE_DIR=' . $work . '/cache');
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/services/SubtitleCache.php';

echo "Running subtitle cache tests (atomic writes, shared extraction, process limit, fonts)...\n";

function sc_rm(string $p): void {
    if (is_link($p) || is_file($p)) { @unlink($p); return; }
    if (!is_dir($p)) return;
    foreach (array_diff(scandir($p), ['.', '..']) as $e) sc_rm("$p/$e");
    @rmdir($p);
}

/** Runs PHP code in a child that shares this test's environment; returns the process (stdout piped). */
function sc_child(string $code, array $env = []): array {
    $proc = proc_open([PHP_BINARY, '-r', $code], [1 => ['pipe', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, null, array_merge(getenv(), $env));
    return [$proc, $pipes];
}
function sc_wait(array $child): string {
    $out = stream_get_contents($child[1][1]);
    fclose($child[1][1]);
    proc_close($child[0]);
    return (string)$out;
}

try {
    // Fixture: an MKV with one ASS track and one attached font
    $ass = "[Script Info]\nTitle: t\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.10,0:00:00.90,Default,,0,0,0,,Hola mundo\n";
    file_put_contents("$work/sub.ass", $ass);
    file_put_contents("$work/MyFont.ttf", random_bytes(2048));
    $video = "$work/episode.mkv";
    exec(sprintf('ffmpeg -nostdin -y -v error -f lavfi -i testsrc=duration=1:size=64x64:rate=5 -i %s -map 0:v -map 1:0 -c:v libx264 -c:s ass -attach %s -metadata:s:t mimetype=application/x-truetype-font %s 2>&1',
        escapeshellarg("$work/sub.ass"), escapeshellarg("$work/MyFont.ttf"), escapeshellarg($video)), $o, $rc);
    assert($rc === 0 && is_file($video), 'ffmpeg must build the fixture: ' . implode("\n", $o));

    // 1. Extraction goes to the cache, leaves no temp files, and is reused
    $file = SubtitleCache::ensureTrack($video, -1, 0);
    assert($file !== null && str_contains((string)file_get_contents($file), 'Hola mundo'), 'the track is extracted as ASS');
    assert(glob(SubtitleCache::dir() . '/*.part') === [], 'no temp file is left behind');
    $mtime = filemtime($file);
    sleep(1);
    assert(SubtitleCache::ensureTrack($video, -1, 0) === $file && filemtime($file) === $mtime, 'a second request reuses the cached file');

    // 2. A failing extraction leaves no cache entry (nothing truncated can be served)
    assert(SubtitleCache::ensureTrack($video, 99, 99) === null, 'a track that does not exist is not available');
    assert(!is_file(SubtitleCache::trackCacheFile($video, 99, 99)) && glob(SubtitleCache::dir() . '/*.part') === [], 'and nothing is cached for it');

    // 3. A killed (timed-out) ffmpeg that already wrote some output must not poison the cache
    $fake = "$work/bin/ffmpeg";
    file_put_contents($fake, <<<'SH'
#!/bin/bash
# Fake ffmpeg: logs start/end, writes a truncated "ass" to the last argument, then takes its time.
LOG="${FAKE_LOG:-/dev/null}"
OUT="${@: -1}"
echo "start $(date +%s.%N)" >> "$LOG"
case "$OUT" in *.part) echo "[Script Info]" > "$OUT";; esac
sleep "${FAKE_SLEEP:-30}"
if [ -n "$FAKE_COMPLETE" ]; then case "$OUT" in *.part) printf 'Dialogue: complete\n' >> "$OUT";; esac; fi
echo "end $(date +%s.%N)" >> "$LOG"
exit 0
SH);
    chmod($fake, 0755);
    $realPath = getenv('PATH');
    putenv("PATH=$work/bin:$realPath");
    putenv('FAKE_SLEEP=30');
    $t0 = microtime(true);
    assert(SubtitleCache::ensureTrack("$work/episode.mkv", 5, 5, 1) === null, 'a timed-out extraction fails');
    assert(microtime(true) - $t0 < 6, 'within the time limit');
    assert(!is_file(SubtitleCache::trackCacheFile($video, 5, 5)), 'the truncated output was not published');
    assert(glob(SubtitleCache::dir() . '/*.part') === [], 'and its temp file was removed');
    echo "✓ Atomic extraction OK\n";

    // 4. Concurrent requests for the same track run ffmpeg once; different tracks respect SUBTITLE_MAX_PROCS=1
    $log = "$work/ffmpeg.log";
    @unlink($log);
    $env = ['FAKE_LOG' => $log, 'FAKE_SLEEP' => '1', 'FAKE_COMPLETE' => '1', 'SUBTITLE_MAX_PROCS' => '1', 'PATH' => "$work/bin:$realPath"];
    $code = fn(int $idx) => 'define("TESTING_MODE", true); require ' . var_export(__DIR__ . '/../php_backend/services/SubtitleCache.php', true)
        . '; $f = SubtitleCache::ensureTrack(' . var_export($video, true) . ', ' . $idx . ', ' . $idx . ', 20); echo $f === null ? "NULL" : "OK";';
    $same = [sc_child($code(7), $env), sc_child($code(7), $env), sc_child($code(7), $env)];
    $outs = array_map('sc_wait', $same);
    assert($outs === ['OK', 'OK', 'OK'], 'every waiter gets the file: ' . json_encode($outs));
    $starts = substr_count((string)file_get_contents($log), 'start');
    assert($starts === 1, "three simultaneous requests for one track started ffmpeg $starts time(s), expected 1");

    @unlink($log);
    $diff = [sc_child($code(11), $env), sc_child($code(12), $env), sc_child($code(13), $env)];
    $t0 = microtime(true);
    $outs = array_map('sc_wait', $diff);
    assert($outs === ['OK', 'OK', 'OK'], 'three different tracks all complete: ' . json_encode($outs));
    $events = [];
    foreach (file($log, FILE_IGNORE_NEW_LINES) as $line) {
        [$kind, $ts] = explode(' ', $line);
        $events[] = [(float)$ts, $kind === 'start' ? 1 : -1];
    }
    usort($events, fn($a, $b) => $a[0] <=> $b[0]);
    $running = 0; $peak = 0;
    foreach ($events as [, $d]) { $running += $d; $peak = max($peak, $running); }
    assert(count($events) === 6 && $peak === 1, "with SUBTITLE_MAX_PROCS=1 no two ffmpeg ran together (peak $peak)");
    echo "✓ Shared extraction and process limit OK\n";

    // 5. Fonts: a killed extraction is not marked complete; a real one is, and nothing temporary stays
    putenv('FAKE_SLEEP=30');
    assert(SubtitleCache::ensureFonts($video, 1) === [] && !SubtitleCache::fontsReady($video), 'a timed-out font extraction is not trusted');
    putenv("PATH=$realPath");
    $fonts = SubtitleCache::ensureFonts($video);
    assert($fonts === ['MyFont.ttf'] && SubtitleCache::fontsReady($video), 'fonts are extracted and marked complete: ' . json_encode($fonts));
    assert(glob(SubtitleCache::dir() . '/fonts/*.tmp') === [], 'no temp dir is left');
    assert(SubtitleCache::ensureFonts($video) === ['MyFont.ttf'], 'fonts are served from the cache afterwards');

    // 6. prepareEpisode (what the worker runs) produces track + fonts and skips bitmap tracks
    sc_rm(SubtitleCache::dir());
    $ep = ['filepath' => $video, 'subtitle_tracks' => json_encode([
        ['track_number' => 0, 'index' => 2, 'codec' => 'ass', 'is_bitmap' => false],
        ['track_number' => 1, 'index' => 3, 'codec' => 'hdmv_pgs_subtitle', 'is_bitmap' => true],
    ])];
    // index 2 does not exist in this file (video=0, sub=1): by-index extraction fails, by-position works
    $r = SubtitleCache::prepareEpisode($ep);
    assert($r['failed'] === 1 && $r['tracks'] === 0, 'a bad track index is counted as failed: ' . json_encode($r));
    $ep['subtitle_tracks'] = json_encode([['track_number' => 0, 'index' => 1, 'codec' => 'ass', 'is_bitmap' => false], ['track_number' => 1, 'index' => 3, 'is_bitmap' => true]]);
    $r = SubtitleCache::prepareEpisode($ep);
    assert($r['tracks'] === 1 && $r['failed'] === 0 && SubtitleCache::fontsReady($video), 'prepareEpisode extracts the track and the fonts: ' . json_encode($r));
    $again = SubtitleCache::prepareEpisode($ep);
    assert($again['failed'] === 0, 'running it again is harmless');
    echo "✓ Fonts and episode preparation OK\n";
} finally {
    sc_rm($work);
}
echo "All subtitle cache tests passed.\n";
