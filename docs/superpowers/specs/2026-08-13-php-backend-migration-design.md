# Design Specification: KuraStream Modular PHP Backend Migration

**Date:** 2026-08-13  
**Status:** Approved by User  
**Target Component:** Backend Migration (Node.js -> Modular PHP 8.x Architecture)

---

## 1. Overview & Goals

Migrate the entire KuraStream backend from Node.js to a clean, decoupled, modular **PHP 8.x** architecture without changing a single line of the frontend interface.

### Key Objectives
1. **100% Frontend Compatibility:**
   - All REST API contracts (`GET /api/shows`, `GET /api/calendar/schedule`, `POST /api/login`, `GET /api/stream`, `POST /api/admin/staged`, etc.) remain identical.
2. **Clean Modular Architecture:**
   - No giant monolith file. Split by responsibility into Controllers (`ShowController.php`, `PlayerController.php`, `AdminController.php`), Services (`TmdbScraper.php`, `FfmpegScanner.php`), and Database (`db.php`).
3. **Database Continuity:**
   - Uses `PDO` SQLite (`kurastream.db`), maintaining 1:1 schema compatibility with existing data (`shows`, `episodes`, `watch_history`, `favorites`, `staged_imports`).
4. **Video Streaming:**
   - Native HTTP `206 Partial Content` streaming with `Range` header support in `PlayerController.php`.

---

## 2. File Structure

```
php_backend/
├── router.php                  # Main entry point & API Router
├── config.php                  # Global config, constants, headers
├── db.php                      # PDO SQLite connection & query helpers
├── controllers/
│   ├── AuthController.php      # Login, password hashing & JWT verification
│   ├── ShowController.php      # Shows list, search, details, status toggles & covers
│   ├── CalendarController.php  # AniList GraphQL schedule & 6h memory/file cache
│   ├── PlayerController.php    # Episode info & HTTP Range video streaming
│   ├── HistoryController.php   # Watch history & favorites
│   └── AdminController.php     # Staged imports, publishing, deletion & stats
└── services/
    ├── TmdbScraper.php         # TMDB API metadata, search, and image download
    ├── FfmpegScanner.php       # FFmpeg video probing & thumbnail extraction
    └── LibraryScanner.php      # Folder scanner for /library/Anime and /library/Movies
```

---

## 3. Implementation Details

### Database Helper (`php_backend/db.php`)
Uses PDO SQLite with WAL journal mode:
```php
$db = new PDO('sqlite:' . DB_PATH);
$db->setAttribute(PDO::ATTR_ERRMODE, PDO.ERRMODE_EXCEPTION);
$db->exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
```

### API Router (`php_backend/router.php`)
Acts as front controller when running `php -S 0.0.0.0:3000 php_backend/router.php`:
- If file exists in `frontend/` or `library/`, serve static file.
- Else match path against API routes and invoke controller actions.

### Video Streaming (`php_backend/controllers/PlayerController.php`)
Handles `Range: bytes=X-Y` requests:
```php
$fp = fopen($filepath, 'rb');
fseek($fp, $start);
header('HTTP/1.1 206 Partial Content');
header("Content-Range: bytes $start-$end/$fileSize");
header("Content-Length: " . ($end - $start + 1));
header("Content-Type: video/mp4");
// Output stream chunks
```

---

## 4. Verification Plan

1. **Database Schema Verification:**
   - Run PHP script verifying PDO connection to SQLite database and table structure.
2. **API Compatibility Verification:**
   - Test endpoints (`GET /api/shows`, `GET /api/calendar/schedule`, `POST /api/login`) using curl/PHP test script.
3. **Manual User Verification:**
   - User tests UI, catalog, admin panel, and video playback on the PHP server.
