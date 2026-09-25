<?php
// Test to verify total elimination of torrent, aria2, and nyaa artifacts from active code

echo "Running Torrent Subsystem Elimination Verification Tests...\n";

$repoDir = dirname(__DIR__);

// Forbidden keywords in active code
$forbiddenPatterns = [
    'aria2_bin' => '/bin\/aria2c/i',
    'aria2_keyword' => '/\baria2c?\b/i',
    'torrent_downloader' => '/TorrentDownloader/i',
    'nyaa_keyword' => '/\bnyaa\b/i',
    'magnet_link' => '/magnet:\?xt=urn:btih:/i',
    'autodownloader' => '/\banime_autodownloader\b/i'
];

$scanDirs = [
    $repoDir . '/php_backend',
    $repoDir . '/frontend/js',
    $repoDir . '/tests'
];

$violations = [];

foreach ($scanDirs as $dir) {
    if (!is_dir($dir)) continue;
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, RecursiveDirectoryIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        if ($file->isFile()) {
            if (realpath($file->getPathname()) === realpath(__FILE__)) continue;
            // Ignore vendor/lucide or vendor/subtitles-octopus minified binary strings
            if (str_contains($file->getPathname(), 'vendor')) continue;
            $ext = strtolower($file->getExtension());
            if (!in_array($ext, ['php', 'js', 'html', 'json'])) continue;

            $content = @file_get_contents($file->getPathname());
            if ($content === false) continue;

            foreach ($forbiddenPatterns as $name => $pattern) {
                if (preg_match($pattern, $content)) {
                    $violations[] = "Forbidden artifact '{$name}' detected in " . $file->getPathname();
                }
            }
        }
    }
}

// Check if forbidden files still exist on disk
$forbiddenFiles = [
    $repoDir . '/bin/aria2c',
    $repoDir . '/php_backend/services/TorrentDownloader.php',
    $repoDir . '/php_backend/tests/test_torrent_downloader.php',
    $repoDir . '/tests/test_aria2_platform.php',
    $repoDir . '/frontend/js/modules/admin_torrents.js',
    $repoDir . '/php_backend/torrent_state.json'
];

foreach ($forbiddenFiles as $f) {
    if (file_exists($f)) {
        $violations[] = "Forbidden file exists on disk: {$f}";
    }
}

if (!empty($violations)) {
    echo "FAIL: Torrent/aria2 artifacts detected:\n";
    foreach ($violations as $v) {
        echo "  - {$v}\n";
    }
    exit(1);
}

echo "✓ 100% clean: zero torrent/aria2/nyaa artifacts in active codebase.\n";
exit(0);
