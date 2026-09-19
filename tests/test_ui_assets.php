<?php
/**
 * Test UI Assets: Design Tokens & CSS Scale (Netflix Crisp 4px Radii & Jet Black Theme)
 * Task 1: Design Tokens, Modern Radii & Expansive Containers
 */

echo "Running UI Assets CSS Scale & Radii Tests...\n";

$cssPath = __DIR__ . '/../frontend/style.css';
if (!file_exists($cssPath)) {
    echo "FAIL: frontend/style.css does not exist\n";
    exit(1);
}

$css = file_get_contents($cssPath);
$errors = [];

// 1. Tokens in :root
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

// 2. .show-card border-radius
if (preg_match('/\.show-card\s*\{[^}]*border-radius:\s*12px;/s', $css)) {
    $errors[] = ".show-card must not use 'border-radius: 12px;'";
}

if (!preg_match('/\.show-card\s*\{[^}]*border-radius:\s*(?:var\(--radius-sm\)|4px);/s', $css)) {
    $errors[] = ".show-card must use 'var(--radius-sm)' or '4px' for border-radius";
}

// 3. Crisp border radii on components
if (preg_match('/\.episode-item\s*\{[^}]*border-radius:\s*12px;/s', $css)) {
    $errors[] = ".episode-item must not use 'border-radius: 12px;'";
}

if (preg_match('/\.detail-poster\s*\{[^}]*border-radius:\s*12px;/s', $css)) {
    $errors[] = ".detail-poster must not use 'border-radius: 12px;'";
}

if (preg_match('/\.admin-card\s*\{[^}]*border-radius:\s*12px;/s', $css)) {
    $errors[] = ".admin-card must not use 'border-radius: 12px;'";
}

// 4. Layout containers max-width: var(--content-max-width)
if (!preg_match('/(?:\.container|\.catalog-container|\.hero-banner)\s*\{[^}]*max-width:\s*var\(--content-max-width\);/s', $css)) {
    $errors[] = "Layout container must specify 'max-width: var(--content-max-width);'";
}

// 5. PWA Manifest & Service Worker Tests
$manifestPath = __DIR__ . '/../frontend/manifest.json';
if (!file_exists($manifestPath)) {
    $errors[] = "frontend/manifest.json does not exist";
} else {
    $manifestData = json_decode(file_get_contents($manifestPath), true);
    if (!is_array($manifestData)) {
        $errors[] = "frontend/manifest.json is not valid JSON";
    } else {
        if (($manifestData['name'] ?? '') !== 'KuraStream - Cloud Anime Streaming') {
            $errors[] = "manifest.json name must be 'KuraStream - Cloud Anime Streaming'";
        }
        if (($manifestData['short_name'] ?? '') !== 'KuraStream') {
            $errors[] = "manifest.json short_name must be 'KuraStream'";
        }
        if (($manifestData['start_url'] ?? '') !== '/#/') {
            $errors[] = "manifest.json start_url must be '/#/'";
        }
        if (($manifestData['display'] ?? '') !== 'standalone') {
            $errors[] = "manifest.json display must be 'standalone'";
        }
        if (($manifestData['background_color'] ?? '') !== '#08090b') {
            $errors[] = "manifest.json background_color must be '#08090b'";
        }
        if (($manifestData['theme_color'] ?? '') !== '#08090b') {
            $errors[] = "manifest.json theme_color must be '#08090b'";
        }
        if (empty($manifestData['icons']) || !is_array($manifestData['icons'])) {
            $errors[] = "manifest.json icons must be a non-empty array";
        } else {
            $has192 = false;
            $has512 = false;
            foreach ($manifestData['icons'] as $icon) {
                if (isset($icon['sizes']) && str_contains($icon['sizes'], '192x192')) $has192 = true;
                if (isset($icon['sizes']) && str_contains($icon['sizes'], '512x512')) $has512 = true;
            }
            if (!$has192 || !$has512) {
                $errors[] = "manifest.json icons must contain 192x192 and 512x512 sizes";
            }
        }
    }
}

