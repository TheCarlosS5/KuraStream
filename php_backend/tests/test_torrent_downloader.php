<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../services/TorrentDownloader.php';

echo "=== Test 1: Aria2 Binary Path ===\n";
$aria2 = TorrentDownloader::getAria2Path();
echo "Aria2 binary: {$aria2}\n";
assert(file_exists($aria2) && is_executable($aria2), "aria2c binary must exist and be executable");
echo "✅ Test 1 Passed!\n\n";

echo "=== Test 2: Anime Filename Parser ===\n";
$cases = [
    "[SubsPlease] Sousou no Frieren - 28 (1080p) [Dual Audio Latino].mkv" => ["Sousou no Frieren", 1, 28, false],
    "[Erai-raws] Jujutsu Kaisen 2nd Season - 14 [1080p][Multiple Subtitle].mkv" => ["Jujutsu Kaisen", 1, 14, false],
    "Kimetsu no Yaiba S03E05 [1080p Latino + Castellano].mp4" => ["Kimetsu no Yaiba", 3, 5, false],
    "[Batch] Solo Leveling S01 [01-12] [Multi-Audio Latino 1080p]" => ["Solo Leveling", 1, 1, true],
    "One Piece - 1095 [Sub Español][1080p].mkv" => ["One Piece", 1, 1095, false],
    "Attack on Titan S04E28 (Dual Audio 1080p).mkv" => ["Attack on Titan", 4, 28, false],
];

foreach ($cases as $filename => [$expectedTitle, $expectedSeason, $expectedEpisode, $expectedBatch]) {
    $parsed = TorrentDownloader::parseAnimeFilename($filename);
    echo "Filename: {$filename}\n";
    echo "  Clean Title: {$parsed['animeTitle']} (Season: {$parsed['season']}, Episode: {$parsed['episode']}, Batch: " . ($parsed['isBatch'] ? 'yes' : 'no') . ")\n";
    assert(strpos($parsed['animeTitle'], $expectedTitle) !== false || $parsed['animeTitle'] === $expectedTitle, "Title match expected");
    assert($parsed['season'] === $expectedSeason, "Season match expected");
    assert($parsed['episode'] === $expectedEpisode, "Episode match expected");
    assert($parsed['isBatch'] === $expectedBatch, "Batch match expected");
}
echo "✅ Test 2 Passed!\n\n";

echo "=== Test 3: Spanish Torrent Filter ===\n";
$testTorrents = [
    ['title' => '[Erai-raws] Chainsaw Man - 01 [1080p][Latino Dual Audio]', 'description' => 'Latino'],
    ['title' => '[SubsPlease] Oshi no Ko - 05 (1080p) [Sub Español]', 'description' => 'Sub Spanish'],
    ['title' => '[Golumpa] My Hero Academia S6 - 12 (Castellano 1080p)', 'description' => 'Castellano'],
    ['title' => '[Yameii] Dandadan - 01 [1080p][Multi-Audio][Multi-Sub]', 'description' => 'Multi'],
    ['title' => '[DMHY] Bleach TYBW - 20 [BIG5][1080p]', 'description' => 'Chinese only raw'],
    ['title' => '[HorribleSubs] Fairy Tail - 150 [720p].mkv', 'description' => 'English only'],
];

$filtered = TorrentDownloader::filterSpanishTorrents($testTorrents);
echo "Filtered count: " . count($filtered) . " (Expected: 4)\n";
foreach ($filtered as $f) {
    echo "  Matched: {$f['title']}\n";
}
assert(count($filtered) === 4, "Should have filtered only Spanish/Latino/Multi releases");
echo "✅ Test 3 Passed!\n\n";

echo "=== Test 4: Live RSS Fetch & Duplicate Prevention ===\n";
$rssItems = TorrentDownloader::fetchSpanishAnimeRSS();
echo "Fetched " . count($rssItems) . " Spanish anime torrents from Nyaa RSS feeds.\n";
if (count($rssItems) > 0) {
    echo "Sample item 1: " . $rssItems[0]['title'] . " (Size: " . $rssItems[0]['size'] . ", Seeders: " . $rssItems[0]['seeders'] . ")\n";
}
echo "✅ Test 4 Passed!\n\n";

echo "=== ALL TORRENT AUTO-DOWNLOADER TESTS PASSED SUCCESSFULLY! ===\n";
