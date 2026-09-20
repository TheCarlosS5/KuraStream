# Technical Specification: KuraStream 2.0 Cinematic Pack & Pro Player Experience

**Date:** 2026-09-19  
**Status:** Approved  
**Author:** Antigravity Team & Senior Multimedia Architect  

---

## 1. Overview & Objectives

This specification defines the implementation of the **Cinematic Pack & Pro Player Experience** for **KuraStream 2.0**. Building upon the Netflix jet-black layout and 4px crisp border standards, this upgrade elevates the playback and browsing experience with:

1. **Modern Local Iconography Suite:** Complete offline Lucide Icons v0.400+ bundle with unified 1.75px vector strokes, replacing inconsistent or raw inline SVG icons.
2. **Timeline Seek Scrub Preview (Canvas Engine):** Instant 16:9 thumbnail preview of the video frame at the hovered timestamp on the progress bar, operating with zero server-side pre-processing.
3. **Netflix 2-Column Audio & Subtitles Modal:** Floating frosted glass overlay presenting Audio tracks on the left column and Subtitle options on the right column with live checkmark indicators.
4. **Picture-in-Picture (PiP) Pro:** Native browser PiP integration with synchronization of playback state, hotkeys, and Media Session API.
5. **Playback Speed Quick Pill:** Clean compact speed controller (0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x) with responsive popover.
6. **Netflix Expandable Card Hover Popover:** Debounced (350ms) floating popover on catalog cards featuring backdrop preview, quick play, add to list, details, and metadata tags without breaking horizontal scroll rows.

---

## 2. Architecture & File Structure

The new subsystems are decoupled into dedicated ES6 modules inside `frontend/js/modules/` to maintain clean separation of concerns:

```
frontend/
├── assets/
│   └── icons/                       # Local SVGs for media-specific actions
├── js/
│   └── modules/
│       ├── player_scrub_preview.js  # Canvas seek scrub preview engine & tooltip
│       ├── player_tracks_modal.js   # Netflix-style 2-column audio/subs modal
│       ├── card_popover_preview.js  # Singleton expandable hover popover manager
│       └── party.js                 # Existing Watch Party module
├── vendor/
│   └── lucide/
│       └── lucide.min.js            # Complete modernized offline Lucide bundle
├── app.js                           # Catalogue router & popover event integration
├── player.js                        # Player core consuming scrub, tracks modal & PiP
├── style.css                        # Modern CSS tokens & component styling
└── index.html                       # Base layout & modal containers
```

---

## 3. Subsystem Specifications

### 3.1 Local Modern Iconography Suite
* **Bundle:** Latest Lucide icon suite packaged locally in `frontend/vendor/lucide/lucide.min.js`.
* **Zero Network Dependency:** Operates 100% offline; cached in Service Worker (`kurastream-v2.0`).
* **Consistency:** Standardized `stroke-width: 1.75px; width: 20px; height: 20px; vertical-align: middle;` across all player controls and navigation bars.
* **Key Icons:**
  * Audio & Subtitles: `subtitles`, `message-square`
  * Picture-in-Picture: `picture-in-picture-2`
  * Playback Speed: `gauge`
  * Seek & Skip: `rotate-ccw`, `rotate-cw`, `skip-back`, `skip-forward`
  * Card Actions: `play`, `plus`, `check`, `info`, `heart`

### 3.2 Timeline Seek Scrub Preview (Canvas Scrubbing)
* **File:** `frontend/js/modules/player_scrub_preview.js`
* **Mechanism:**
  * Instantiates a hidden background `<video>` element cloned from the active video source (`preload="auto"`, `muted=true`).
  * On `.progress-bar` `mousemove` (throttled to 50ms):
    * Calculates target time: `t = (x / width) * duration`.
    * Sets clone `video.currentTime = t`.
    * On clone `seeked`, draws video frame into a $160 \times 90$ canvas (16:9).
  * Tooltip `.scrub-preview-tooltip`:
    * Anchored above the progress bar with a pointer caret.
    * Contains the 16:9 canvas frame + timestamp badge (`MM:SS` or `HH:MM:SS`).
    * Constrained to viewport bounds (`Math.max(10, Math.min(x - halfWidth, maxRight))`).
  * On `.progress-bar` `mouseleave`: tooltip fades out smoothly.