$swPath = __DIR__ . '/../frontend/sw.js';
if (!file_exists($swPath)) {
    $errors[] = "frontend/sw.js does not exist";
} else {
    $sw = file_get_contents($swPath);
    if (!str_contains($sw, 'kurastream-v2.0')) {
        $errors[] = "sw.js must define cache name 'kurastream-v2.0'";
    }
    if (!str_contains($sw, '/api/stream') || !str_contains($sw, '/api/party')) {
        $errors[] = "sw.js must ignore streaming and watch party routes";
    }
}

$indexPath = __DIR__ . '/../frontend/index.html';
if (!file_exists($indexPath)) {
    $errors[] = "frontend/index.html does not exist";
} else {
    $indexHtml = file_get_contents($indexPath);
    if (!preg_match('/<link[^>]+rel=["\']manifest["\'][^>]*href=["\'][^"\']*manifest\.json["\']/i', $indexHtml)) {
        $errors[] = "frontend/index.html must link manifest.json";
    }
    if (!preg_match('/<meta[^>]+name=["\']theme-color["\'][^>]+content=["\']#08090b["\']/i', $indexHtml)) {
        $errors[] = "frontend/index.html must have meta theme-color #08090b";
    }
    if (!str_contains($indexHtml, 'serviceWorker') || !str_contains($indexHtml, 'sw.js')) {
        $errors[] = "frontend/index.html must register sw.js service worker";
    }
}

// 5. Task 3: Show Details Smart Resume & 16:9 Episode Cards
$appJsPath = __DIR__ . '/../frontend/app.js';
if (!file_exists($appJsPath)) {
    $errors[] = "frontend/app.js does not exist";
} else {
    $js = file_get_contents($appJsPath);

    // Assert Smart Resume Button logic exists in app.js
    if (!preg_match('/Continuar Ep\./', $js) || !preg_match('/Ver Episodio 1/', $js)) {
        $errors[] = "Missing smart resume button text ('Continuar Ep.' and 'Ver Episodio 1') in app.js";
    }

    // Assert 'VISTO' badge logic exists for completed or >= 85% episodes
    if (!preg_match('/VISTO/', $js)) {
        $errors[] = "Missing 'VISTO' badge logic in app.js";
    }

    // Assert episode progress bar in app.js
    if (!preg_match('/episode-progress-bar|episode-progress-fill/', $js)) {
        $errors[] = "Missing episode progress bar markup in app.js";
    }
}

// Assert 16:9 thumbnail aspect ratio in style.css
if (!preg_match('/\.episode-thumb-wrapper\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/s', $css)) {
    $errors[] = "Missing 'aspect-ratio: 16 / 9;' for .episode-thumb-wrapper in style.css";
}

// Assert hover zoom on episode thumbnail
if (!preg_match('/\.episode-item:hover\s+\.episode-thumb\s*\{[^}]*transform:\s*scale\(/s', $css)) {
    $errors[] = "Missing hover zoom 'transform: scale(...)' on .episode-item:hover .episode-thumb in style.css";
}

// Assert clean 4px season-tab radii in style.css
if (preg_match('/\.season-tab\s*\{[^}]*border-radius:\s*20px;/s', $css)) {
    $errors[] = ".season-tab must not use pill 'border-radius: 20px;'";
}

if (!preg_match('/\.season-tab\s*\{[^}]*border-radius:\s*(?:var\(--radius-sm\)|4px);/s', $css)) {
    $errors[] = ".season-tab must use 'var(--radius-sm)' or '4px' border-radius in style.css";
}

// Assert .badge-visto class exists
if (!preg_match('/\.badge-visto\b/', $css)) {
    $errors[] = "Missing .badge-visto class in style.css";
}

// Assert episode progress bar with --progress-color
if (!preg_match('/\.episode-progress-bar\s*\{[^}]*background/s', $css) || !preg_match('/\.episode-progress-fill\s*\{[^}]*background:\s*(?:var\(--progress-color\)|#e50914)/s', $css)) {
    $errors[] = "Missing episode progress bar / fill styling with --progress-color in style.css";
}

if (!empty($errors)) {
    echo "FAIL:\n - " . implode("\n - ", $errors) . "\n";
    exit(1);
}

echo "✓ UI Assets CSS Scale, Radii & Show Details Tests Passed\n";
exit(0);
