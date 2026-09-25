# KuraStream v2.0 Modern Streaming Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform KuraStream into a secure, cohesive, commercial-quality streaming platform with zero hardcoded credentials, zero torrent/aria2 code, clean modular frontend architecture, robust PHP 8.4 media streaming engine, and strict Anti-Slop / Taste visual craft.

**Architecture:** Monolithic modular architecture utilizing Vanilla JS + ES Modules centered on `frontend/js/main.js` with domain-driven modules, modern CSS token system (4px radii, deep dark cinematic surfaces), PHP 8.4 REST API with versioned migrations, atomic rate limiting, and hardened video range/head streaming.

**Tech Stack:** PHP 8.4, Vanilla JS (ES Modules), CSS3 (Modern Tokens), MySQL/MariaDB, FFmpeg/FFprobe, SubtitlesOctopus (WASM), Lucide Icons, Docker.

**Spec:** `docs/superpowers/specs/2026-09-25-modern-streaming-platform-design.md`

## Global Constraints

- Never hardcode credentials, passwords, or API keys; TMDB key exclusively from `TMDB_API_KEY` / `.env`.
- No active torrent, aria2, Nyaa, magnet, or downloader dependencies in the repository.
- Single canonical frontend entrypoint (`frontend/js/main.js`); no duplicated frontends.
- Strict 4px standard radius (`--radius-sm: 4px; --radius-md: 4px;`); no bubbly radii or purple gradients.
- Zero Unicode emojis used as UI icons (exclusive use of Lucide SVGs).
- Full player lifecycle: `mount()`, `loadEpisode()`, `destroy()` (no listener or timer leaks).
- HEAD streaming requests must never read whole files or launch FFmpeg.
- Server-side kids maturity filtering and profile IDOR protection.

---

### Task 1: Credential Security Hardening & Secret Purge (Phase 0)

**Files:**
- Modify: `deploy_remote.py`
- Modify: `php_backend/services/TmdbScraper.php`
- Modify: `legacy_backend/scripts/setup_ssh_key.py`
- Create: `.github/workflows/security.yml`
- Test: `tests/test_secret_scanning.php`

**Interfaces:**
- `TmdbScraper::getApiKey()`: returns `getenv('TMDB_API_KEY') ?: ''`
- Secret scanner test verifies no passwords, tokens, or private keys match regex in tracked code.

- [ ] **Step 1: Write test for hardcoded secret detection**
  Create `tests/test_secret_scanning.php` scanning all php/js/py files for high-entropy hardcoded secrets, password literals, and TMDB fallback keys.

- [ ] **Step 2: Run test to verify it catches existing secrets**
  Run: `php tests/test_secret_scanning.php`
  Expected: FAIL (detects hardcoded keys in `TmdbScraper.php` and `deploy_remote.py`).

- [ ] **Step 3: Fix `TmdbScraper.php`, `deploy_remote.py`, and `setup_ssh_key.py`**
  Remove hardcoded credentials; require environment variables and key-based authentication.

- [ ] **Step 4: Add GitHub Actions secret scanning workflow**
  Create `.github/workflows/security.yml` with Gitleaks action.

- [ ] **Step 5: Run test to verify it passes**
  Run: `php tests/test_secret_scanning.php`
  Expected: PASS ✓

- [ ] **Step 6: Commit**
  Run: `git add deploy_remote.py php_backend/services/TmdbScraper.php legacy_backend/scripts/setup_ssh_key.py .github/workflows/security.yml tests/test_secret_scanning.php`  
  Run: `git commit -m "fix(security): purge hardcoded secrets and add secret scanner test and CI"`

---

### Task 2: Complete Elimination of Torrents / Aria2 / Nyaa (Phase 1)

