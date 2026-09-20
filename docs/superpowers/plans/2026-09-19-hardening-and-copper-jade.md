# KuraStream Hardening and Copper-Jade Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make catalogue deletion safe, render imported metadata safely, correct technical video metadata, make Watch Party membership reliable, and adopt the copper-jade visual system.

**Architecture:** Preserve existing PHP controllers and Vanilla JS. Add narrowly scoped helpers for exact directory resolution and HTML/attribute escaping, persist Watch Party participant session ids in the database, and centralize visual values in CSS custom properties before replacing legacy purple literals.

**Tech Stack:** PHP 8.4, MySQL 8.4, Vanilla JavaScript, CSS, Node test runner, ESLint.

**Spec:** `docs/superpowers/specs/2026-09-19-hardening-and-copper-jade-design.md`

## Global Constraints

- Preserve current public API routes and guest Watch Party access.
- Write a regression test before every production behavior change.
- Do not delete user media except from the exact canonical directory of the selected show.
- Do not add paid services or product dependencies.
- Keep the UI dark, readable, responsive, and keyboard accessible.

## Review Focus

- Similar titles such as `Naruto` and `Naruto Shippuden` must never share deletion targets.
- Metadata containing quotes, angle brackets, or JavaScript-looking strings must remain text.
- A reconnecting guest must count once; a forged leave request must not remove another guest.
- SSE controls must not prevent a normal public room from reconnecting after its short stream window.
- Existing MySQL-dependent tests must report a clear prerequisite rather than obscure the actual failing behavior.

### Task 1: Safe library deletion and correct FPS metadata

**Files:**
- Modify: `php_backend/controllers/ShowController.php`
- Modify: `php_backend/services/FfmpegScanner.php`
- Modify: `tests/test_library_scan_and_player_routes.php`
- Create: `tests/test_ffmpeg_scanner.php`

**Interfaces:**
- Produces `ShowController::deleteShow()` that derives one deletion path from `show['id']` and `show['media_type']`.
- Produces `FfmpegScanner::parseFrameRate(string $value): float` for deterministic testing.

- [ ] Write tests proving a show id of `naruto` cannot delete a sibling folder named `naruto-shippuden`, and that `24000/1001` parses to `23.976`.
- [ ] Run the new tests and verify they fail for the unsafe/dead FPS behavior.
- [ ] Implement exact canonical path resolution, return the calculated FPS, and keep all existing path-containment checks.
- [ ] Run the focused tests, then `npm test` and `npm run lint`.
- [ ] Commit with `fix: protect library deletion and preserve video fps`.

### Task 2: Safe catalogue rendering and copper-jade tokens

**Files:**
- Modify: `frontend/app.js`
- Modify: `frontend/style.css`
- Modify: `frontend/index.html`
- Modify: `tests/test_ui_assets.php`

**Interfaces:**
- Produces `escapeHtml(value)` and `escapeAttribute(value)` for template output.
- All catalogue, hero, continue-watching, and episode values from API data pass through the appropriate helper.
- CSS exposes semantic variables for brand action, hover, success, rating, text, and surfaces.

- [ ] Add failing source-level regression assertions for escaped template fields and no legacy purple brand values in active UI tokens.
- [ ] Run the focused UI test and verify it fails for the unescaped/purple implementation.
- [ ] Implement escaped rendering and replace inline action colors with semantic copper-jade variables without changing API payloads.
- [ ] Run the focused test, `npm test`, and `npm run lint`.
- [ ] Commit with `fix: sanitize catalogue markup and refresh visual tokens`.

### Task 3: Reliable and bounded Watch Party participation

**Files:**
- Modify: `php_backend/db.php`
- Modify: `php_backend/controllers/PartyController.php`
- Modify: `php_backend/router.php` only if routing requires it
- Modify: `tests/test_party_security.php`

**Interfaces:**
- Produces participant persistence keyed by `room_id` and an opaque session identifier.
- `joinRoom()` is idempotent per participant session and `leaveRoom()` only removes the caller session.
- `streamEvents()` applies a connection/rate policy without changing the SSE event payload shape.

- [ ] Add a failing integration test for repeat joins, a forged leave, and excessive stream creation.
- [ ] Run it against the MySQL test service and verify the observed incorrect count or absent rate guard.
- [ ] Add the schema/data helpers, controller validation, idempotent count update, and bounded stream guard.
- [ ] Run focused Watch Party tests, then the full suite and lint.
- [ ] Commit with `fix: make watch party participation idempotent`.

### Task 4: Reproducible test environment and operator guidance

**Files:**
- Modify: `docker-compose.yml`
- Modify: `README.md`
- Modify: `package.json`
- Create: `scripts/verify-test-db.mjs`

**Interfaces:**
- Produces `npm run test:with-db`, which checks a reachable MySQL service and gives a concise command to start it when absent.

- [ ] Add a failing check for an unavailable database that reports the prerequisite clearly.
- [ ] Run it with MySQL unavailable and confirm the diagnostic is specific.
- [ ] Implement the script and documented Docker Compose workflow; do not embed credentials in source.
- [ ] Run the command with the available environment, full tests where possible, and lint.
- [ ] Commit with `docs: document reproducible database test workflow`.
