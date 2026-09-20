# KuraStream 2.0 Cinematic Pack & Pro Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevate KuraStream 2.0 with a complete cinematic upgrade: modern local Lucide iconography, canvas-based seek scrub preview on the player timeline, Netflix-style 2-column Audio/Subtitles floating modal, Picture-in-Picture (PiP) Pro, playback speed quick pill, and Netflix-grade expandable card hover popovers in the catalog.

**Architecture:** Vanilla ES6 modules in `frontend/js/modules/` decoupled from existing core scripts. The player core (`player.js`) consumes the seek preview engine and tracks modal. The catalog router (`app.js`) consumes the singleton card hover popover manager. Local Lucide SVG bundle guarantees 100% offline functionality.

**Tech Stack:** JavaScript (ES6+ Modules, HTML5 Canvas 2D, HTML5 Video & PiP API, SubtitlesOctopus), CSS3 (Custom properties, CSS Grid, Glassmorphism backdrop filters), PHP 8.4, MariaDB / MySQL.

**Spec:** `docs/superpowers/specs/2026-09-19-cinematic-pack-and-pro-player-design.md`

## Global Constraints

- Backend remains strictly PHP 8.4 + MySQL.
- Strict corner radii of 4px (`--radius-sm: 4px`) across all new modals, cards, buttons, and popovers. No bubbly 12px/20px curves.
- Deep jet-black cinematic aesthetic (`#08090b` / `#0b0f14`) with high-contrast actions.
- Zero external CDN network dependencies: all icons and scripts must be stored and executed locally.
- 100% clean test suite passing (`npm test`) and 0 ESLint errors (`npm run lint`).
- Keep local git commits clean and descriptive for each task.

---

### Task 1: Automated Verification Test Suite for Cinematic Pack

**Files:**
- Create: `tests/test_cinematic_pack.php`
- Modify: `tests/run_all_tests.php`

**Interfaces:**
- Consumes: Static asset structure and frontend module files.
- Produces: Test harness asserting presence and exports of `player_scrub_preview.js`, `player_tracks_modal.js`, `card_popover_preview.js`, CSS rules for `.scrub-preview-tooltip`, `.tracks-modal-container`, `.popover-card-preview`, `#player-pip-btn`, `#player-speed-btn`.

- [ ] **Step 1: Write `tests/test_cinematic_pack.php`**

```php
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

// 3. Verify CSS Classes and Crisp 4px Radii in style.css
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
}

// 4. Verify Player Integration
$playerJsPath = __DIR__ . '/../frontend/player.js';
if (file_exists($playerJsPath)) {
    $playerJs = file_get_contents($playerJsPath);
    if (!str_contains($playerJs, 'player_scrub_preview') && !str_contains($playerJs, 'initScrubPreview')) {
        $errors[] = "player.js must integrate scrub preview engine";
    }
    if (!str_contains($playerJs, 'player_tracks_modal') && !str_contains($playerJs, 'openTracksModal')) {
        $errors[] = "player.js must integrate tracks modal";
    }
    if (!str_contains($playerJs, 'requestPictureInPicture')) {
        $errors[] = "player.js must implement Picture-in-Picture API";
    }
}

// 5. Verify App Integration for Hover Popovers
$appJsPath = __DIR__ . '/../frontend/app.js';
if (file_exists($appJsPath)) {
    $appJs = file_get_contents($appJsPath);
    if (!str_contains($appJs, 'card_popover_preview') && !str_contains($appJs, 'initCardPopovers')) {
        $errors[] = "app.js must integrate card popover preview engine";
    }
}

if (!empty($errors)) {
    echo "FAIL:\n - " . implode("\n - ", $errors) . "\n";
    exit(1);
}

echo "✓ Cinematic Pack & Pro Player Tests Passed\n";
exit(0);
```

