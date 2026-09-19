<?php
/**
 * Test UI Assets: Design Tokens, CSS Scale, Billboard Hero & Continue Watching
 * Tasks: Task 1 & Task 2
 */

echo "Running UI Assets CSS Scale, Billboard Hero & Continue Watching Tests...\n";

$cssPath = __DIR__ . '/../frontend/style.css';
if (!file_exists($cssPath)) {
    echo "FAIL: frontend/style.css does not exist\n";
    exit(1);
}

$css = file_get_contents($cssPath);
$errors = [];

// 1. Tokens in :root (Task 1)
if (!preg_match('/--radius-xs:\s*2px;/', $css)) {
    $errors[] = "Missing '--radius-xs: 2px;' in style.css";
}

if (!preg_match('/--radius-sm:\s*4px;/', $css)) {
    $errors[] = "Missing '--radius-sm: 4px;' in style.css";
}

if (!preg_match('/--radius-md:\s*6px;/', $css)) {
    $errors[] = "Missing '--radius-md: 6px;' in style.css";
}

if (!preg_match('/--radius-lg:\s*8px;/', $css)) {
    $errors[] = "Missing '--radius-lg: 8px;' in style.css";
}

if (!preg_match('/--content-max-width:\s*1600px;/', $css)) {
    $errors[] = "Missing '--content-max-width: 1600px;' in style.css";
}

if (!preg_match('/--progress-color:\s*#e50914;/', $css)) {
    $errors[] = "Missing '--progress-color: #e50914;' in style.css";
}

if (!preg_match('/--bg-color:\s*#08090b;/', $css)) {
    $errors[] = "Missing '--bg-color: #08090b;' in style.css";
}

// 2. .show-card border-radius (Task 1)
if (preg_match('/\.show-card\s*\{[^}]*border-radius:\s*12px;/s', $css)) {
    $errors[] = ".show-card must not use 'border-radius: 12px;'";
}

if (!preg_match('/\.show-card\s*\{[^}]*border-radius:\s*(?:var\(--radius-sm\)|4px);/s', $css)) {
    $errors[] = ".show-card must use 'var(--radius-sm)' or '4px' for border-radius";
}

// 3. Crisp border radii on components (Task 1)
if (preg_match('/\.episode-item\s*\{[^}]*border-radius:\s*12px;/s', $css)) {
    $errors[] = ".episode-item must not use 'border-radius: 12px;'";
}

if (preg_match('/\.detail-poster\s*\{[^}]*border-radius:\s*12px;/s', $css)) {
    $errors[] = ".detail-poster must not use 'border-radius: 12px;'";
}

if (preg_match('/\.admin-card\s*\{[^}]*border-radius:\s*12px;/s', $css)) {
    $errors[] = ".admin-card must not use 'border-radius: 12px;'";
}

// 4. Layout containers max-width: var(--content-max-width) (Task 1)
if (!preg_match('/(?:\.container|\.catalog-container|\.hero-banner)\s*\{[^}]*max-width:\s*var\(--content-max-width\);/s', $css)) {
    $errors[] = "Layout container must specify 'max-width: var(--content-max-width);'";
}

// 5. Billboard Hero in style.css (Task 2)
if (!preg_match('/\.billboard-hero\b/', $css)) {
    $errors[] = "Missing '.billboard-hero' styling in style.css";
}

if (!preg_match('/\.billboard-hero\s*\{[^}]*min-height:\s*(?:6[0-9]vh|7[0-9]vh)/s', $css) &&
    !preg_match('/\.billboard-hero[^{]*\{[^}]*height:\s*(?:6[0-9]vh|7[0-9]vh)/s', $css)) {
    $errors[] = ".billboard-hero must have cinematic height (min-height or height: 60-75vh)";
}

if (!preg_match('/rgba\(8,\s*9,\s*11,\s*0\.95\)/', $css) && !preg_match('/linear-gradient\([^)]*#08090b/', $css)) {
    $errors[] = "Missing dual vignette gradient masking with #08090b / rgba(8,9,11,...) in style.css";
}

// 6. Continue Watching in style.css (Task 2)
if (!preg_match('/\.continue-watching-card\b|\.continue-watching\b/', $css)) {
    $errors[] = "Missing '.continue-watching' or '.continue-watching-card' in style.css";
}

if (!preg_match('/16\s*\/\s*9/', $css)) {
    $errors[] = "Missing 16:9 widescreen aspect ratio in style.css";
}

if (!preg_match('/--progress-color/', $css)) {
    $errors[] = "Missing '--progress-color' usage in style.css";
}

// 7. Billboard Hero & Continue Watching in app.js (Task 2)
$jsPath = __DIR__ . '/../frontend/app.js';
if (!file_exists($jsPath)) {
    $errors[] = "frontend/app.js does not exist";
} else {
    $js = file_get_contents($jsPath);
    if (!preg_match('/function\s+renderBillboardHero\b|const\s+renderBillboardHero\b/', $js)) {
        $errors[] = "Missing 'renderBillboardHero' in frontend/app.js";
    }
    if (!preg_match('/function\s+renderContinueWatching\b|const\s+renderContinueWatching\b/', $js)) {
        $errors[] = "Missing 'renderContinueWatching' in frontend/app.js";
    }
    if (!preg_match('/billboard-hero/', $js)) {
        $errors[] = "Missing 'billboard-hero' element markup in frontend/app.js";
    }
    if (!preg_match('/continue-watching/', $js)) {
        $errors[] = "Missing 'continue-watching' element markup in frontend/app.js";
    }
    if (!preg_match('/Reproducir/i', $js) || !preg_match('/M[áa]s informaci[óo]n/iu', $js)) {
        $errors[] = "Missing Billboard Hero CTAs ('Reproducir' and 'Más información') in frontend/app.js";
    }
}

if (!empty($errors)) {
    echo "FAIL:\n - " . implode("\n - ", $errors) . "\n";
    exit(1);
}

echo "✓ UI Assets CSS Scale, Billboard Hero & Continue Watching Tests Passed\n";
exit(0);
