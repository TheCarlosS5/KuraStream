# KuraStream 2.0 Netflix-Scale & Cinematic Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform KuraStream into a Netflix-scale, cinematic anime streaming web app featuring an expansive layout, crisp 4px radii, full-width Billboard Hero, "Seguir viendo" row with progress bars, Ambient Glow player with Media Session API, Next Episode countdown overlay, and PWA installability.

**Architecture:** Frontend vanilla ES modules (`app.js`, `player.js`, `style.css`) consuming the existing hardened PHP 8.4 + MySQL API. Styling is unified through modernized CSS custom properties. Offline and native app experience enabled via PWA manifest and service worker.

**Tech Stack:** JavaScript (ES6+), CSS3 (Modern custom properties, CSS Grid, Flexbox, Canvas 2D API, Media Session API), PHP 8.4, MySQL 8.4 / MariaDB, Service Worker.

**Spec:** `docs/superpowers/specs/2026-09-19-netflix-scale-and-cinematic-experience-design.md`

## Global Constraints
- Backend remains strictly PHP 8.4 + MySQL. No node backend resurrection.
- Corner radii must be crisp and subtle: 2px to 4px (`--radius-sm: 4px`), completely avoiding bubbly 12px/20px/pill shapes.
- No Light Theme: preserve deep cinematic jet-black dark aesthetic (`#08090b`).
- Keep local git commits clean and descriptive for each completed task.
- Dual authentication compatibility: supports both JWT HttpOnly cookie and Bearer header.
- Cross-platform Windows and Linux support.

---

### Task 1: Design Tokens & CSS Scale (Netflix Crisp 4px Radii & Jet Black Theme)

**Files:**
- Modify: `frontend/style.css`
- Create: `tests/test_ui_assets.php`

**Interfaces:**
- Consumes: Existing color palette and CSS variables.
- Produces: Updated CSS custom properties (`--radius-sm: 4px`, `--content-max-width: 1600px`, `--progress-color: #e50914`, `--bg-color: #08090b`), modernized card sizing, and crisp border styling.

- [ ] **Step 1: Create UI assets and tokens automated verification test**
  - Write `tests/test_ui_assets.php` checking that `frontend/style.css` contains `--radius-sm: 4px`, `--progress-color`, and excludes bubbly border radii on cards.
- [ ] **Step 2: Run test to confirm it fails**
  - `php tests/test_ui_assets.php`
- [ ] **Step 3: Update `frontend/style.css` with Netflix design tokens and crisp border-radii**
  - Set `--radius-sm: 4px`, `--radius-md: 6px`, `--radius-lg: 8px`.
  - Update `.show-card`, `.episode-item`, `.modal-content`, `.detail-poster`, `.admin-card`, buttons, and inputs to use crisp 4px radii.
  - Expand layout containers to `max-width: 1600px` with 4% padding.
- [ ] **Step 4: Run test to confirm it passes**
  - `php tests/test_ui_assets.php`
- [ ] **Step 5: Commit changes**
  - `git commit -m "style: apply Netflix-scale tokens and crisp 4px border radii"`

---

### Task 2: Billboard Hero Banner & "Seguir viendo" (Continue Watching) Row

**Files:**
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`
- Modify: `tests/test_ui_assets.php`

**Interfaces:**
- Consumes: `/api/shows`, `/api/history`.
- Produces: Full-width Billboard Hero markup and rendering function, dynamic "Seguir viendo" horizontal row with 16:9 thumbnails and progress bars.

- [ ] **Step 1: Write test assertion for Billboard Hero and Continue Watching row**
  - In `tests/test_ui_assets.php`, assert hero billboard container and continue-watching row template exist in the codebase.
- [ ] **Step 2: Run test to verify failure**
  - `php tests/test_ui_assets.php`
- [ ] **Step 3: Implement Billboard Hero and Continue Watching in `frontend/app.js` and `frontend/style.css`**
  - Create `renderBillboardHero(featuredShow)`: full-bleed background, title, HD badge, rating, sinopsis, "▶ Reproducir" (white button) and "ℹ Más información".
  - Create `renderContinueWatching(historyItems)`: horizontal cards with progress bar, remaining time, and instant play link.
  - Insert Continue Watching immediately below the Hero banner when user has active in-progress episodes.
- [ ] **Step 4: Run test to verify pass**
  - `php tests/test_ui_assets.php`
- [ ] **Step 5: Commit changes**
  - `git commit -m "feat(home): implement Netflix-style Billboard Hero and Continue Watching row"`

---

### Task 3: Inmersive Show Detail Page & Smart Resume Action

**Files:**
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`

**Interfaces:**
- Consumes: `/api/shows/{id}`, `/api/progress?episode_id={id}`.
- Produces: Redesigned anime details page with panoramic header, smart *"Continuar Ep. X (min MM:SS)"* button, 4px season tabs, and 16:9 episode cards.

- [ ] **Step 1: Extend test in `tests/test_ui_assets.php` for show details smart button and episode card layout**
- [ ] **Step 2: Run test to verify failure**
  - `php tests/test_ui_assets.php`
