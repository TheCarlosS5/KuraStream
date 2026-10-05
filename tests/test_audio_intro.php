<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/services/AudioIntroDetector.php';
require_once __DIR__ . '/../php_backend/services/AudioIntroSync.php';
require_once __DIR__ . '/../php_backend/services/IntroSync.php';
require_once __DIR__ . '/../php_backend/services/AudioOutroSync.php';

echo "Running audio opening detection Tests...\n";

mt_srand(20261004);
$random = fn(int $n) => array_map(fn() => mt_rand(0, 0x7FFFFFFF) | (mt_rand(0, 1) << 31), range(1, $n));
// Same audio decoded twice differs in a few bits on some points.
$noisy = fn(array $fp) => array_map(fn($v) => mt_rand(0, 9) < 3 ? $v ^ (1 << mt_rand(0, 31)) ^ (1 << mt_rand(0, 31)) : $v, $fp);
$S = AudioIntroDetector::ITEM_SECONDS;

$opening = $random(727);                                  // ~90 s
$a = $random(4800);                                       // ~10 min of episode A
array_splice($a, 500, 727, $noisy($opening));             // opening at ~62 s
$b = $random(4800);
array_splice($b, 1700, 727, $noisy($opening));            // opening at ~210 s in episode B

// With a reference: the opening is found where it is, whole.
$hit = AudioIntroDetector::locate($b, $opening);
assert($hit !== null && $hit['offset'] === 1700, 'Reference opening located at its offset');
assert($hit['first'] === 0 && $hit['last'] === 726, 'An intact opening is matched end to end');
assert($hit['error'] < 0.05, 'Same audio has a low bit error');
assert(AudioIntroDetector::locate($random(4800), $opening) === null, 'Unrelated audio is not an opening');

// A variant that changes in its second half still gives the right start.
$variant = $noisy($opening);
array_splice($variant, 420, 307, $random(307));
$c = $random(4800);
array_splice($c, 900, 727, $variant);
$hit = AudioIntroDetector::locate($c, $opening);
assert($hit !== null && $hit['offset'] === 900 && $hit['first'] === 0 && $hit['last'] < 440, 'Variant: start found, end cut where the song changes');
$full = AudioIntroSync::fullLength(['start' => 900 * $S, 'end' => (900 + 430) * $S], 90.0);
assert(abs($full['end'] - (900 * $S + 90.0)) < 0.01, 'A cut match is extended to the usual opening length');
$kept = AudioIntroSync::fullLength(['start' => 10.0, 'end' => 95.0], 90.0);
assert($kept['end'] === 95.0, 'A full-length match is kept as found');

// Without a reference: the shared stretch of two episodes is the opening.
$shared = AudioIntroDetector::commonSegment($a, $b);
assert($shared !== null, 'Shared opening found without a reference');
assert(abs($shared['a'] - 500) <= 2 && abs($shared['b'] - 1700) <= 2, 'Shared opening placed in both episodes');
assert(abs($shared['length'] - 727) <= 3, 'Shared opening has the full length');
assert(AudioIntroDetector::commonSegment($a, $random(4800)) === null, 'Episodes with nothing in common share nothing');
// A short repeated sting (a 10 s bumper) is not an opening.
$sting = $random(80);
$d = $random(4800); array_splice($d, 100, 80, $sting);
$e = $random(4800); array_splice($e, 300, 80, $sting);
assert(AudioIntroDetector::commonSegment($d, $e) === null, 'Short shared audio is ignored');

// Sources the audio pass writes are respected by the AniSkip pass.
assert(IntroSync::needsLookup(['intro_source' => 'audio', 'intro_start' => 40], true) === false, 'Audio-found openings are kept even with --force');
assert(IntroSync::needsLookup(['intro_source' => 'aniskip_checked', 'intro_start' => 40]) === false, 'Checked AniSkip openings are done');
assert(IntroSync::needsLookup(['intro_source' => 'none', 'intro_start' => null, 'intro_checked_at' => date('Y-m-d H:i:s', time() - 86400)]) === false, 'A recent miss waits');
assert(IntroSync::needsLookup(['intro_source' => 'none', 'intro_start' => null, 'intro_checked_at' => date('Y-m-d H:i:s', time() - 8 * 86400)]) === true, 'An old miss is retried');

// Ending credits by audio: what is looked for and where.
assert(AudioOutroSync::wantsAudio(['outro_source' => 'aniskip_none', 'outro_start' => null, 'outro_end' => null]) === true, 'An ending AniSkip lacks is looked for');
assert(AudioOutroSync::wantsAudio(['outro_source' => 'aniskip', 'outro_start' => 1300, 'outro_end' => 1390]) === false, 'A known ending is only checked');
assert(AudioOutroSync::wantsAudio(['outro_source' => 'manual', 'outro_start' => null, 'outro_end' => null]) === false, 'An admin decision is kept');
assert(AudioOutroSync::wantsAudio(['outro_source' => 'none', 'outro_checked_at' => date('Y-m-d H:i:s', time() - 86400)]) === false, 'A recent miss waits');
assert(AudioOutroSync::wantsAudio(['outro_source' => 'none', 'outro_checked_at' => date('Y-m-d H:i:s', time() - 8 * 86400)]) === true, 'An old miss is retried');
assert(AudioOutroSync::tailStart(1420.0) === 940.0, 'The last 8 minutes of a regular episode are analysed');
assert(AudioOutroSync::tailStart(600.0) === 300.0, 'Short episodes: only the second half');

echo "✓ Audio opening detection tests passed\n";
