# KuraStream v2.0: Modern Streaming Platform Architecture & Comprehensive Refactoring Spec

**Date:** 2026-09-25  
**Status:** Approved  
**Branch:** `refactor/v2-modern-streaming`  
**Target:** Monolithic Modular Clean Architecture (Vanilla JS + ES Modules, PHP 8.4 REST Backend, MySQL/MariaDB)

---

## 1. Executive Summary & Goals

KuraStream is an open-source, self-hosted anime and media streaming platform. Over previous iterations, multiple competing subsystems, legacy Node.js leftovers, hardcoded credentials, duplicate player logic, monolithic UI code (`app.js` > 7,000 lines), and obsolete torrent automation accrued significant technical debt.

The purpose of this specification is to establish a unified, secure, verifiable, high-craft architecture that transforms KuraStream into a modern, commercial-grade streaming platform (comparable in design discipline and responsiveness to Crunchyroll, Netflix, and Apple TV+), adhering to the Anti-Slop frontend design directives (Taste skill), strict WCAG AA accessibility, zero hardcoded emojis in UI chrome, zero torrent/aria2 dependencies, and robust backend media streaming.

---

## 2. Phase 0: Credential Security Incident & Secret Hardening

### 2.1 Threat Model & Remediation
- **Hardcoded Secrets Identified:**
  - `deploy_remote.py` and `legacy_backend/scripts/setup_ssh_key.py`: Contained hardcoded SSH passwords and `StrictHostKeyChecking=no`.
  - `php_backend/services/TmdbScraper.php`: Contained fallback TMDB API Key.
- **Action Plan:**
  1. Remove hardcoded credentials completely from all deployment and scraper scripts.
  2. Deprecate and remove insecure deployment scripts that bypass SSH host key verification.
  3. Ensure TMDB API Key is read exclusively from environment variables (`TMDB_API_KEY`) or `.env`.
  4. Replace SSH password-based deployments with key-based authentication requiring explicit `known_hosts` or SSH agent configuration.
  5. Add explicit notice in the documentation advising the repository owner to rotate any previously exposed external credentials.
  6. Introduce GitHub Actions CI secret scanning (via Gitleaks) to prevent accidental future commits of secrets.

---

## 3. Phase 1: Complete Elimination of Torrents / Aria2 / Nyaa

### 3.1 Components to Purge
- **Binaries:** `bin/aria2c`
- **Backend Services:** `php_backend/services/TorrentDownloader.php`
- **Backend Tests:** `php_backend/tests/test_torrent_downloader.php`, `tests/test_aria2_platform.php`
- **Admin & Controller Routes:** Remove `/api/admin/torrent/*`, torrent polling, and aria2 process handlers from `php_backend/controllers/AdminController.php` and `php_backend/router.php`.
- **Frontend Modules:** Remove `frontend/js/modules/admin_torrents.js`, torrent polling loops, and torrent tabs in `frontend/index.html` and `frontend/js/modules/navigation.js`.
- **Legacy Files:** Remove `legacy_backend/scripts/anime_autodownloader.js`, torrent state files (`php_backend/torrent_state.json`), and references across `.gitignore` and docs.
- **Staging / "Por organizar":** Retained exclusively for manual file uploads, USB drive imports, or local directory scanning; decoupled from torrent semantics.
- **Verification Rule:** `git grep -inE "aria2|aria2c|torrent|nyaa|magnet|autodownload|anime_autodownloader"` must return 0 hits in active project code.

---

## 4. Phase 2: Single Canonical Frontend Architecture

### 4.1 Modular Domain Structure
Replace the monolithic `frontend/app.js` and redundant modules with a single entry point `frontend/js/main.js` and a cohesive modular structure:

```
frontend/
├── index.html
├── manifest.json
├── offline.html
├── sw.js
├── css/
│   ├── tokens.css
│   ├── base.css
│   ├── layout.css
│   ├── components.css
│   ├── catalog.css
│   ├── player.css
│   └── admin.css
└── js/
    ├── main.js
    ├── core/
    │   ├── api.js         # Fetch client, CSRF, response timing, error handling
    │   ├── auth.js        # Session, login/logout, active profile state
    │   ├── router.js      # Hash/History view routing
    │   ├── state.js       # Reactive application store
    │   └── ui.js          # Toasts, accessible modals, Lucide icon helpers
    └── features/
        ├── catalog/       # Hero banner, media rails, search debounce, genre chips
        ├── show-detail/   # Backdrop, seasons & episodes list, metadata
        ├── player/        # Unified PlayerController, audio/sub tracks, gestures
        ├── party/         # Watch Party SSE client, sync room, guest tokens
        ├── profiles/      # Profile selection, PIN modal, avatar picker
        ├── favorites/     # User bookmarking & watch-list management
        ├── history/       # Continue watching sync & playback progress
        ├── notifications/ # Persistent notification feed
        ├── calendar/      # Simulcast / schedule view
        └── admin/         # Staging import, manual scanner, health status
```

