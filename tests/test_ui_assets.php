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

// 8. Task 5: Profile Statistics Dashboard & Avatar Picker Tests
// In app.js:
if (!preg_match('/Horas vistas/i', $js)) {
    $errors[] = "Missing 'Horas vistas' metric card label in app.js";
}

if (!preg_match('/Series completadas/i', $js)) {
    $errors[] = "Missing 'Series completadas' metric card label in app.js";
}

if (!preg_match('/Cap.*tulos vistos/iu', $js)) {
    $errors[] = "Missing 'Capítulos vistos' metric card label in app.js";
}

if (!preg_match('/G.*nero favorito/iu', $js)) {
    $errors[] = "Missing 'Género favorito' metric card label in app.js";
}

if (!preg_match('/\/api\/user\/stats/', $js)) {
    $errors[] = "Missing fetch to '/api/user/stats' in app.js";
}

// In style.css:
if (preg_match('/\.stat-card\s*\{[^}]*border-radius:\s*16px;/s', $css)) {
    $errors[] = ".stat-card must not use 'border-radius: 16px;'";
}

if (!preg_match('/\.stat-card\s*\{[^}]*border-radius:\s*(?:var\(--radius-sm\)|4px);/s', $css)) {
    $errors[] = ".stat-card must use 'var(--radius-sm)' or '4px' border-radius in style.css";
}

if (!preg_match('/\.preset-avatar-option\s*\{[^}]*border-radius:\s*(?:var\(--radius-sm\)|4px)/s', $css)) {
    $errors[] = ".preset-avatar-option must use 'var(--radius-sm)' or '4px' border-radius in style.css";
}

if (!preg_match('/\.preset-avatar-option\.(?:selected|active)::after\s*\{[^}]*content:\s*[\'"][^;]*✓/su', $css) &&
    !preg_match('/\.preset-avatar-option\.(?:selected|active)::after\s*\{[^}]*content:\s*[\'"]\\\\271[34]/s', $css)) {
    $errors[] = "Missing checkmark styling on selected avatar option (.preset-avatar-option.selected::after or .active::after) in style.css";
}

if (preg_match('/\.profile-avatar\s*\{[^}]*border-radius:\s*20px;/s', $css)) {
    $errors[] = ".profile-avatar must not use bubbly 'border-radius: 20px;'";
}

if (!preg_match('/\.profile-avatar\s*\{[^}]*border-radius:\s*(?:var\(--radius-sm\)|4px);/s', $css)) {
    $errors[] = ".profile-avatar must use 'var(--radius-sm)' or '4px' border-radius in style.css";
}

// 9. Task 3: Show Details Smart Resume & 16:9 Episode Cards
// In app.js:
if (!preg_match('/Continuar Ep\./', $js) || !preg_match('/Ver Episodio 1/', $js)) {
    $errors[] = "Missing smart resume button text ('Continuar Ep.' and 'Ver Episodio 1') in app.js";
}

if (!preg_match('/VISTO/', $js)) {
    $errors[] = "Missing 'VISTO' badge logic in app.js";
}

if (!preg_match('/episode-progress-bar|episode-progress-fill/', $js)) {
    $errors[] = "Missing episode progress bar markup in app.js";
}

// In style.css:
if (!preg_match('/\.episode-thumb-wrapper\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/s', $css)) {
    $errors[] = "Missing 'aspect-ratio: 16 / 9;' for .episode-thumb-wrapper in style.css";
}

if (!preg_match('/\.episode-item:hover\s+\.episode-thumb\s*\{[^}]*transform:\s*scale\(/s', $css)) {
    $errors[] = "Missing hover zoom 'transform: scale(...)' on .episode-item:hover .episode-thumb in style.css";
}

if (preg_match('/\.season-tab\s*\{[^}]*border-radius:\s*20px;/s', $css)) {
    $errors[] = ".season-tab must not use pill 'border-radius: 20px;'";
}

if (!preg_match('/\.season-tab\s*\{[^}]*border-radius:\s*(?:var\(--radius-sm\)|4px);/s', $css)) {
    $errors[] = ".season-tab must use 'var(--radius-sm)' or '4px' border-radius in style.css";
}

if (!preg_match('/\.badge-visto\b/', $css)) {
    $errors[] = "Missing .badge-visto class in style.css";
}

