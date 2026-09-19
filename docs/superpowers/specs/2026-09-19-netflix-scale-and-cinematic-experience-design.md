# Technical Specification: KuraStream 2.0 Netflix-Scale & Cinematic Experience

**Date:** 2026-09-19  
**Status:** Approved  
**Author:** Antigravity Team & Senior Frontend Architect  

## 1. Overview & Objectives

This specification defines the visual and functional transformation of **KuraStream** into a premier, Netflix-tier streaming application. The design language shifts from bubbly, rounded cards and constrained layouts to an **expansive, high-contrast, edge-to-edge cinematic aesthetic** characterized by:

1. **Large Scale & Clean Edges:**
   - Container widths expanding to 1600px / 96vw for high-density modern screens.
   - Refined, subtle corner radii of **3px to 4px** (`border-radius: 4px`), eliminating bubbly 12px/20px/pill curves for a sharp, sophisticated appearance.
2. **Billboard Hero:**
   - Full-width cinematic billboard banner with dynamic high-resolution backdrops, vignette gradient masking to jet black (`#08090b`), bold typography, and immediate *"▶ Reproducir"* / *"ℹ Más información"* calls to action.
3. **Continue Watching & Curated Rows:**
   - High-visibility "Seguir viendo" row with integrated progress bars over 16:9 widescreen cards and single-click resume.
   - Horizontal scrolling rows with smooth touch/mouse drag or navigation chevrons.
4. **Immersive Show Details:**
   - Panoramic backdrop header with smart primary action button: *"▶ Continuar Ep. X (min MM:SS)"* if past progress exists, or *"▶ Ver Ep. 1"*.
   - Episode cards formatted in 16:9 with thumbnail, duration, completion badge, and per-episode progress.
5. **Cinematic Player Pro:**
   - **Reactive Ambient Glow (Ambilight mode):** A canvas-based ambient light sampler projecting dynamic color glows onto the player container.
   - **Media Session API:** Native operating system lock screen, notifications, and headset media key integration with HD artwork, title, and timeline controls.
   - **Smart "Next Episode" Overlay:** Countdown card appearing in the last 25 seconds of an episode with thumbnail, 10s timer, instant play, and cancel button.
   - **Universal Keyboard Shortcuts & Mobile Gestures:** Full-fledged desktop hotkeys (Space, F, M, Arrow Keys, N) and mobile double-tap seek (+/-10s).
6. **Profile Identity & Clean Stats:**
   - Refined user statistics dashboard (hours watched, completed shows, favorite genre, active day streak) without gamification pressure.
7. **Progressive Web App (PWA):**
   - Web App Manifest (`manifest.json`) and Service Worker (`sw.js`) enabling native installation on Windows, macOS, Android, and iOS with fast cached shell launch.

---

## 2. Visual Architecture & Design Tokens

### 2.1 Spatial Scale & Radius System
```css
:root {
  /* Scaled Layout */
  --content-max-width: 1600px;
  --header-height: 76px;
  
  /* Netflix Crisp Radii - No bubble/pill roundings */
  --radius-xs: 2px;
  --radius-sm: 4px;   /* Standard card, modal, and button radius */
  --radius-md: 6px;   /* Subtle container radius */
  --radius-pill: 4px; /* Standardize buttons without rounded capsule look */

  /* Jet Black Cinematic Palette */
  --bg-color: #08090b;
  --bg-secondary: #0e1117;
  --surface-card: #141720;
  --surface-hover: #1c212e;
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-focus: rgba(255, 255, 255, 0.22);

  /* Brand Accents */
  --accent-color: #a855f7;
  --accent-glow: rgba(168, 85, 247, 0.28);
  --progress-color: #e50914; /* Cinematic red for watching progress */
}
```

---

## 3. Subsystems & Component Specifications