### 4.2 Dead Code & Event Cleanup
- Eliminate duplicate event listeners, inline `onclick` attributes, and orphaned `/api/chat` calls.
- Once domains are fully migrated, delete `frontend/app.js`.

---

## 5. Phase 3 & 4: Design System & Visual Redesign (Anti-Slop / Taste Directives)

### 5.1 Design Tokens (`frontend/css/tokens.css`)
- **Neutral Palette:**
  - Background Base: `#090D0E` (Deep jet-black)
  - Surface Primary: `#131A1C` (Obsidian)
  - Surface Raised / Hover: `#1B2326`
  - Border Subtle: `rgba(255, 255, 255, 0.08)`
  - Text Primary: `#F4F8F9`
  - Text Secondary: `#93A4A7`
- **Accents:**
  - Brand Accent: `#F97316` (Vibrant Copper/Orange)
  - Brand Accent Hover: `#FB923C`
  - Success / Jade: `#2DD4BF` (Status tags, positive states only)
  - Rating: `#FBBF24` (Tabular star rating)
- **Radii:** Strict 4px standard (`--radius-sm: 4px; --radius-md: 4px;`) across all cards, modals, and buttons.
- **Visual Hygiene:** Purge uncontrolled glassmorphism, multi-color AI gradients, and indiscriminate drop-shadows.

### 5.2 Layout & Navigation Hierarchy
- **Navbar:** Sticky translucent surface with subtle 1px bottom border (`rgba(255,255,255,0.06)`), smooth scroll transition, clear primary routes (`Inicio`, `Anime`, `Películas`, `Mi Lista`), and secondary dropdowns for account, admin, and settings.
- **Hero Billboard:** Viewport constrained (60vh–75vh), genuine media backdrop with bottom vignette fade into content rails. Prominent primary CTA ("▶ Reproducir") and secondary action ("+ Mi Lista").
- **Content Rails:** Responsive horizontal scrolling rails (`Continuar Viendo`, `Recién Añadidos`, `Populares`, `Por Género`) with clear poster art, subtle hover lift (`scale(1.04)`), and instant details.
- **Show Detail Modal / View:** Clean backdrop, clear synopsis, season selector tabs, and high-density episode cards with thumbnail, episode title, runtime, and progress bar.

---

## 6. Phase 5: Iconography & Emoji Purge

- Replace all hardcoded Unicode emoji symbols (`⭐`, `🔥`, `📺`, `🎉`, `🍿`, `🔒`, `⚙️`, etc.) in UI templates with accessible Lucide SVGs (`lucide.createIcons()` or embedded inline SVGs).
- Each icon button will have explicit `aria-label`, `title`, and keyboard focus styling.
- Chat/Party user-typed emojis will remain untouched; only UI chrome will be sanitized.

---

## 7. Phase 6, 7 & 8: Video Player & Streaming Architecture

### 7.1 Unified `PlayerController`
- Single frontend player state machine with strict lifecycle:
  `mount()` → `loadEpisode(episodeId)` → `attachListeners()` → `destroy()`
- Explicit teardown in `destroy()`: disconnects video listeners, clears active timers/intervals, closes active SubtitlesOctopus worker, terminates Watch Party SSE listeners, and clears PiP/MediaSession.
- Remove sakura pause particle animations.
- Ambilight mode: Disabled by default, respects `prefers-reduced-motion`, pauses when tab is hidden or video is paused.
- Mobile gestures: Double tap left (-10s) / right (+10s), smooth speed hold overlay.

### 7.2 Backend Streaming Engine (`PlayerController.php`)
- **HEAD Request Support:** Returns `Accept-Ranges: bytes`, `Content-Length`, `Content-Type`, and HTTP 200 without reading the entire file or launching FFmpeg.
- **Byte-Range Serving:** Native HTTP 206 Partial Content and HTTP 416 Range Not Satisfiable handling with proper `Content-Range: bytes START-END/TOTAL`.
- **Transcode Limits & Queue:** Concurrency semaphore limiting active FFmpeg remux/transcode workers (default max 2 concurrent), job timeouts, and kill handlers on client disconnect (`connection_aborted()`).
- **FFprobe Hardening:** Returns strict probe status; never defaults unknown codecs to fake values.
- **Local QR Code:** Replaces external third-party QR API with an in-browser local generator (using lightweight standalone JS SVG generation).

