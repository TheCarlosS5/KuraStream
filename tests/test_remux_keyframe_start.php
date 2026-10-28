<?php
/**
 * A stream-copy remux started with -ss begins at the keyframe before the target. FfmpegScanner::keyframeAtOrBefore
 * must report that keyframe, and asking ffmpeg for keyframe + 0.2 s (the availability probe's start_request) must
 * produce a stream that really starts there, so the player's clock (subtitles, progress) matches the picture.
 * Skips when ffmpeg/ffprobe are not installed.
 */
require_once __DIR__ . '/../php_backend/services/FfmpegScanner.php';

echo "Running remux keyframe start tests...\n";

if (FfmpegScanner::getFfmpegPath() === null || FfmpegScanner::getFfprobePath() === null) {
    echo "ffmpeg/ffprobe not installed: skipped.\n";
    exit(0);
}

$dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'kura_keyframe_' . bin2hex(random_bytes(4));
mkdir($dir);
$src = $dir . DIRECTORY_SEPARATOR . 'gop10.mkv';
$out = $dir . DIRECTORY_SEPARATOR . 'remux.mp4';

try {
    // 60 s, one keyframe every 10 s (anime encodes often use GOPs this long), with B-frames like real x264 files.
    $make = FfmpegScanner::ffmpegBin() . ' -v error -y -f lavfi -i testsrc2=size=160x90:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000'
        . ' -t 60 -c:v libx264 -g 240 -keyint_min 240 -sc_threshold 0 -pix_fmt yuv420p -c:a aac ' . escapeshellarg($src);
    FfmpegScanner::executeBoundedCommand($make, 60);
    assert(is_file($src), 'test video could not be generated');

    assert(FfmpegScanner::keyframeAtOrBefore($src, 0) === 0.0);
    assert(abs(FfmpegScanner::keyframeAtOrBefore($src, 5) - 0.0) < 0.01);
    assert(abs(FfmpegScanner::keyframeAtOrBefore($src, 10) - 10.0) < 0.01, 'a keyframe exactly at the target is the answer');
    assert(abs(FfmpegScanner::keyframeAtOrBefore($src, 37) - 30.0) < 0.01);
    assert(abs(FfmpegScanner::keyframeAtOrBefore($src, 59.5) - 50.0) < 0.01);

    // Same flags as PlayerController::streamVideo's copy remux.
    $keyframe = FfmpegScanner::keyframeAtOrBefore($src, 37);
    $request = round($keyframe + 0.2, 3);
    $remux = FfmpegScanner::ffmpegBin() . ' -v error -y -ss ' . $request . ' -i ' . escapeshellarg($src)
        . ' -map 0:v:0 -map 0:a:0 -c:v copy -c:a copy -avoid_negative_ts make_zero -f mp4'
        . ' -movflags frag_keyframe+empty_moov+default_base_moof ' . escapeshellarg($out);
    FfmpegScanner::executeBoundedCommand($remux, 60);
    $duration = (float)trim((string)FfmpegScanner::executeBoundedCommand(
        FfmpegScanner::ffprobeBin() . ' -v error -select_streams v:0 -show_entries stream=duration -of csv=p=0 ' . escapeshellarg($out), 15, false));
    // Starts at 30 s, so 30 s of a 60 s file remain (not 23 s: the target, nor 40 s: one GOP too early).
    assert(abs($duration - 30.0) < 0.5, "remux should start at the keyframe, got {$duration} s of video");

    echo "Remux keyframe start tests passed.\n";
} finally {
    foreach ([$src, $out] as $file) {
        if (is_file($file)) @unlink($file);
    }
    @rmdir($dir);
}
