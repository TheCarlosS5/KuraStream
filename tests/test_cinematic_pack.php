<?php
/**
 * Test Cinematic Pack & Pro Player Verification
 */
echo "Running Cinematic Pack & Pro Player Verification Tests...\n";

$errors = [];

// 1. Verify Local Iconography Suite
$lucideVendor = __DIR__ . '/../frontend/vendor/lucide/lucide.min.js';
if (!file_exists($lucideVendor) || filesize($lucideVendor) < 1000) {
    $errors[] = "frontend/vendor/lucide/lucide.min.js is missing or empty";
}

// 2. Verify Module Files Exist
$modules = [
    'player_scrub_preview.js' => __DIR__ . '/../frontend/js/modules/player_scrub_preview.js',
    'player_tracks_modal.js' => __DIR__ . '/../frontend/js/modules/player_tracks_modal.js',
    'card_popover_preview.js' => __DIR__ . '/../frontend/js/modules/card_popover_preview.js',
];

foreach ($modules as $name => $path) {
    if (!file_exists($path)) {
        $errors[] = "Module frontend/js/modules/$name does not exist";
    }
}

// 3. Verify CSS Classes and Selectors in style.css
$cssPath = __DIR__ . '/../frontend/style.css';
if (!file_exists($cssPath)) {
    $errors[] = "frontend/style.css does not exist";
} else {
    $css = file_get_contents($cssPath);
    if (!preg_match('/\.scrub-preview-tooltip\b/', $css)) {
        $errors[] = "Missing '.scrub-preview-tooltip' styling in style.css";
    }
    if (!preg_match('/\.tracks-modal-container\b|\.tracks-modal-dialog\b/', $css)) {
        $errors[] = "Missing '.tracks-modal-container' or '.tracks-modal-dialog' in style.css";
    }
    if (!preg_match('/\.popover-card-preview\b/', $css)) {
        $errors[] = "Missing '.popover-card-preview' in style.css";
    }
    if (!preg_match('/#player-pip-btn\b|\.player-pip-btn\b/', $css)) {
        $errors[] = "Missing Picture-in-Picture button styling in style.css";
    }
    if (!preg_match('/#player-speed-btn\b|\.player-speed-btn\b/', $css)) {
        $errors[] = "Missing playback speed button styling in style.css";
    }
}

// 4. Verify Player Integration
$playerJsPath = __DIR__ . '/../frontend/player.js';
if (!file_exists($playerJsPath)) {
    $errors[] = "frontend/player.js does not exist";
} else {
    $playerJs = file_get_contents($playerJsPath);
    if (!str_contains($playerJs, 'player_scrub_preview') && !str_contains($playerJs, 'initScrubPreview')) {
        $errors[] = "player.js must integrate scrub preview engine";
    }
    if (!str_contains($playerJs, 'player_tracks_modal') && !str_contains($playerJs, 'openTracksModal') && !str_contains($playerJs, 'initTracksModal')) {
        $errors[] = "player.js must integrate tracks modal";
    }
    if (!str_contains($playerJs, 'requestPictureInPicture')) {
        $errors[] = "player.js must implement Picture-in-Picture API";
    }
}

// 5. Verify App Integration for Hover Popovers
$appJsPath = file_exists(__DIR__ . '/../frontend/js/main.js')
    ? __DIR__ . '/../frontend/js/main.js'
    : __DIR__ . '/../frontend/app.js';
if (!file_exists($appJsPath)) {
    $errors[] = "Application entry point does not exist";
} else {
    $appJs = file_get_contents($appJsPath);
    if (!str_contains($appJs, 'card_popover_preview') && !str_contains($appJs, 'initCardPopovers')) {
        $errors[] = "Application must integrate card popover preview engine";
    }
}

if (!empty($errors)) {
    echo "FAIL:\n - " . implode("\n - ", $errors) . "\n";
    exit(1);
}

echo "✓ Cinematic Pack & Pro Player Tests Passed\n";
exit(0);
