<?php
// Test for verifying absence of hardcoded Unicode emojis in frontend UI templates and scripts

echo "Running UI Chrome Emoji Purge Verification Tests...\n";

$repoDir = dirname(__DIR__);
$frontendDir = $repoDir . '/frontend';

// Emoji ranges (miscellaneous symbols, pictographs, transport/map, supplemental symbols, play/pause symbols)
$emojiPattern = '/[\x{1F300}-\x{1F9FF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}\x{25B6}\x{23F8}]/u';

$findings = [];

$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($frontendDir));
foreach ($it as $file) {
    if (!$file->isFile()) continue;
    $ext = strtolower($file->getExtension());
    if (!in_array($ext, ['html', 'js'])) continue;

    $content = file_get_contents($file->getPathname());
    $lines = explode("\n", $content);
    foreach ($lines as $lineNum => $line) {
        if (preg_match($emojiPattern, $line, $matches)) {
            $matchedEmoji = $matches[0];
            $relPath = str_replace($repoDir . DIRECTORY_SEPARATOR, '', $file->getPathname());
            $findings[] = "{$relPath}: line " . ($lineNum + 1) . " contains emoji '{$matchedEmoji}': " . trim($line);
        }
    }
}

if (!empty($findings)) {
    echo "FAIL: Hardcoded emojis found in UI files (" . count($findings) . " occurrences):\n";
    foreach (array_slice($findings, 0, 15) as $f) {
        echo "  - {$f}\n";
    }
    if (count($findings) > 15) {
        echo "  ... and " . (count($findings) - 15) . " more.\n";
    }
    exit(1);
}

echo "✓ 100% clean: zero hardcoded Unicode emojis across all frontend UI code.\n";
exit(0);
