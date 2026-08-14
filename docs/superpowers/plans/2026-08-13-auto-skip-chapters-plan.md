# Auto-Skip Intro/Outro & Marcadores de Capítulos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement auto-skip for intros/outros (configurable in User Preferences) and chapter markers with dropdown selection in KuraStream's video player and PHP 8 / MySQL backend.

**Architecture:** Extend `php_backend/db.php` schema to store user preferences and episode chapters in MySQL. Add REST endpoints `/api/user/preferences` and `/api/episodes/{id}/timestamps`. Integrate "Auto-saltar Intro/Outro" toggle in settings (`frontend/app.js` / `frontend/index.html`) and overlay button + chapter markers + seekbar ticks in `frontend/player.js`.

**Architecture Diagram:**

```mermaid
graph TD
    subgraph Frontend
        UI[Ajustes -> Preferencias] -->|Guardar auto_skip_intro| State[App State & LocalStorage]
        Player[player.js Video Player] -->|Lee auto_skip_intro| State
        Player -->|Renderiza| Overlay[Overlay 'Saltar Intro']
        Player -->|Renderiza| SeekbarTicks[Marcadores en Barra de Progreso]
        Player -->|Renderiza| ChapterMenu[Menú Desplegable de Capítulos]
    end

    subgraph PHP Backend & MySQL
        State -->|GET/POST /api/user/preferences| HistCtrl[HistoryController.php]
        Player -->|GET /api/episodes/{id}| PlayCtrl[PlayerController.php]
        HistCtrl -->|PDO MySQL| DB[(MySQL Database)]
        PlayCtrl -->|PDO MySQL| DB
    end
```

**Tech Stack:** PHP 8.x, PDO MySQL, HTML5 / Vanilla JavaScript, Custom CSS styling.

## Global Constraints

- Backend must remain 100% modular PHP 8 with PDO MySQL (`DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`).
- `auto_skip_intro` must be OFF by default and only skip when enabled in settings.
- Chapter markers must be visible and selectable for all users by default.
- Code edits must be clean, modular, and adhere to existing KuraStream patterns.

---

### Task 1: MySQL Schema Updates & Backend Preferences API

