<?php
// Test for verifying absence of hardcoded Unicode emojis in frontend UI templates

echo "Running UI Chrome Emoji Purge Verification Tests...\n";

$repoDir = dirname(__DIR__);
$targetFiles = [
    $repoDir . '/frontend/index.html',
    $repoDir . '/frontend/js/modules/player_shortcuts_hud.js',
    $repoDir . '/frontend/js/modules/card_popover_preview.js'
];

// Emoji ranges (miscellaneous symbols, pictographs, transport/map, supplemental symbols)
$emojiPattern = '/[\x{1F300}-\x{1F9FF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}]/u';

$findings = [];

foreach ($targetFiles as $file) {
    if (!file_exists($file)) continue;
    $content = file_get_contents($file);
    $lines = explode("\n", $content);
    foreach ($lines as $lineNum => $line) {
        if (preg_match($emojiPattern, $line, $matches)) {
            $matchedEmoji = $matches[0];
            $findings[] = basename($file) . ": line " . ($lineNum + 1) . " contains emoji '{$matchedEmoji}': " . trim($line);
        }
    }
}

if (!empty($findings)) {
    echo "FAIL: Hardcoded emojis found in UI templates (" . count($findings) . " occurrences):\n";
    foreach (array_slice($findings, 0, 15) as $f) {
        echo "  - {$f}\n";
    }
    if (count($findings) > 15) {
        echo "  ... and " . (count($findings) - 15) . " more.\n";
    }
    exit(1);
}

echo "✓ 100% clean: zero hardcoded Unicode emojis in UI chrome.\n";
exit(0);