---

## 8. Phase 9, 10 & 11: Security, Auth, Watch Party & Profiles

### 8.1 Watch Party Hardening
- Introduce `party_members` table in MySQL:
  - Columns: `room_id`, `member_id`, `session_token`, `username`, `is_host`, `joined_at`, `last_ping`.
- Ephemeral, cryptographically secure guest tokens (`bin2hex(random_bytes(16))`).
- Accurate participant tracking with heartbeat/SSE disconnect cleanup.
- Drift correction maintains user's base playback speed (`effectiveRate = userBaseRate * driftMultiplier`).

### 8.2 Profiles & IDOR Protection
- Ensure profile update/delete operations verify that `user_id` matches the authenticated session token.
- Generate profile IDs using cryptographically secure UUIDs.
- Enforce `UNIQUE(user_id, name)` constraint on `user_profiles`.
- Server-side active profile signing in session tokens (`profile_id` included in JWT/session).
- **Server-Side Kids Restriction:** Content queries filter out any show with `maturity_level > 'PG'` or `is_kids_safe = 0` whenever the authenticated profile is marked as `is_kids = 1`.

### 8.3 Rate Limiting
- Replace race-prone JSON rate limiter with atomic file-locking (`flock`) or database tracking.
- Proper HTTP 429 response with `Retry-After: <seconds>` header.
- Trust proxy configuration (`X-Forwarded-For` only evaluated when remote IP is in trusted proxy list).

---

## 9. Phase 12, 13, 14 & 15: Database Migrations, Scanner & Integrations

### 9.1 Versioned Migrations
- Create `php_backend/migrations/` with incremental SQL scripts (`001_initial_schema.sql`, `002_foreign_keys.sql`, `003_party_members.sql`, `004_kids_maturity.sql`).
- Dedicated `MigrationManager.php` tracking applied migrations in `schema_migrations` table.
- Enforce foreign keys with proper cascade semantics (`episodes` → `shows`, `user_profiles` → `users`).

### 9.2 Safe Media Scanner
- Strict directory traversal defense: canonicalize paths with `realpath()`, verifying they reside inside `LIBRARY_DIR`.
- Fingerprint files using `mtime` and `size` to avoid re-probing unchanged media.
- Background progress reporting without holding persistent long-polling HTTP connections.

### 9.3 Hardened External Metadata Services (TMDB & AniList)
- TMDB API key strictly read from environment.
- Enforce strict TLS certificate verification in cURL (`CURLOPT_SSL_VERIFYPEER => true`).
- Persistent caching with graceful fallback (`stale-if-error`) when external API is unreachable.

---

## 10. Phase 16 to 24: Admin, PWA, A11y, Testing & Documentation

- **Admin UI:** Telemetry shows real system stats (`/api/health`), genuine active stream counter, and accessible modal dialogs instead of browser `alert()` / `confirm()`.
- **PWA:** Streamlined `sw.js` precache list (no dead files), stale-while-revalidate for static assets, network-first for API, and `offline.html` fallback.
- **Docker & Security Headers:** Add `.dockerignore` excluding `.git`, `.env`, `node_modules`, and media libraries. Add CSP, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin`.
- **Accessibility:** Full keyboard traversal, visible focus rings, ARIA roles for modal dialogs and video controls.
- **Regression Test Suite:** Expand PHP test suite to verify absence of torrent code, profile IDOR defense, kids filter, rate limiting, and player HEAD/Range requests.
- **Documentation:** Complete rewrite of `README.md` without emojis or torrent references.

---

## 11. Verification & Acceptance Criteria
- [ ] Working tree clean, changes organized in logical commits on `refactor/v2-modern-streaming`.
- [ ] No hardcoded passwords, tokens, or private keys anywhere in the repo.
- [ ] Zero active occurrences of `aria2`, `nyaa`, `torrent`, or `magnet`.
- [ ] `frontend/js/main.js` functions as the sole entry point; monolithic `frontend/app.js` removed.
- [ ] Zero hardcoded UI emojis in frontend chrome (Lucide used exclusively).
- [ ] PHP test suite passes cleanly with new security, player, and party tests.
- [ ] ESLint passes with 0 errors.