if (!preg_match('/\.episode-progress-bar\s*\{[^}]*background/s', $css) || !preg_match('/\.episode-progress-fill\s*\{[^}]*background:\s*(?:var\(--progress-color[^)]*\)|#e50914)/s', $css)) {
    $errors[] = "Missing episode progress bar / fill styling with --progress-color in style.css";
}

// 10. Task 4: Cinematic Video Player Pro Tests (Ambient Glow, Media Session & Next Episode Card)
$playerJsPath = __DIR__ . '/../frontend/player.js';
if (!file_exists($playerJsPath)) {
    $errors[] = "frontend/player.js does not exist";
} else {
    $playerJs = file_get_contents($playerJsPath);

    // 1. Ambient Glow Engine
    if (!str_contains($playerJs, 'ambient-canvas') && !str_contains($playerJs, 'player-ambilight-canvas')) {
        $errors[] = "player.js must reference ambient glow canvas ('ambient-canvas' or 'player-ambilight-canvas')";
    }
    if (!preg_match('/width\s*=\s*64/i', $playerJs) || !preg_match('/height\s*=\s*36/i', $playerJs)) {
        $errors[] = "player.js ambient glow canvas must use 64x36 dimensions";
    }
    if (!preg_match('/250/', $playerJs)) {
        $errors[] = "player.js ambient glow must sample at 4 FPS (250ms interval)";
    }
    if (!preg_match('/Luz ambiental/i', $playerJs)) {
        $errors[] = "Player controls must have 'Luz ambiental' toggle button";
    }

    // 2. Media Session API
    if (!str_contains($playerJs, 'mediaSession')) {
        $errors[] = "player.js must integrate navigator.mediaSession";
    }
    if (!str_contains($playerJs, 'MediaMetadata')) {
        $errors[] = "player.js must create MediaMetadata with title, artist, artwork";
    }
    if (!str_contains($playerJs, "'seekbackward'") || !str_contains($playerJs, "'seekforward'")) {
        $errors[] = "player.js must register seekbackward and seekforward handlers in mediaSession";
    }
    if (!str_contains($playerJs, "'nexttrack'")) {
        $errors[] = "player.js must register nexttrack handler in mediaSession";
    }

    // 3. Countdown Next Episode Card
    if (!str_contains($playerJs, 'next-episode-card') && !str_contains($playerJs, 'nextEpCard')) {
        $errors[] = "player.js must implement 'next-episode-card' overlay card";
    }
    if (!preg_match('/(?:duration\s*-\s*[^<]*currentTime|remainingTime)\s*<=\s*25/i', $playerJs)) {
        $errors[] = "player.js must trigger next episode countdown when remaining time <= 25 seconds";
    }
    if (!str_contains($playerJs, 'Próximo episodio en') && !str_contains($playerJs, 'Pr\u00f3ximo episodio en')) {
        $errors[] = "player.js countdown card must display 'Próximo episodio en {seconds}s...'";
    }
    if (!str_contains($playerJs, 'Ver ahora')) {
        $errors[] = "player.js countdown card must include 'Ver ahora' button";
    }

    // 4. Keyboard Hotkeys & Mobile Touch Gestures
    if (!str_contains($playerJs, 'KeyN') && !str_contains($playerJs, "'KeyN'")) {
        $errors[] = "player.js must support hotkey 'n' (KeyN) for next episode";
    }
    if (!str_contains($playerJs, 'touchstart') && !str_contains($playerJs, 'touchend')) {
        $errors[] = "player.js must support mobile double-tap touch gestures";
    }
    if (!str_contains($playerJs, '0.35') && !str_contains($playerJs, '35')) {
        $errors[] = "player.js double-tap must check 35% left / right boundaries";
    }
}

// Ambient Glow & Next Episode Card in style.css
if (!preg_match('/filter:[^;]*blur\(60px\)/', $css) || !preg_match('/saturate\(140%\)/', $css)) {
    $errors[] = "style.css must style ambient glow with 'filter: blur(60px) brightness(0.85) saturate(140%)'";
}
if (!preg_match('/\.next-episode-card\b/', $css)) {
    $errors[] = "style.css must style .next-episode-card in bottom-right corner";
}

if (!empty($errors)) {
    echo "FAIL:\n - " . implode("\n - ", $errors) . "\n";
    exit(1);
}

echo "✓ UI Assets CSS Scale, Billboard Hero, Continue Watching, Profile Stats & Show Details Tests Passed\n";
exit(0);