### 3.1 Billboard Hero Component
* **Dimensions:** Minimum height 65vh (up to 75vh on desktop displays).
* **Backdrop Layer:** Full-bleed image with two gradients:
  * Horizontal vignette: `linear-gradient(to right, rgba(8,9,11,0.95) 0%, rgba(8,9,11,0.6) 45%, transparent 100%)`
  * Bottom vignette: `linear-gradient(to top, #08090b 0%, rgba(8,9,11,0.8) 25%, transparent 65%)`
* **Content:**
  * Title: 2.8rem to 3.5rem font size, bold tracking.
  * Badges: HD / 4K badge, Year, Rating star, Genre tags.
  * Synopsis: Max 3 lines with ellipsis clamp.
  * Action Buttons:
    * Primary: *"▶ Reproducir"* (Solid white background with black text for peak Netflix contrast).
    * Secondary: *"ℹ Más información"* (Glass surface with white text and border).

### 3.2 "Seguir viendo" (Continue Watching) Carousel
* **Data Source:** `/api/history` filtered by `completed = false`.
* **Card Design:**
  * Aspect Ratio: 16:9 widescreen or 2:3 vertical poster with widescreen toggle.
  * Overlay: Floating play icon on hover.
  * Progress Bar: Full-width bar anchored at the bottom edge (`height: 4px`, `--progress-color`, with remaining width in dark grey).
  * Subtext: `T1:E3 • 14 min restantes`.
  * Click Action: Directly opens the player at the saved timestamp.

### 3.3 Cinematic Video Player
* **Ambient Glow Engine:**
  * An offscreen canvas (`64x36`) samples the current video frame every 250ms when ambient mode is active.
  * The sampled image is blurred with `filter: blur(50px) brightness(0.9) saturate(140%)` and rendered behind the video container.
  * Zero noticeable CPU/GPU overhead; automatically paused when video is paused or hidden.
* **Media Session API:**
  * Sets `navigator.mediaSession.metadata` on playback start.
  * Handlers registered for `play`, `pause`, `seekbackward`, `seekforward`, `previoustrack`, `nexttrack`.
* **Countdown Next Episode Card:**
  * Triggered at `video.duration - video.currentTime <= 25`.
  * Renders a non-intrusive card in the bottom-right corner.
  * Displays: "Próximo episodio en 10s...", Episode Title, Thumbnail, button "Ver ahora" and button "✕ Cancelar".

### 3.4 Inmersive Show Detail Page
* **Hero Section:** Expansive backdrop with trailer button and prominent *"Continuar Ep. X"* button.
* **Season Tabs:** Clean horizontal segmented control with 4px border-radius.
* **Episode Grid:**
  * 16:9 cards with duration, episode title, synopsis preview, and a distinct "VISTO" checkmark badge if progress >= 85%.

### 3.5 User Profile & Clean Stats
* **Profile Dashboard:**
  * Total hours watched formatted cleanly (`XX horas`).
  * Total episodes watched & series completed.
  * Top favorite genre.
  * Avatar picker with crisp 4px square/subtle round frames.

### 3.6 PWA Manifest & Service Worker
* **`manifest.json`:**
  * Name: `KuraStream - Cloud Anime Streaming`
  * Short name: `KuraStream`
  * Display: `standalone`
  * Theme color: `#08090b`
  * Background color: `#08090b`
  * Icons: `frontend/assets/branding/` assets with 192x192 and 512x512 sizes.
* **`sw.js`:**
  * Caches static CSS, JS, fonts, and Lucide icons using a cache-first network-fallback strategy.
  * Video streams (`/api/stream/*`) are strictly excluded from caching.

---

## 4. Verification & Testing Strategy
* **Automated PHP/MySQL Test Suite:** Run `php tests/run_all_tests.php` to verify 100% pass rate.
* **PWA & Asset Validation:** Script verification to guarantee valid `manifest.json`, icon paths, and service worker registration.
* **CSS & Layout Audit:** Ensure no broken styles, verify crisp 4px radii, and test responsive scaling across desktop and mobile viewports.