**Files:**
- Modify: [php_backend/db.php](file:///home/carlossgr/Escritorio/KuraStream/php_backend/db.php)
- Modify: [php_backend/controllers/HistoryController.php](file:///home/carlossgr/Escritorio/KuraStream/php_backend/controllers/HistoryController.php)
- Modify: [php_backend/controllers/PlayerController.php](file:///home/carlossgr/Escritorio/KuraStream/php_backend/controllers/PlayerController.php)
- Create: `tests/test_auto_skip_db.php`

**Interfaces:**
- Consumes: MySQL PDO connection from `Database::getConnection()`
- Produces: `DbHelper::getUserPreferences`, `DbHelper::saveUserPreferences`, `DbHelper::saveEpisodeTimestamps`
- API Endpoints:
  - `GET /api/user/preferences` -> `{ "success": true, "preferences": { "auto_skip_intro": false } }`
  - `POST /api/user/preferences` -> `{ "auto_skip_intro": true }` -> `{ "success": true }`
  - `POST /api/episodes/{id}/timestamps` -> `{ "intro_start": 0, "intro_end": 90, "outro_start": 1200, "chapters": [...] }`

- [ ] **Step 1: Write test script for Database helper methods**

Create `tests/test_auto_skip_db.php`:
```php
<?php
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';

try {
    $db = Database::getConnection();
    echo "DB Connection OK\n";

    // Test getUserPreferences default
    $prefs = DbHelper::getUserPreferences('test_user', 'Principal');
    assert(isset($prefs['auto_skip_intro']), "auto_skip_intro should be present");
    echo "Default prefs OK: auto_skip_intro=" . ($prefs['auto_skip_intro'] ? '1' : '0') . "\n";

    // Test saveUserPreferences
    DbHelper::saveUserPreferences('test_user', 'Principal', ['auto_skip_intro' => 1]);
    $updated = DbHelper::getUserPreferences('test_user', 'Principal');
    assert($updated['auto_skip_intro'] == 1, "auto_skip_intro should be 1");
    echo "Save prefs OK\n";

    echo "ALL TESTS PASSED\n";
} catch (Throwable $e) {
    echo "TEST FAILED: " . $e->getMessage() . "\n";
    exit(1);
}
```

- [ ] **Step 2: Run test to verify it fails before implementation**

Run: `php tests/test_auto_skip_db.php`
Expected: Call to undefined method `DbHelper::getUserPreferences()` or similar failure.

- [ ] **Step 3: Update `php_backend/db.php` with new schema and methods**

Modify [php_backend/db.php](file:///home/carlossgr/Escritorio/KuraStream/php_backend/db.php):
Add `user_preferences` table initialization in `initializeSchema()`:
```sql
CREATE TABLE IF NOT EXISTS user_preferences (
    username VARCHAR(255) NOT NULL,
    profile_name VARCHAR(255) NOT NULL DEFAULT 'Principal',
    auto_skip_intro TINYINT(1) DEFAULT 0,
    auto_play_next TINYINT(1) DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (username, profile_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```
Check and add `chapters` column to `episodes` if not present.
Add helper methods in `DbHelper`:
```php
public static function getUserPreferences(string $username, string $profile = 'Principal'): array {
    $db = Database::getConnection();
    $stmt = $db->prepare("SELECT * FROM user_preferences WHERE username = :u AND profile_name = :p");
    $stmt->execute(['u' => $username, 'p' => $profile]);
    $row = $stmt->fetch();
    if (!$row) {
        return ['auto_skip_intro' => 0, 'auto_play_next' => 1];
    }
    return [
        'auto_skip_intro' => (int)$row['auto_skip_intro'],
        'auto_play_next' => (int)$row['auto_play_next']
    ];
}

public static function saveUserPreferences(string $username, string $profile, array $data): void {
    $db = Database::getConnection();
    $autoSkip = isset($data['auto_skip_intro']) ? (int)$data['auto_skip_intro'] : 0;
    $autoPlay = isset($data['auto_play_next']) ? (int)$data['auto_play_next'] : 1;

    $stmt = $db->prepare("
        INSERT INTO user_preferences (username, profile_name, auto_skip_intro, auto_play_next)
        VALUES (:u, :p, :skip, :play)
        ON DUPLICATE KEY UPDATE auto_skip_intro = VALUES(auto_skip_intro), auto_play_next = VALUES(auto_play_next)
    ");
    $stmt->execute(['u' => $username, 'p' => $profile, 'skip' => $autoSkip, 'play' => $autoPlay]);
}
```

- [ ] **Step 4: Update `php_backend/controllers/HistoryController.php` & `PlayerController.php`**

Add routes for `/api/user/preferences` in `HistoryController.php` and `/api/episodes/{id}/timestamps` in `PlayerController.php`.

- [ ] **Step 5: Run DB test to verify it passes**

Run: `php tests/test_auto_skip_db.php`
Expected: `ALL TESTS PASSED`

- [ ] **Step 6: Commit Task 1**

```bash
git add php_backend/db.php php_backend/controllers/HistoryController.php php_backend/controllers/PlayerController.php tests/test_auto_skip_db.php
git commit -m "feat(backend): add user_preferences schema and API endpoints for auto-skip and timestamps"
```

---

### Task 2: Frontend Preferences UI & State Synchronization

**Files:**
- Modify: [frontend/index.html](file:///home/carlossgr/Escritorio/KuraStream/frontend/index.html)
- Modify: [frontend/app.js](file:///home/carlossgr/Escritorio/KuraStream/frontend/app.js)

**Interfaces:**
- Consumes: `GET /api/user/preferences`, `POST /api/user/preferences`
- Produces: `window.userPreferences = { auto_skip_intro: boolean }`, local storage sync.

- [ ] **Step 1: Add Preferencias toggle switch in `frontend/index.html`**

In the settings modal of `frontend/index.html`, add:
```html
<div class="setting-item">
  <div class="setting-info">
    <label for="autoSkipIntroToggle" class="setting-label">Saltar Intro / Outro Automáticamente</label>
    <p class="setting-desc">Si está activado, el reproductor omitirá la intro y outro automáticamente al alcanzar su inicio.</p>
  </div>
  <label class="switch">
    <input type="checkbox" id="autoSkipIntroToggle">
    <span class="slider round"></span>
  </label>
</div>
```

- [ ] **Step 2: Implement preference sync logic in `frontend/app.js`**

Add functions `loadUserPreferences()` and `saveUserPreferences()` in `frontend/app.js` to manage `auto_skip_intro` state in `localStorage` and send changes to `/api/user/preferences`.

- [ ] **Step 3: Commit Task 2**

```bash
git add frontend/index.html frontend/app.js
git commit -m "feat(frontend): add auto-skip intro toggle switch in settings modal"
```

---

### Task 3: Video Player Auto-Skip Overlay & Chapter Markers UI

**Files:**
- Modify: [frontend/style.css](file:///home/carlossgr/Escritorio/KuraStream/frontend/style.css)
- Modify: [frontend/player.js](file:///home/carlossgr/Escritorio/KuraStream/frontend/player.js)

**Interfaces:**
- Consumes: Episode object with `intro_start`, `intro_end`, `outro_start`, `chapters`, and `window.userPreferences.auto_skip_intro`
- Produces: `[ ⏩ Saltar Intro ]` button overlay, Seekbar chapter ticks, and Chapter selection dropdown modal.

- [ ] **Step 1: Add CSS styles in `frontend/style.css`**

Add CSS rules for:
- `.skip-intro-btn`: Floating button at bottom-right of video container (glow, neon hover, smooth animation).
- `.seekbar-chapter-tick`: Colored marker indicators placed along `.player-seekbar`.
- `.chapters-dropdown`: Popover list for selecting chapters.

- [ ] **Step 2: Update `frontend/player.js` to handle Auto-Skip logic & Chapter UI**

In `frontend/player.js`:
1. On `timeupdate`:
   - Check if current time is within `[intro_start, intro_end]` or `[outro_start, duration]`.
   - If `window.userPreferences?.auto_skip_intro` is `true` (and not already skipped), seek to `intro_end` and show a brief toast.
   - If `window.userPreferences?.auto_skip_intro` is `false`, render/show `.skip-intro-btn`. Clicking it seeks to `intro_end`.
2. On episode metadata loaded:
   - Calculate percentage positions for `chapters` / `intro_start` / `intro_end` / `outro_start` and render tick marks on the seek bar.
3. Chapter Button:
   - Add a chapter menu button in player control bar that opens `.chapters-dropdown` containing chapter list (`Intro`, `Episodio`, `Outro`, etc.). Clicking a item seeks to its timestamp.

- [ ] **Step 3: Test player functionality**

Run local PHP backend server and test UI interaction or run test script.

- [ ] **Step 4: Commit Task 3**

```bash
git add frontend/style.css frontend/player.js
git commit -m "feat(player): implement auto-skip intro overlay and chapter markers dropdown UI"
```
