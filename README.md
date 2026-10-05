# KuraStream - Cloud Anime & Media Streaming Platform

KuraStream is a self-hosted, cloud-native anime and media streaming platform engineered for personal collections and home servers. It combines a cinematic web experience with real-time synchronized playback (Watch Party), multi-user profile isolation, and on-the-fly media transcoding.

---

## Architecture Overview

KuraStream utilizes a modern service architecture with PHP 8.4 handling API routing, security, and media transcoding orchestration, backed by MariaDB/MySQL for metadata and state persistence. The client interface is built with Vanilla JavaScript and native ES Modules.

```mermaid
graph TD
    Client[Browser / PWA Client] -->|HTTP / REST API| Router[PHP 8.4 Router]
    Client -->|Server-Sent Events| SSE[Watch Party Event Stream]
    Client -->|HTTP Range Requests / HEAD| StreamEngine[Media Streaming Controller]

    Router --> AuthMiddleware[JWT Auth & Profile Guard]
    Router --> ShowController[Catalog & Kids Maturity Filter]
    Router --> AdminController[Scanner & Media Importer]

    StreamEngine --> FFmpeg[FFmpeg Live Remux / Transcode Limiter]
    FFmpeg --> Library[(Media Storage / Library)]

    AuthMiddleware --> MySQL[(MySQL 8.0 / MariaDB)]
    ShowController --> MySQL
    AdminController --> MySQL
    AdminController --> MetadataScrapers[AniList GraphQL & TMDB API]
```

---

## Core Capabilities

### 1. High-Performance Video Player
- **On-the-Fly Remuxing and Transcoding**: Instant fragmented MP4 streaming (`/api/stream/{id}`) with optional stereo downmix, managed software transcoding, and strict worker concurrency limits to prevent host saturation.
- **WebAssembly Subtitle Rendering**: Pixel-perfect canvas rendering for advanced `.ass` and `.ssa` subtitle styles, karaoke effects, and custom fonts using WebAssembly libass.
- **Multi-Track Audio and Subtitle Management**: Instant switching between original audio, localized dubs, and multiple subtitle streams with persistent user preferences.
- **Chapters and Smart Skip**: Support for opening/ending timestamps with automated skip prompts and progress tracking.
- **Picture-in-Picture & Local Handoff**: Native browser Picture-in-Picture and in-browser SVG QR code generation for mobile handoff without external network requests.

### 2. Synchronized Watch Party
- **Real-Time Playback Synchronization**: Shared viewing rooms where playback state, timestamps, and active episodes synchronize across participants.
- **Server-Sent Events (SSE) Engine**: Low-latency push architecture (`/api/party/stream`) compatible with Cloudflare tunnels, reverse proxies, and firewalls without requiring external WebSocket servers.
- **Adaptive Drift Correction**: Subtly accelerates or slows playback (`1.06x` / `0.94x`) relative to each user's chosen playback speed, preserving base rates and eliminating audio distortion.
- **Interactive Chat and Reactions**: Overlay chat drawer and animated reaction particles visible during fullscreen playback.

### 3. Multi-User Profiles and Parental Controls
- **Independent User Profiles**: Netflix-style profile selector supporting unique watch history, continue watching queues, and custom avatars under a single account.
- **PIN Protection and IDOR Elimination**: Cryptographic bcrypt PIN verification and ownership checks on profile mutation and deletion.
- **Server-Side Kids Mode**: Enforcement of content ratings (filtering adult titles, TV-MA/18+ classifications, and adult genres) within application-side PHP controllers and streaming capability gates.

### 4. Automated Catalog & Metadata Scraping
- **Local Filesystem Scanner**: Scans media libraries (`Anime/` and `Movies/`), extracting codecs, resolutions, and audio channels using FFprobe.
- **Metadata Enrichment**: Enriches local titles via AniList GraphQL and TMDB REST APIs, fetching synopses, release years, cover artwork, and episode descriptions.
- **Staging and Import Pipeline**: Dedicated staging workflow for organizing, naming, and importing media files safely with directory traversal verification.

### 5. Progressive Web App (PWA)
- Fully installable desktop and mobile web application with offline service worker shell and responsive layouts.

---

## Technology Stack

- **Backend**: PHP 8.4 (CLI)
- **Database**: MySQL 8.0+ / MariaDB 10.11+
- **Media Engine**: FFmpeg / FFprobe
- **Frontend**: Vanilla JavaScript (ES Modules), CSS Custom Properties
- **Subtitles**: SubtitlesOctopus (libass WebAssembly)
- **Real-Time Push**: Server-Sent Events (SSE)
- **Containerization**: Docker, Docker Compose

