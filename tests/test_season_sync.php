<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/services/SeasonSync.php';
require_once __DIR__ . '/../php_backend/services/IntroSync.php';

echo "Running Season Sync / AniSkip mapping Tests...\n";

function weekly(string $first, int $count, int $startEp = 1): array {
    $out = [];
    $ts = strtotime($first . ' 00:00:00 UTC');
    for ($i = 0; $i < $count; $i++) $out[$startEp + $i] = gmdate('Y-m-d', $ts + $i * 7 * 86400);
    return $out;
}

function entry(int $id, int $mal, ?int $episodes, string $status, array $start, array $end): array {
    $d = fn($a) => ['year' => $a[0] ?? null, 'month' => $a[1] ?? null, 'day' => $a[2] ?? null];
    return ['id' => $id, 'idMal' => $mal, 'episodes' => $episodes, 'status' => $status, 'startDate' => $d($start), 'endDate' => $d($end)];
}

// Mushoku Tensei as TMDB and AniList really describe it (2026-10): TMDB season 1 = MAL "Part 1"
// (11 eps) + "Part 2" (12), TMDB season 2 = MAL "II" (AniList: 13 eps counting the prologue TMDB
// files as a special) + "II Part 2" (12), TMDB season 3 = MAL "III" (14, double premiere).
$s1 = weekly('2021-01-11', 11) + weekly('2021-10-04', 12, 12);
$s2 = weekly('2023-07-10', 12) + weekly('2024-04-08', 12, 13);
$s3 = [1 => '2026-07-04', 2 => '2026-07-04'] + weekly('2026-07-13', 12, 3);
$chain = [
    entry(108465, 39535, 11, 'FINISHED', [2021, 1, 11], [2021, 3, 22]),
    entry(127720, 45576, 12, 'FINISHED', [2021, 10, 4], [2021, 12, 20]),
    entry(146065, 51179, 13, 'FINISHED', [2023, 7, 3], [2023, 9, 25]),
    entry(166873, 55888, 12, 'FINISHED', [2024, 4, 8], [2024, 7, 1]),
    entry(178789, 59193, 14, 'FINISHED', [2026, 7, 4], [2026, 9, 27]),
    entry(217434, 65077, null, 'NOT_YET_RELEASED', [2027], []),
];
$map = SeasonSync::buildSeasonMap([1 => $s1, 2 => $s2, 3 => $s3], $chain);

$mal = fn(int $season, int $ep) => SeasonSync::malEpisode($map[$season]['segments'] ?? [], $ep);
assert($mal(1, 1) === ['mal_id' => 39535, 'episode' => 1], 'S1E1 is Part 1 episode 1');
assert($mal(1, 11) === ['mal_id' => 39535, 'episode' => 11], 'S1E11 is the last of Part 1');
assert($mal(1, 12) === ['mal_id' => 45576, 'episode' => 1], 'S1E12 starts Part 2 (second cour)');
assert($mal(1, 23) === ['mal_id' => 45576, 'episode' => 12], 'S1E23 ends Part 2');
assert($mal(1, 24) === null, 'An episode TMDB does not know and MAL has no room for stays unmapped');
// AniList counts the S2 prologue inside "II" (13 eps), but AniSkip's "episode 2" opening is in the
// file S02E02 (verified on the real files), so the prologue does not shift the numbering.
assert($mal(2, 0) === null, 'The S2 prologue (file S02E00) has no AniSkip episode');
assert($mal(2, 1) === ['mal_id' => 51179, 'episode' => 1], 'S2E1 is AniSkip episode 1');
assert($mal(2, 12) === ['mal_id' => 51179, 'episode' => 12], 'S2E12 is the last aired episode of "II"');
assert($mal(2, 13) === ['mal_id' => 55888, 'episode' => 1], 'S2E13 starts "II Part 2"');
assert($mal(3, 2) === ['mal_id' => 59193, 'episode' => 2], 'Double premiere keeps its order');
assert($mal(3, 14) === ['mal_id' => 59193, 'episode' => 14], 'S3E14');
assert($map[1]['entry'] === 0 && $map[2]['entry'] === 2 && $map[3]['entry'] === 4, 'Each season takes the art of its first MAL entry');