**Files:**
- Delete: `bin/aria2c`
- Delete: `php_backend/services/TorrentDownloader.php`
- Delete: `php_backend/tests/test_torrent_downloader.php`
- Delete: `tests/test_aria2_platform.php`
- Delete: `frontend/js/modules/admin_torrents.js`
- Delete: `legacy_backend/scripts/anime_autodownloader.js`
- Modify: `php_backend/controllers/AdminController.php`
- Modify: `php_backend/router.php`
- Modify: `frontend/js/modules/navigation.js`
- Modify: `tests/run_all_tests.php`
- Create: `tests/test_no_torrent_artifacts.php`

**Interfaces:**
- Ensure `/api/admin/torrent/*` routes are removed from `router.php`.
- Staging / "Por organizar" decoupled from torrents.

- [ ] **Step 1: Write test to verify absence of torrent artifacts**
  Create `tests/test_no_torrent_artifacts.php` verifying 0 active code references to `aria2`, `nyaa`, `TorrentDownloader`, and `anime_autodownloader`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `php tests/test_no_torrent_artifacts.php`
  Expected: FAIL (references found).

- [ ] **Step 3: Delete files and remove backend/frontend torrent handlers**
  Remove `bin/aria2c`, `TorrentDownloader.php`, `admin_torrents.js`, `test_aria2_platform.php`, and clean `router.php`, `AdminController.php`, and `navigation.js`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `php tests/test_no_torrent_artifacts.php`
  Expected: PASS ✓

- [ ] **Step 5: Commit**
  Run: `git add -A`  
  Run: `git commit -m "refactor(core): completely purge aria2, nyaa, and torrent subsystems"`

---

### Task 3: Design Tokens & CSS System Rebuild (Phase 3 & 4)

**Files:**
- Create: `frontend/css/tokens.css`
- Create: `frontend/css/base.css`
- Create: `frontend/css/layout.css`
- Create: `frontend/css/components.css`
- Create: `frontend/css/catalog.css`
- Create: `frontend/css/player.css`
- Create: `frontend/css/admin.css`
- Modify: `frontend/style.css` (replace with import bundle of clean modular CSS)
- Test: `tests/test_ui_assets.php`

**Interfaces:**
- Define CSS custom properties: `--bg-color: #090D0E; --surface-color: #131A1C; --accent-color: #F97316; --success-color: #2DD4BF; --rating-color: #FBBF24; --radius-sm: 4px;`
- All button, card, and modal components enforce `--radius-sm` and high contrast.

- [ ] **Step 1: Create modular CSS files**
  Build `frontend/css/tokens.css`, `base.css`, `layout.css`, `components.css`, `catalog.css`, `player.css`, `admin.css`.

- [ ] **Step 2: Bundle in `frontend/style.css`**
  Reference the modular stylesheet without `!important` pollution.

- [ ] **Step 3: Run UI assets test**
  Run: `php tests/test_ui_assets.php`
  Expected: PASS ✓

- [ ] **Step 4: Commit**
  Run: `git add frontend/css/ frontend/style.css tests/test_ui_assets.php`  
  Run: `git commit -m "feat(css): build modular anti-slop CSS system with 4px radii and tokens"`

---