### 3.3 Netflix 2-Column Audio & Subtitles Modal
* **File:** `frontend/js/modules/player_tracks_modal.js`
* **Visual Presentation:**
  * Jet-black frosted glass dialog (`rgba(11, 15, 20, 0.96)`, `backdrop-filter: blur(20px)`, `border-radius: 4px`, `border: 1px solid rgba(255,255,255,0.12)`).
  * Centered or aligned bottom-right above the controls bar with dimensions $480\text{px} \times 320\text{px}$.
* **Layout:**
  * Left Column: **Audio**
    * Lists all audio tracks parsed from media metadata.
    * Highlights active track with `✓` and `--accent-color`.
    * Clicking changes active track immediately.
  * Right Column: **Subtítulos**
    * Option: `Desactivados`.
    * Lists all embedded and external subtitle streams (`.ass`, `.srt`, `.vtt`).
    * Highlights active track with `✓`.
    * Dispatches track change to `SubtitlesOctopus` or native text tracks.
* **Triggers:** Button in control bar (`title="Audio y Subtítulos"`), hotkey `KeyS`, or mobile controls menu.
* **Dismissal:** Click outside, close button `✕`, or `Escape` key.

### 3.4 Picture-in-Picture (PiP) Pro
* **Integration:**
  * In `frontend/player.js`, integrates `HTMLVideoElement.requestPictureInPicture()`.
  * Verifies `document.pictureInPictureEnabled`.
  * Control button `#player-pip-btn` with `data-lucide="picture-in-picture-2"`.
* **State Management:**
  * Listens to `enterpictureinpicture` and `leavepictureinpicture`.
  * Reflects active state on button (`classList.toggle('active')`).
  * Updates Media Session API action handlers so system PiP window play/pause/seek controls update KuraStream state.

### 3.5 Playback Speed Quick Pill & Popover
* **Speeds:** `0.5x`, `0.75x`, `1x` (normal), `1.25x`, `1.5x`, `2x`.
* **UI:** Compact badge button `#player-speed-btn` showing current speed (e.g. `1x`).
* **Popover:** Sleek floating menu with 4px border-radius and active checkmark.

### 3.6 Netflix Expandable Card Hover Popover
* **File:** `frontend/js/modules/card_popover_preview.js`
* **Interaction:**
  * Hovering any `.show-card` for $\ge 350\text{ms}$ creates/repositions a floating popover directly over the hovered card.
  * Scales to $1.15\times$ with smooth transition (`cubic-bezier(0.16, 1, 0.3, 1)`), elevated with deep shadow (`0 20px 48px rgba(0,0,0,0.85)`).
  * Displays:
    * 16:9 thumbnail header with dual vignette.
    * Primary CTA: `▶ Reproducir` button (opens player).
    * Secondary CTA: `+ Mi lista` / `✓ En mi lista` (toggles favorite).
    * Tertiary CTA: `ℹ Detalles` (navigates to `#show/{id}`).
    * Metadata row: Rating star, year, status badge, episode count.
    * Genre chips (max 3).
  * Automatically repositions if close to left/right screen edges to avoid overflow.
  * Collapses cleanly on `mouseleave` with a small grace period (200ms).

---

## 4. Quality & Testing Strategy

1. **Automated PHP UI & Module Verification:**
   * Script `tests/test_cinematic_pack.php` verifying:
     - Module files exist and export expected functions.
     - CSS classes exist with crisp 4px border radii and Netflix tokens.
     - HTML structure contains audio/subtitles button, PiP button, and scrub tooltip container.
2. **Full Regression Suite:**
   * Run `npm test` verifying all 16 test suites pass with 0 regressions.
3. **Linter Compliance:**
   * Run `npm run lint` verifying 0 ESLint errors.
