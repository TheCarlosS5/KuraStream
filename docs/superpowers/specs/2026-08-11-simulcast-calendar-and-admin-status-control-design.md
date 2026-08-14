# Design Specification: Simulcast Anime Calendar & Admin Status Control

**Date:** 2026-08-11  
**Status:** Approved by User  
**Target Components:** 
- Frontend: `index.html`, `app.js`, `style.css` (Calendar view `#/calendar`, Day selector tabs, Admin Library Toggle Buttons)
- Backend: `server.js`, `db.js`, `anime_calendar.js` (AniList API proxy + 6h cache service)

---

## 1. Overview & Goals

1. **Weekly Simulcast Anime Calendar (`#/calendar`):**
   - Interactive day picker (Lunes - Domingo).
   - Fetches live weekly anime schedule from AniList GraphQL API (`https://graphql.anilist.co`).
   - Caches responses in backend memory for 6 hours to ensure instantaneous page loads.
   - Automatically cross-references AniList titles with the local KuraStream library to highlight animes already owned with a **"¡EN TU BIBLIOTECA!"** badge and a *"Ver en KuraStream"* button.

2. **Admin Status Control Switches:**
   - Add a 1-click status toggle button (`[ ● En Emisión ]` / `[ Finalizado ]`) on each show item in Admin Panel -> *Biblioteca*.
   - Include a Status select dropdown inside the *Editar Multimedia* modal.

---

## 2. Technical Architecture & Endpoints

### Backend Schedule Service (`backend/anime_calendar.js`)
Queries AniList GraphQL API:
```graphql
query ($airingAt_greater: Int, $airingAt_lesser: Int) {
  Page(page: 1, perPage: 50) {
    airingSchedules(airingAt_greater: $airingAt_greater, airingAt_lesser: $airingAt_lesser, sort: TIME) {
      id
      airingAt
      timeUntilAiring
      episode
      media {
        id
        title { romaji english native }
        coverImage { extraLarge large }
        bannerImage
        genres
        studios(isMain: true) { nodes { name } }
      }
    }
  }
}
```
Cache TTL: 6 hours.

### API Endpoints (`backend/server.js`)
- `GET /api/calendar/schedule` -> Returns grouped weekly schedule with `in_library: boolean` flag for matched shows.
- `POST /api/admin/toggle-show-status` -> Payload: `{ showId, status }`. Updates SQLite DB instantly.

---

## 3. UI/UX Specifications

### Navigation Header
Add "Calendario" link to header:
```html
<a href="#/calendar" class="nav-link" id="nav-calendar">
  <i data-lucide="calendar"></i>
  <span>Calendario</span>
</a>
```

### Calendar View (`#/calendar`)
- Day Tabs: `Lunes`, `Martes`, `Miércoles`, `Jueves`, `Viernes`, `Sábado`, `Domingo`.
- Cards Grid displaying upcoming episodes, countdown timer, poster, studio, and library status.

### Admin Library View
Next to each show in Admin -> *Biblioteca*, render:
```html
<button class="btn btn-sm btn-status-toggle" data-status="${show.status}">
  ${show.status === 'airing' ? '● En Emisión' : 'Finalizado'}
</button>
```

---

## 4. Verification Plan

1. **AniList API Fetch & Cache Verification:**
   - Run backend test script confirming `/api/calendar/schedule` returns structured weekly schedule.
2. **Calendar UI & Library Matching:**
   - Open `#/calendar` in browser and confirm day tabs filter properly and matched shows display the "EN TU BIBLIOTECA" badge.
3. **Admin 1-Click Status Toggle:**
   - Toggle an anime status in Admin Panel -> *Biblioteca* and verify it updates in DB and reflects on home page without reloading.