- [ ] **Step 3: Implement immersive show details in `frontend/app.js` and `frontend/style.css`**
  - Render panoramic backdrop banner with vignette.
  - Compute user's latest watched episode: if progress exists, primary CTA says *"▶ Continuar Ep. X (min MM:SS)"*; if none, *"▶ Ver Episodio 1"*.
  - Render season tabs with 4px radii.
  - Render episode cards in 16:9 widescreen format with duration, preview description, completion badge ("VISTO"), and progress bar.
- [ ] **Step 4: Run test to verify pass**
  - `php tests/test_ui_assets.php`
- [ ] **Step 5: Commit changes**
  - `git commit -m "feat(catalog): redesign show details page with smart resume and 16:9 episode cards"`

---

### Task 4: Cinematic Video Player Pro (Ambient Glow, Media Session & Next Episode Card)

**Files:**
- Modify: `frontend/player.js`
- Modify: `frontend/style.css`

**Interfaces:**
- Consumes: HTML5 Video element, HTML5 Canvas 2D, `navigator.mediaSession`.
- Produces: Ambient Glow sampler, Media Session API metadata & actions, countdown Next Episode overlay card, keyboard shortcuts and mobile double-tap.

- [ ] **Step 1: Add automated assertions in `tests/test_ui_assets.php` for player ambient glow and media session**
- [ ] **Step 2: Run test to verify failure**
  - `php tests/test_ui_assets.php`
- [ ] **Step 3: Implement player improvements in `frontend/player.js` and `frontend/style.css`**
  - Implement canvas Ambient Glow engine sampling video frames and casting soft blurred light behind the player.
  - Integrate `navigator.mediaSession` with title, episode number, and HD artwork.
  - Implement Next Episode countdown overlay card triggered when remaining time <= 25 seconds.
  - Implement full keyboard shortcuts (Space, F, M, Arrow Keys, N) and mobile double-tap seek (+/-10s).
- [ ] **Step 4: Run test to verify pass**
  - `php tests/test_ui_assets.php`
- [ ] **Step 5: Commit changes**
  - `git commit -m "feat(player): add ambient glow, media session API, next episode countdown, and hotkeys"`

---

### Task 5: User Profile Stats & Identity Clean View

**Files:**
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`

**Interfaces:**
- Consumes: `/api/user/stats`, `/api/user/preferences`.
- Produces: Clean profile statistics view displaying total hours watched, completed series, top genre, and avatar picker.

- [ ] **Step 1: Add profile stats assertions in `tests/test_ui_assets.php`**
- [ ] **Step 2: Run test to verify failure**
  - `php tests/test_ui_assets.php`
- [ ] **Step 3: Implement profile statistics dashboard in `frontend/app.js` and `frontend/style.css`**
  - Render summary cards: "Horas de anime", "Series completadas", "Episodios vistos", "Género favorito".
  - Clean avatar selector with crisp 4px square frames.
- [ ] **Step 4: Run test to verify pass**
  - `php tests/test_ui_assets.php`
- [ ] **Step 5: Commit changes**
  - `git commit -m "feat(profile): enhance user profile with clean viewing statistics and avatar picker"`

---

### Task 6: PWA Implementation (Manifest & Service Worker)

**Files:**
- Create: `frontend/manifest.json`
- Create: `frontend/sw.js`
- Modify: `frontend/index.html`

**Interfaces:**
- Consumes: Static assets (CSS, JS, fonts, icons).
- Produces: Installable Progressive Web App with standalone window capability and instant asset caching.

- [ ] **Step 1: Add PWA manifest and service worker assertions in `tests/test_ui_assets.php`**
- [ ] **Step 2: Run test to verify failure**
  - `php tests/test_ui_assets.php`
- [ ] **Step 3: Create `frontend/manifest.json` and `frontend/sw.js`, and link in `frontend/index.html`**
  - Configure manifest with name "KuraStream", theme color "#08090b", display "standalone", and branding icons.
  - Implement service worker caching shell assets with cache-first strategy, strictly ignoring `/api/stream/*`.
  - Register service worker in `frontend/index.html`.
- [ ] **Step 4: Run test to verify pass**
  - `php tests/test_ui_assets.php`
- [ ] **Step 5: Commit changes**
  - `git commit -m "feat(pwa): add web app manifest and service worker for installable app experience"`

---

### Task 7: Full Test Suite Execution & Branch Verification

**Files:**
- Modify: `tests/run_all_tests.php` (if needed to include `test_ui_assets.php`)

**Interfaces:**
- Consumes: All 15 automated test scripts.
- Produces: 100% green test run across PHP, MySQL, security, and UI asset verification.

- [ ] **Step 1: Verify `tests/run_all_tests.php` discovers and runs all tests including `test_ui_assets.php`**
- [ ] **Step 2: Run `npm test` and verify 100% pass rate**
- [ ] **Step 3: Commit and prepare merge into main**
  - `git commit -m "test: verify complete test suite passes for Netflix-scale release"`