- [ ] **Step 2: Run test to confirm it fails**
- [ ] **Step 3: Add `test_cinematic_pack.php` to `tests/run_all_tests.php`**
- [ ] **Step 4: Commit test file**
  - `git commit -m "test: add automated verification suite for Cinematic Pack and Pro Player"`

---

### Task 2: Modern Local Iconography Suite (Offline Lucide Pro Bundle & SVG Assets)

**Files:**
- Create / Update: `frontend/vendor/lucide/lucide.min.js`
- Create: `frontend/assets/icons/README.md`
- Modify: `frontend/index.html`
- Modify: `frontend/style.css`

**Interfaces:**
- Produces: Complete, self-hosted offline vector icon library supporting `subtitles`, `picture-in-picture-2`, `gauge`, `sparkles`, `skip-back`, `skip-forward`, `play`, `check`, `plus`, `info`.

- [ ] **Step 1: Ensure `frontend/vendor/lucide/lucide.min.js` has complete updated icon definitions**
- [ ] **Step 2: Update CSS vector stroke consistency in `frontend/style.css` (`stroke-width: 1.75px;`)**
- [ ] **Step 3: Update `frontend/index.html` to reference updated player control icons**
- [ ] **Step 4: Run `npm test` and `npm run lint`**
- [ ] **Step 5: Commit changes**
  - `git commit -m "feat(icons): bundle complete offline modern Lucide icon suite with 1.75px strokes"`

---

### Task 3: Timeline Seek Scrub Preview Engine

**Files:**
- Create: `frontend/js/modules/player_scrub_preview.js`
- Modify: `frontend/player.js`
- Modify: `frontend/style.css`

**Interfaces:**
- Produces: `export function initScrubPreview(progressBarEl, mainVideoEl): { destroy(): void }`
- Internal: Hidden background clone video element seeking on hover and rendering into a 16:9 canvas tooltip with time badge.

- [ ] **Step 1: Implement `frontend/js/modules/player_scrub_preview.js`**
  - Clone active video source to an in-memory `<video muted preload="auto">` element.
  - Throttle mousemove events to 50ms.
  - Compute target timestamp: `t = (event.offsetX / rect.width) * duration`.
  - Draw frame to $160 \times 90$ canvas on `seeked`.
  - Position `.scrub-preview-tooltip` centered over cursor and clamped within player boundaries.
  - Fade out on `mouseleave`.
- [ ] **Step 2: Add `.scrub-preview-tooltip` styling in `frontend/style.css` with 4px border radius, subtle border, and time badge**
- [ ] **Step 3: Integrate `initScrubPreview` into `frontend/player.js` `initPlayer()` and teardown in `destroyPlayer()`**
- [ ] **Step 4: Run `node scripts/run-php.mjs tests/test_cinematic_pack.php` to verify progress**
- [ ] **Step 5: Commit changes**
  - `git commit -m "feat(player): implement instant canvas timeline seek scrub preview engine"`

---

### Task 4: Netflix-Style 2-Column Audio & Subtitles Modal

**Files:**
- Create: `frontend/js/modules/player_tracks_modal.js`
- Modify: `frontend/player.js`
- Modify: `frontend/style.css`
- Modify: `frontend/index.html`

**Interfaces:**
- Produces: `export function initTracksModal(options): { open(): void, close(): void, updateTracks(tracks): void }`
- Left column: Audio tracks with active `✓` checkmark.
- Right column: Subtitles (Off, and available tracks) with active `✓` checkmark.

- [ ] **Step 1: Implement `frontend/js/modules/player_tracks_modal.js`**
  - Render frosted glass dialog with 2 columns: Audio (left) and Subtitles (right).
  - Handle track selection callbacks for audio streams and subtitle streams.
  - Close on click outside, close button, or `Escape` key.