---

## Installation & Deployment

### Method 1: Docker Deployment (Recommended)

1. Clone the repository:
   ```bash
   git clone https://github.com/TheCarlosS5/KuraStream.git
   cd KuraStream
   ```

2. Create an environment configuration file:
   ```bash
   cp .env.example .env
   ```
   Configure your database credentials, media path, and JWT secret.

3. Start services using Docker Compose:
   ```bash
   docker compose up -d
   ```

4. Access the web interface at `http://localhost:3000`.

### Method 2: Manual Host Setup

#### Requirements
- PHP 8.4 or higher with extensions: `pdo_mysql`, `curl`, `mbstring`, `fileinfo`
- MySQL 8.0 or MariaDB 10.11+
- FFmpeg and FFprobe installed in system PATH
- Node.js 20+ (for asset linting and test execution)

#### Steps
1. Clone and enter directory:
   ```bash
   git clone https://github.com/TheCarlosS5/KuraStream.git
   cd KuraStream
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   ```
   Set `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`, `JWT_SECRET`, and `MEDIA_LIBRARY_PATH`.

3. Initialize database and migrations:
   ```bash
   php -r 'require "php_backend/db.php"; Database::initializeSchema();'
   ```

4. Start development server:
   ```bash
   npm run dev
   # Or directly: php -S 0.0.0.0:3000 php_backend/router.php
   ```

---

## Configuration Variables

| Variable | Description | Default |
|---|---|---|
| `DB_HOST` | Database server address | `127.0.0.1` |
| `DB_PORT` | Database server port | `3306` |
| `DB_NAME` | Database schema name | `kurastream` |
| `DB_USER` | Database username | `kurastream` |
| `DB_PASS` | Database password | None |
| `MYSQL_ROOT_PASSWORD` | Root password for MySQL Docker container | None |
| `ADMIN_USER` | Initial administrative username | `admin` |
| `ADMIN_PASS` | Administrative password (plaintext, local development). Placeholders such as `change_me` or `admin` are rejected | None |
| `ADMIN_PASS_HASH` | Administrative password hash (bcrypt, production) | None |
| `JWT_SECRET` | Secret key for signing authentication tokens. At least 32 characters (`openssl rand -hex 32`); weak or placeholder values stop the server from starting | Required |
| `REGISTRATION_MODE` | `open` (default) lets anyone who can reach the server create an account; any other value closes sign-up | `open` |
| `CATALOG_ACCESS` | `open` (default) lets guests browse the catalog; `members` requires a signed-in session for the catalog, episodes, calendar and comments | `open` |
| `REGISTER_MAX_PER_HOUR` | New accounts allowed per IP address per hour | `5` |
| `MEDIA_LIBRARY_PATH` | Absolute path to media storage directory | `./library` |
| `TMDB_API_KEY` | Optional TMDB v3 API Key for metadata scraping | None |
| `TMDB_READ_TOKEN` | Optional TMDB v4 API Read Access Token for metadata scraping | None |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowed origins | `localhost, LAN` |
| `TRUSTED_PROXIES` | Comma-separated list of trusted reverse proxy IPs | None |

### Administrator Authentication & Docker Behavior

KuraStream supports environment-configured administrator credentials for initial setup and automated administration:

- **`ADMIN_PASS`**: Intended for simple plaintext local configuration.
- **`ADMIN_PASS_HASH`**: Recommended for production deployments. Provide a standard bcrypt hash (`password_hash('your_pass', PASSWORD_BCRYPT)`).
- **Precedence Rule**: If both `ADMIN_PASS_HASH` and `ADMIN_PASS` are defined, `ADMIN_PASS_HASH` takes precedence and is verified first.
- **Credential Protection**: Administrator passwords are never logged, echoed in API responses, or stored in frontend scripts.
- **Docker Compose Forwarding**: Because `.dockerignore` excludes `.env` files from being copied into the container image, `docker-compose.yml` explicitly passes `ADMIN_USER`, `ADMIN_PASS`, `ADMIN_PASS_HASH`, `TMDB_API_KEY`, `ALLOWED_ORIGINS`, and `TRUSTED_PROXIES` from the host `.env` into the container's environment. Without explicit forwarding in `docker-compose.yml`, containerized PHP processes cannot access environment variables defined in `.env`.


---

## Directory Structure

