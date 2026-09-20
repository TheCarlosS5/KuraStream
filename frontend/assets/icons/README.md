# KuraStream Offline Iconography Suite

## Overview
KuraStream uses an offline-first iconography system powered by Lucide Icons stored locally at `frontend/vendor/lucide/lucide.min.js`.
No external CDNs or network connections are needed to render sharp, crisp vector icons.

## Style Guidelines
- **Stroke Width**: `1.75px` across all UI buttons and badges for consistent optical weight.
- **Coloring**: Icons inherit color via `currentColor` or respect theme variables (`var(--accent-color)`, `var(--text-muted)`).
- **Corner Radii**: Containers use strict `4px` radii (`border-radius: 4px;`) matching the cinematic Netflix aesthetic.

## Available Icons & Usages
- **Playback Controls**:
  - `play` / `pause`: Main playback toggle
  - `skip-back` / `skip-forward`: 10s scrub / episode navigation
  - `volume-2` / `volume-x`: Audio level and mute
  - `maximize` / `minimize`: Fullscreen toggle
- **Pro Player Features**:
  - `subtitles`: Netflix-style 2-column Audio & Subtitles modal
  - `picture-in-picture-2`: Native browser Picture-in-Picture mode
  - `gauge`: Playback speed selector pill
- **Catalog & Navigation**:
  - `sparkles`: AI / TMDB metadata and recommendations
  - `plus` / `check`: My List favorite toggling
  - `info`: Episode and show detailed metadata
  - `calendar`: Simulcast release calendar
  - `search`: Instant search dialog

## Offline Initialization
Icons are instantiated in vanilla JavaScript via:
```javascript
if (window.lucide && typeof window.lucide.createIcons === 'function') {
  window.lucide.createIcons();
}
```