- [ ] **Step 2: Add modal styling in `frontend/style.css` with jet-black surface (`#0b0f14`), 4px border radius, and active checkmarks**
- [ ] **Step 3: Integrate Audio & Subtitles button in player control bar and wire `initTracksModal` in `frontend/player.js`**
- [ ] **Step 4: Connect with native audio tracks and `SubtitlesOctopus` (libass WebAssembly) for ASS/SSA subtitle styling**
- [ ] **Step 5: Run `npm test` and `npm run lint`**
- [ ] **Step 6: Commit changes**
  - `git commit -m "feat(player): implement Netflix-style 2-column floating audio and subtitles modal"`

---

### Task 5: Picture-in-Picture (PiP) Pro & Playback Speed Quick Pill

**Files:**
- Modify: `frontend/player.js`
- Modify: `frontend/style.css`
- Modify: `frontend/index.html`

**Interfaces:**
- Consumes: HTML5 Video Picture-in-Picture API (`video.requestPictureInPicture()`).
- Produces: Dedicated `#player-pip-btn` button with sync state, and `#player-speed-btn` speed pill with popover selector.

- [ ] **Step 1: Add PiP button `#player-pip-btn` and Speed button `#player-speed-btn` in `frontend/index.html`**
- [ ] **Step 2: Implement PiP handlers and state synchronization in `frontend/player.js`**
  - Check `document.pictureInPictureEnabled`.
  - Toggle PiP on button click.
  - Sync active class on `enterpictureinpicture` and `leavepictureinpicture`.
- [ ] **Step 3: Implement playback speed quick pill popover in `frontend/player.js` (0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x)**
- [ ] **Step 4: Style PiP button, speed pill, and popover in `frontend/style.css` with 4px radii**
- [ ] **Step 5: Run `npm test` and `npm run lint`**
- [ ] **Step 6: Commit changes**
  - `git commit -m "feat(player): add native Picture-in-Picture Pro and playback speed quick pill"`

---

### Task 6: Netflix Expandable Card Hover Popover

**Files:**
- Create: `frontend/js/modules/card_popover_preview.js`
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`

**Interfaces:**
- Produces: `export function initCardPopovers(containerSelector): void`
- Singleton floating card element expanding on $\ge 350\text{ms}$ hover over `.show-card`.
- Displays 16:9 banner, quick play button (`▶ Reproducir`), add to favorites toggle (`+ Mi lista`), and details link (`ℹ Detalles`).

- [ ] **Step 1: Implement `frontend/js/modules/card_popover_preview.js`**
  - Create singleton floating popover container `.popover-card-preview`.
  - Listen to `mouseenter` on cards with 350ms debounce timer.
  - Position over target card with viewport boundary checks (prevent left/right clipping).
  - Inject 16:9 banner, metadata badges (Rating, Year, Episodes, Status), and action CTAs.
  - Handle `mouseleave` with 200ms grace period.
- [ ] **Step 2: Style `.popover-card-preview` in `frontend/style.css` with 4px border radius, deep elevation shadow, and smooth scale transition**
- [ ] **Step 3: Integrate `initCardPopovers` in `frontend/app.js` across catalogue and dashboard rows**
- [ ] **Step 4: Run `node scripts/run-php.mjs tests/test_cinematic_pack.php` to verify pass**
- [ ] **Step 5: Commit changes**
  - `git commit -m "feat(catalog): implement Netflix-grade expandable card hover popovers"`

---

### Task 7: Full Test Suite Execution, Linting & Branch Verification

**Files:**
- Modify: `tests/run_all_tests.php` (verify 17 test scripts execute)

**Interfaces:**
- Consumes: All automated backend and frontend test scripts.
- Produces: 100% green test run across all 17 test suites, 0 ESLint errors, clean git status.

- [ ] **Step 1: Run `node scripts/run-php.mjs tests/run_all_tests.php` and verify 17/17 tests pass**
- [ ] **Step 2: Run `npm run lint` and verify 0 errors**
- [ ] **Step 3: Verify live playback and catalog interaction on local development server**
- [ ] **Step 4: Commit and finalize release**
  - `git commit -m "test: verify complete test suite passes for Cinematic Pack release"`
