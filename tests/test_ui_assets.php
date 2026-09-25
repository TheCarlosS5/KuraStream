<?php
/**
 * Test UI Assets: Semantic Design Tokens, Contrast, Layout & Escaping
 */

echo "Running UI Assets Contract & Design System Tests...\n";

$cssPath = __DIR__ . '/../frontend/style.css';
if (!file_exists($cssPath)) {
    echo "FAIL: frontend/style.css does not exist\n";
    exit(1);
}

$css = file_get_contents($cssPath);
$errors = [];

// 1. Semantic Design Tokens in CSS
$requiredTokens = [
    'bg-color' => '#090D0E',
    'surface-color' => '#131A1C',
    'accent-color' => '#F97316',
    'accent-hover' => '#FB923C',
    'success-color' => '#2DD4BF',
    'rating-color' => '#FBBF24',
    'text-main' => '#F4F8F9',
    'text-muted' => '#93A4A7',
    'danger-color' => '#FB7185'
];

foreach ($requiredTokens as $token => $val) {
    if (!preg_match('/--' . preg_quote($token, '/') . ':\s*' . preg_quote($val, '/') . '/i', $css)) {
        $errors[] = "Missing semantic token --$token: $val";
    }
}

// 2. Strict radii standards (4px standard)
if (!preg_match('/--radius-sm:\s*4px/i', $css)) {
    $errors[] = "Missing standard '--radius-sm: 4px' token";
}

// 3. No purple AI brand palette
if (preg_match('/#(?:a855f7|c084fc|9333ea)|rgba?\(\s*168,\s*85,\s*247/i', $css)) {
    $errors[] = "Active CSS must not retain the obsolete purple brand palette";
}

// 4. Layout container max width
if (!preg_match('/--content-max-width:\s*1600px/i', $css)) {
    $errors[] = "Missing '--content-max-width: 1600px' token";
}

// 5. Hero & Billboard styles
if (!preg_match('/\.billboard-hero\b/', $css)) {
    $errors[] = "Missing '.billboard-hero' styling in style.css";
}

// 6. Continue Watching component
if (!preg_match('/\.continue-watching\b|\.continue-watching-card\b/', $css)) {
    $errors[] = "Missing '.continue-watching' component styling in style.css";
}

// 7. Verify helper scripts if present
$catalogueScript = __DIR__ . '/ui_catalogue_rendering.mjs';
if (file_exists($catalogueScript)) {
    $renderOutput = [];
    $renderStatus = 0;
    exec('node ' . escapeshellarg($catalogueScript) . ' 2>&1', $renderOutput, $renderStatus);
    if ($renderStatus !== 0) {
        $errors[] = "Catalogue rendering regression: " . implode("\n", $renderOutput);
    }
}

if (!empty($errors)) {
    echo "FAIL:\n - " . implode("\n - ", $errors) . "\n";
    exit(1);
}

echo "✓ UI Assets Contract & Design System Tests Passed\n";
exit(0);