```
KuraStream/
├── frontend/                     # Client application (Vanilla JS + ES Modules)
│   ├── index.html                # Single-page application shell
│   ├── css/                      # Modular CSS architecture
│   │   ├── tokens.css            # Design tokens (colors, typography, radii, spacing)
│   │   ├── base.css              # Reset, typography, and base elements
│   │   ├── layout.css            # Grid, navbar, sidebar, and container layouts
│   │   ├── components.css        # Buttons, cards, modals, form controls
│   │   ├── catalog.css           # Billboard hero, media rails, grid filters
│   │   ├── player.css            # Player chrome, HUD, controls, overlays
│   │   └── admin.css             # Administrative dashboard and staging tables
│   ├── js/
│   │   ├── main.js               # Canonical application entrypoint
│   │   ├── core/                 # Core utilities (API client, auth, router, state, UI)
│   │   └── features/             # Domain modules (catalog, player, profiles, admin)
│   ├── player.js                 # Video playback engine & SubtitlesOctopus integration
│   ├── sw.js                     # Service worker with offline precaching
│   └── manifest.json             # PWA web manifest
├── php_backend/                  # PHP 8.4 REST API & streaming backend
│   ├── config.php                # Environment config, CORS, and security headers
│   ├── db.php                    # PDO database connection and query helpers
│   ├── router.php                # REST routing, static file handler, and CSP dispatch
│   ├── controllers/              # Domain controllers (Auth, Show, Player, Party, Admin)
│   ├── middleware/               # Auth token verification and atomic rate limiting
│   ├── migrations/               # Versioned SQL database migrations
│   └── services/                 # Scrapers, migration manager, and transcode limiter
├── tests/                        # Unified automated test suite (PHP & Node.js)
├── .github/workflows/            # CI workflows (Security audit & test automation)
├── Dockerfile                    # Unprivileged single-stage container build
└── docker-compose.yml            # Docker Compose service definition
```

---

## Security Architecture

- **Unprivileged Containers**: Docker containers run under a non-root `kurastream` user account.
- **Content Security Policy & Hardening**: Standard CSP with scoped script-src, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `SameSite=Lax` HTTP-only cookies are enforced on all routes.
- **Key-Based Remote Operations**: Deployment scripts (`deploy_remote.py`) strictly require SSH key authentication with TOFU (Trust On First Use via accept-new) host verification.
- **Path Traversal Guards**: Strict `realpath()` boundary checks prevent access outside designated library and staging roots.
- **Secret Scanning**: Automated CI scanning via Gitleaks verifies no credentials, API keys, or private keys are committed.
- **Notice**: Any credentials or access keys committed prior to version 2.0 must be rotated immediately in external systems.

### Sessions and revocation

- **Session tokens are revocable.** Each account has a `token_version` (migration 013) that is embedded in its JWT as `ver`. `POST /api/account/password` (change password) and `POST /api/account/logout-all` increment it, which immediately invalidates every other token of the account; the calling device receives a fresh token in the response.
- **Account state is re-read on every request.** The role, the active profile's name and its kids flag come from the database, not from the token, so demoting an admin, deleting an account, or enabling kids mode on a profile applies to every device at once instead of when the 30-day token expires.
- **Watch Party tickets are not sessions.** Stream/SSE tickets share the signing key but carry a `type` claim and are refused wherever a login is required.
- **Watch Party guests are opt-in.** A room admits people without an account only when its host enables *Permitir invitados sin cuenta* (`allow_guests`, off by default). Guests cannot use the name of a registered account or "Sistema"; accounts must have an active profile to join (so kids mode always applies); turning the option off removes the guests immediately, and the public room list requires a signed-in session.
- **PIN guesses are throttled** (5 per 15 minutes per account and profile; a correct PIN resets the counter).
- The administrator defined by `ADMIN_USER` has no database row; its token is trusted as issued and it cannot use the password endpoints (change `ADMIN_PASS_HASH` in the server configuration instead).

---

## Quality & Testing

Run all test suites locally. The PHP and end-to-end suites create and delete users, profiles, shows and rooms, so they
must run against a throwaway database whose name ends in `_test` (the PHP runner refuses anything else):

```bash
# One-time setup
mysql -e "CREATE DATABASE kurastream_test; GRANT ALL ON kurastream_test.* TO 'kurastream'@'%'"
export DB_NAME=kurastream_test

# Run JavaScript UI regression tests
node tests/ui_catalogue_rendering.mjs
node tests/ui_review_regressions.mjs

# Run Playwright end-to-end browser tests
npm run test:e2e

# Run ESLint linter
npm run lint

# Run unified PHP test suite
php tests/run_all_tests.php
```

---

## License

No software license file is currently provided. All rights reserved unless otherwise stated by the owner.
