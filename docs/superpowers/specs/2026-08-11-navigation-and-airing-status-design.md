# Design Specification: User Navigation Overhaul & "En Emisión" Anime Section

**Date:** 2026-08-11  
**Status:** Approved by User  
**Target Component:** Frontend Navigation (`index.html`, `app.js`, `style.css`) & Backend Media Manager (`db.js`, `server.js`, `scan_library.js`, `scraper.js`)

---

## 1. Overview & Goals

KuraStream's anime collection is growing rapidly. Users need intuitive ways to discover and filter titles, quickly identify ongoing/seasonal series, and sort the catalog by release year, rating, title, or recently added items.

### Key Features
1. **Dedicated "En Emisión" Navigation Tab (`#/airing`):**
   - Accessible directly from top header navigation with a live pulsing green indicator (`.badge-airing-pulse`).
   - Displays all active ongoing anime series.
2. **Neon "EN EMISIÓN" Poster Badge:**
   - Visual badge overlays on show cards for airing titles across all grid views.
3. **Interactive Catalog Toolbar (Filters & Sorting):**
   - **Status Filter:** All, En Emisión (Ongoing), Finalizados (Completed).
   - **Genre Filter:** Action, Comedy, Fantasy, Romance, Sci-Fi, Slice of Life, etc.
   - **Sort Options:**
     - Release Year (Newest First / Oldest First)
     - Top Rated (Highest Rating)
     - Alphabetical (A - Z)
     - Recently Added (Created Timestamp)
4. **Hybrid Status Management (Auto + Manual):**
   - **Automatic:** TMDB scraper populates `status` as `'airing'` when `in_production` is `true` or status is `"Returning Series"` / `"In Production"`.
   - **Manual Override:** Admin Panel -> *Editar Multimedia* modal allows forcing status to `'airing'` or `'finished'`.

---

## 2. Technical Architecture & Database Changes

### Database Migration (`backend/db.js`)
Add column `status` to `shows` table safely via `PRAGMA table_info`:
```sql
ALTER TABLE shows ADD COLUMN status TEXT DEFAULT 'finished';
```
Valid values for `status`:
- `'airing'` (En emisión)
- `'finished'` (Finalizado)

### Scraper & Scanner Logic (`backend/scraper.js`, `backend/scan_library.js`)
When querying TMDB details for a show:
- Check `showDetails.in_production` or `showDetails.status`.
- If `in_production === true` or status matches ongoing keywords: `status = 'airing'`.
- Else: `status = 'finished'`.
- Preserve existing manual overrides if explicitly set by admin.

### API Endpoints
- `GET /api/shows?status=airing` -> Returns array of airing shows.
- `PUT /api/shows/:id` and `POST /api/admin/upload-show-media` -> Accepts `status` field in payload and saves to DB.

---

## 3. UI/UX Specifications

### Header Navigation (`frontend/index.html`)
Add tab item:
```html
<a href="#/airing" class="nav-link" id="nav-airing">
  <i data-lucide="radio"></i>
  <span>En Emisión</span>
  <span class="airing-dot"></span>
</a>
```

### Catalog Control Toolbar
Located at top of `#dashboard-view` / `#movies-view` / `#airing-view`:
- Search input
- Status filter dropdown (`Todos`, `En Emisión`, `Finalizados`)
- Genre filter dropdown
- Sort order selector (`Año (Recientes)`, `Año (Antiguos)`, `Mejor Valorados`, `Nombre A-Z`, `Añadidos Recientemente`)

---

## 4. Verification Plan

1. **Database Migration Verification:**
   - Run Node test script verifying `status` column exists without errors on existing databases.
2. **Navigation & Route Testing:**
   - Test clicking `#/airing` in browser subagent, confirming only `airing` titles display with the neon badge.
3. **Filter & Sort Verification:**
   - Verify sorting by year descending/ascending, rating descending, and title A-Z updates the grid instantly without page reload.
4. **Admin Manual Status Toggle:**
   - Toggle status in *Editar Multimedia* modal from `'finished'` to `'airing'` and verify status badge appears immediately on home page.