// A library that only has season 2 still maps through the whole franchise (New Game!!).
$ng = SeasonSync::buildSeasonMap([1 => weekly('2016-07-04', 12), 2 => weekly('2017-07-11', 12)], [
    entry(21455, 31953, 12, 'FINISHED', [2016, 7, 4], [2016, 9, 19]),
    entry(98476, 34914, 12, 'FINISHED', [2017, 7, 11], [2017, 9, 26]),
]);
assert(SeasonSync::malEpisode($ng[2]['segments'], 5) === ['mal_id' => 34914, 'episode' => 5], 'Second season maps to its own MAL entry');

// No AniList data (offline): nothing is mapped, nothing breaks.
assert(SeasonSync::buildSeasonMap([1 => $s1], []) === [], 'Empty franchise gives an empty map');
assert(SeasonSync::malEpisode([], 3) === null, 'No segments, no MAL episode');

// Episodes airing long after the last known entry are not forced into it.
$late = SeasonSync::buildSeasonMap([1 => weekly('2021-01-11', 11), 2 => weekly('2025-01-01', 3)], [$chain[0]]);
assert(!isset($late[2]), 'A season with no MAL entry yet stays unmapped');

// IntroSync: which episodes to ask for and what gets stored.
assert(IntroSync::needsLookup(['intro_source' => null, 'intro_start' => null]) === true, 'New episode is looked up');
assert(IntroSync::needsLookup(['intro_source' => 'manual', 'intro_start' => 80]) === false, 'Admin timings are never replaced');
assert(IntroSync::needsLookup(['intro_source' => 'manual', 'intro_start' => 80], true) === false, 'Not even with --force');
assert(IntroSync::needsLookup(['intro_source' => null, 'intro_start' => 80], true) === false, 'Timings from before sources existed are kept');
assert(IntroSync::needsLookup(['intro_source' => 'chapters', 'intro_start' => 0]) === false, 'Chapter timings are kept');
assert(IntroSync::needsLookup(['intro_source' => 'aniskip', 'intro_start' => 70]) === false, 'Done once');
assert(IntroSync::needsLookup(['intro_source' => 'aniskip', 'intro_start' => 70], true) === true, 'Force asks again');
assert(IntroSync::needsLookup(['intro_source' => 'aniskip_none', 'intro_start' => null, 'intro_checked_at' => date('Y-m-d H:i:s', time() - 86400)]) === false, 'A miss is retried later, not every scan');
assert(IntroSync::needsLookup(['intro_source' => 'aniskip_none', 'intro_start' => null, 'intro_checked_at' => date('Y-m-d H:i:s', time() - 8 * 86400)]) === true, 'A miss is retried after a week');

$t = IntroSync::timingsFromSkip(['duration' => 1422.0, 'intro_source' => null, 'outro_start' => null], ['op' => [70.4, 155.2], 'ed' => [1326.778, 1416.778]]);
assert($t === ['intro_start' => 70, 'intro_end' => 155, 'outro_start' => 1326, 'outro_end' => 1417, 'intro_source' => 'aniskip'], 'Opening and ending stored');
$t = IntroSync::timingsFromSkip(['duration' => 1420.0, 'intro_source' => 'aniskip_none', 'outro_start' => 4], ['op' => [0.0, 11.0], 'ed' => [5.0, 95.0]]);
assert($t['outro_start'] === null && $t['outro_end'] === null, 'An ending in the first half is rejected and the bad one cleared');
$t = IntroSync::timingsFromSkip(['duration' => 1422.0, 'intro_source' => null, 'outro_start' => null], ['op' => null, 'ed' => [1118.0, 1200.0]]);
assert($t['outro_start'] === 1118 && $t['outro_end'] === 1200, 'Credits followed by a scene keep their end');
$t = IntroSync::timingsFromSkip(['duration' => 1422.0, 'intro_source' => null, 'outro_start' => 1300], ['op' => null, 'ed' => [1326.0, 1416.0]]);
assert($t === ['intro_source' => 'aniskip_none'], 'An outro set by hand is kept; no opening means a miss');
$t = IntroSync::timingsFromSkip(['duration' => 1422.0, 'intro_source' => 'aniskip', 'intro_start' => 70, 'outro_start' => 1326], ['op' => null, 'ed' => null]);
assert($t['intro_start'] === null && $t['intro_source'] === 'aniskip_none', 'A forced re-check clears an opening AniSkip no longer has');

echo "✓ Season sync tests passed\n";