### Task 4: Complete Emoji Purge and Lucide Integration (Phase 5)

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/js/modules/player_shortcuts_hud.js`
- Modify: `frontend/js/modules/card_popover_preview.js`
- Create: `tests/test_emoji_purge.php`

**Interfaces:**
- All product UI buttons and labels use Lucide icons with `aria-label` or SVG icons.
- Zero hardcoded Unicode emojis in frontend templates.

- [ ] **Step 1: Write test for UI emoji purge**
  Create `tests/test_emoji_purge.php` scanning `frontend/index.html` and UI templates for Unicode emoji ranges.

- [ ] **Step 2: Run test to verify it fails**
  Run: `php tests/test_emoji_purge.php`
  Expected: FAIL (emojis detected).

- [ ] **Step 3: Replace emojis in `frontend/index.html` with Lucide icons**
  Replace all `⭐`, `🔥`, `📺`, `🎉`, `🍿`, `🔒`, `⚙️` in header, sidebar, profile, and buttons with Lucide SVGs and semantic text.

- [ ] **Step 4: Run test to verify it passes**
  Run: `php tests/test_emoji_purge.php`
  Expected: PASS ✓

- [ ] **Step 5: Commit**
  Run: `git add frontend/index.html frontend/js/modules/player_shortcuts_hud.js frontend/js/modules/card_popover_preview.js tests/test_emoji_purge.php`  
  Run: `git commit -m "feat(ui): purge hardcoded emojis from UI chrome and standardize on Lucide icons"`

---

### Task 5: Canonical Frontend Architecture Migration (Phase 2 & 4)

**Files:**
- Create: `frontend/js/core/api.js`
- Create: `frontend/js/core/auth.js`
- Create: `frontend/js/core/router.js`
- Create: `frontend/js/core/state.js`
- Create: `frontend/js/core/ui.js`
- Create: `frontend/js/features/catalog/catalog.js`
- Create: `frontend/js/features/show-detail/detail.js`
- Create: `frontend/js/features/profiles/profiles.js`
- Create: `frontend/js/features/favorites/favorites.js`
- Create: `frontend/js/features/history/history.js`
- Create: `frontend/js/features/admin/admin.js`
- Modify: `frontend/js/main.js` (canonical orchestration)
- Modify: `frontend/index.html` (load `main.js` as single script entry point)
- Delete: `frontend/app.js` (monolithic file eliminated)

**Interfaces:**
- `main.js`: imports core and features, bootstraps routing, auth, catalog, and player.
- Dynamic imports for Admin and heavy features to minimize initial payload.

- [ ] **Step 1: Create core modules (`api.js`, `auth.js`, `router.js`, `state.js`, `ui.js`)**
  Export clean interfaces for network calls, cookie auth, state store, and accessible modal dialogs.

- [ ] **Step 2: Create feature modules (`catalog.js`, `detail.js`, `profiles.js`, `history.js`, `admin.js`)**
  Migrate logic from `app.js` into focused, domain-driven modules.

- [ ] **Step 3: Update `frontend/js/main.js` and `frontend/index.html`**
  Point `<script type="module" src="/js/main.js"></script>` and delete obsolete `app.js`.

- [ ] **Step 4: Run ESLint**
  Run: `npm run lint`
  Expected: 0 errors.

- [ ] **Step 5: Commit**
  Run: `git add -A`  
  Run: `git commit -m "refactor(frontend): migrate to domain architecture with main.js and eliminate app.js"`

---

### Task 6: Player Reconstruction & Streaming Backend (Phase 6, 7 & 8)

**Files:**
- Create: `frontend/js/features/player/player_controller.js`
- Create: `frontend/js/features/player/qr_generator.js`
- Modify: `frontend/player.js` (delegate to clean `PlayerController` or replace)
- Modify: `php_backend/controllers/PlayerController.php`
- Modify: `php_backend/router.php`
- Test: `tests/test_player_streaming_backend.php`

**Interfaces:**
- `PlayerController.mount(container, video, options)` / `PlayerController.destroy()`
- `PlayerController.php`: `serveStream(string $episodeId)` handles `HEAD` requests instantly with headers only; validates HTTP byte `Range` (206/416); limits concurrent FFmpeg remux workers.
- `qr_generator.js`: generates SVG QR code in browser without third-party APIs.

- [ ] **Step 1: Write test for streaming backend**
  Create `tests/test_player_streaming_backend.php` verifying HEAD requests return 200 without FFmpeg, Range requests return 206 with Content-Range, and invalid Range returns 416.

- [ ] **Step 2: Run test to verify it fails**
  Run: `php tests/test_player_streaming_backend.php`
  Expected: FAIL.

- [ ] **Step 3: Implement streaming optimizations in `php_backend/controllers/PlayerController.php`**
  Support HEAD, 206 Partial Content, 416 Range Not Satisfiable, and worker concurrency limit.

- [ ] **Step 4: Implement `player_controller.js` and local `qr_generator.js`**
  Mount/destroy lifecycle, eliminate intervals, no sakura pause particles, opt-in ambilight.

- [ ] **Step 5: Run streaming backend test**
  Run: `php tests/test_player_streaming_backend.php`
  Expected: PASS ✓

- [ ] **Step 6: Commit**
  Run: `git add frontend/js/features/player/ php_backend/controllers/PlayerController.php tests/test_player_streaming_backend.php`  
  Run: `git commit -m "feat(player): implement unified PlayerController lifecycle, local QR, and robust Range/HEAD streaming"`

---

### Task 7: Profiles Security, Kids Filtering & Watch Party (Phase 9 & 10)

**Files:**
- Modify: `php_backend/controllers/AuthController.php`
- Modify: `php_backend/controllers/PartyController.php`
- Modify: `php_backend/controllers/ShowController.php`
- Modify: `php_backend/db.php`
- Test: `tests/test_profiles_and_kids_security.php`
- Test: `tests/test_party_security.php`

**Interfaces:**
- Profile ownership check: rejects profile edit/delete if `user_id` does not match auth session.
- Server-side kids restriction: `ShowController` filters out shows with `maturity_level > 'PG'` or `is_kids_safe = 0` when `is_kids` profile is active.
- Watch Party: persistent `party_members` tracking, guest tokens, drift correction preserving user's base rate.

- [ ] **Step 1: Write tests for profile IDOR, server-side kids restriction, and party drift**
  Create `tests/test_profiles_and_kids_security.php`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `php tests/test_profiles_and_kids_security.php`
  Expected: FAIL.

- [ ] **Step 3: Implement server-side profile verification and kids filtering**
  Update `AuthController.php`, `ShowController.php`, `PartyController.php`.

- [ ] **Step 4: Run tests to verify they pass**
  Run: `php tests/test_profiles_and_kids_security.php`  
  Run: `php tests/test_party_security.php`  
  Expected: PASS ✓

- [ ] **Step 5: Commit**
  Run: `git add php_backend/ controllers tests/test_profiles_and_kids_security.php`  
  Run: `git commit -m "fix(security): resolve profile IDOR, enforce server-side kids maturity filter, and harden watch party"`

---

### Task 8: Versioned DB Migrations, Scanner Hardening & Filesystem Safety (Phase 11, 12, 13, 14 & 15)

**Files:**
- Create: `php_backend/migrations/001_initial_schema.sql`
- Create: `php_backend/migrations/002_foreign_keys_and_indexes.sql`
- Create: `php_backend/migrations/003_party_members_table.sql`
- Create: `php_backend/services/MigrationManager.php`
- Modify: `php_backend/controllers/AdminController.php`
- Modify: `php_backend/middleware/RateLimiter.php` (atomic `flock`)
- Test: `tests/test_filesystem_and_scanner_safety.php`

**Interfaces:**
- `MigrationManager::migrate()`: applies unapplied `.sql` scripts and tracks in `schema_migrations`.
- Path traversal verification: all file operations verify `realpath()` begins with `LIBRARY_DIR`.
- RateLimiter: uses `flock(LOCK_EX)` for atomic increments and outputs `Retry-After`.

- [ ] **Step 1: Write tests for filesystem traversal defense and rate limiter locking**
  Create `tests/test_filesystem_and_scanner_safety.php`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `php tests/test_filesystem_and_scanner_safety.php`
  Expected: FAIL.

- [ ] **Step 3: Implement `MigrationManager.php`, atomic `RateLimiter.php`, and path canonicalization**
  Add migrations and harden file copy/unlink operations against traversal.

- [ ] **Step 4: Run test to verify it passes**
  Run: `php tests/test_filesystem_and_scanner_safety.php`
  Expected: PASS ✓

- [ ] **Step 5: Commit**
  Run: `git add php_backend/migrations/ php_backend/services/MigrationManager.php php_backend/middleware/RateLimiter.php php_backend/controllers/AdminController.php tests/test_filesystem_and_scanner_safety.php`  
  Run: `git commit -m "feat(backend): add versioned database migrations, atomic rate limiting, and safe filesystem operations"`

---

### Task 9: PWA, Docker, Security Headers & Notifications (Phase 16, 17, 18 & 19)

**Files:**
- Create: `.dockerignore`
- Modify: `Dockerfile`
- Modify: `frontend/sw.js`
- Modify: `frontend/manifest.json`
- Modify: `php_backend/router.php` (security headers: CSP, X-Content-Type-Options, Referrer-Policy)

**Interfaces:**
- `.dockerignore`: excludes `.git`, `.env`, `node_modules`, `library/`, and temp files.
- `router.php`: emits CSP (allowing WASM and local assets), `X-Content-Type-Options: nosniff`.
- `sw.js`: cleans stale caches, handles offline fallback via `offline.html`.

- [ ] **Step 1: Create `.dockerignore` and update `Dockerfile`**
  Ensure Docker builds produce clean, minimal images without leaked secrets or libraries.

- [ ] **Step 2: Update `sw.js` and `router.php` security headers**
  Include CSP, frame-ancestors, nosniff, and stale-while-revalidate for assets.

- [ ] **Step 3: Verify with PHP test**
  Run: `php tests/test_security_and_api_fixes.php`
  Expected: PASS ✓

- [ ] **Step 4: Commit**
  Run: `git add .dockerignore Dockerfile frontend/sw.js frontend/manifest.json php_backend/router.php`  
  Run: `git commit -m "feat(infra): add dockerignore, security headers, and optimized PWA service worker"`

---

### Task 10: Complete Test Suite & CI Automation (Phase 22)

**Files:**
- Modify: `tests/run_all_tests.php`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- `run_all_tests.php`: runs all unit and integration tests.
- `.github/workflows/ci.yml`: runs PHP lint, test suite, ESLint, and security scanning on every push.

- [ ] **Step 1: Update `tests/run_all_tests.php`**
  Include all newly created test files and remove obsolete torrent tests.

- [ ] **Step 2: Run full test suite**
  Run: `php tests/run_all_tests.php`
  Expected: All non-DB tests PASS ✓.

- [ ] **Step 3: Create GitHub Actions workflow (`ci.yml`)**
  Automate lint, PHP tests, and security scans.

- [ ] **Step 4: Commit**
  Run: `git add tests/run_all_tests.php .github/workflows/ci.yml`  
  Run: `git commit -m "ci: configure automated GitHub Actions for tests, linting, and security"`

---

### Task 11: Professional Documentation Rewrite (Phase 23)

**Files:**
- Modify: `README.md`

**Interfaces:**
- Comprehensive technical documentation without emojis, without torrent/aria2 references, with accurate Mermaid architecture diagrams and installation guides.

- [ ] **Step 1: Rewrite `README.md`**
  Include features, architecture diagram, requirements, docker instructions, security guidelines, and troubleshooting.

- [ ] **Step 2: Verify no emojis or torrent references exist in README**
  Run: `git grep -inE "aria2|torrent|nyaa" README.md` (Expected: 0)  
  Run: `git grep -Pn "[\x{1F300}-\x{1F9FF}\x{2600}-\x{26FF}]" README.md` (Expected: 0)

- [ ] **Step 3: Commit**
  Run: `git add README.md`  
  Run: `git commit -m "docs: rewrite README with professional architecture guide and zero emojis"`

---

### Task 12: Final Verification & Audit (Phase 24)

**Files:**
- Review entire repository tree.

- [ ] **Step 1: Run secret check across codebase**
  Run: `php tests/test_secret_scanning.php`
  Expected: PASS ✓

- [ ] **Step 2: Run torrent code check**
  Run: `php tests/test_no_torrent_artifacts.php`
  Expected: PASS ✓

- [ ] **Step 3: Run emoji check**
  Run: `php tests/test_emoji_purge.php`
  Expected: PASS ✓

- [ ] **Step 4: Run ESLint**
  Run: `npm run lint`
  Expected: 0 errors.

- [ ] **Step 5: Run PHP test suite**
  Run: `php tests/run_all_tests.php`
  Expected: PASS ✓

- [ ] **Step 6: Prepare final executive delivery report**
