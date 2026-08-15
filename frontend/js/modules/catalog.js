/**
 * KuraStream - Public Catalog Module
 * Handles homepage grid, show details, voice cast/staff, comments, and episode playback.
 */

import { getAuthHeaders } from './auth.js';

export async function loadShowsCatalog() {
  const container = document.getElementById('shows-grid');
  if (!container) return;

  try {
    const res = await fetch('/api/shows');
    const shows = await res.json();

    if (!Array.isArray(shows) || shows.length === 0) {
      container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
        <i data-lucide="tv" style="width: 48px; height: 48px; margin-bottom: 12px;"></i>
        <h3>No hay contenido disponible todavía</h3>
        <p>Utiliza el panel de administración para importar tus primeros animes o películas.</p>
      </div>`;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    container.innerHTML = shows.map(show => `
      <div class="show-card" onclick="location.hash='#/show/${show.id}'" style="cursor: pointer;">
        <div class="show-poster-wrap">
          <img src="${show.poster_path || '/api/placeholder-poster'}" class="show-poster" alt="${show.title}" onerror="this.src='/api/placeholder-poster'">
          <div class="show-badge">${show.media_type === 'movie' ? 'Película' : 'Anime'}</div>
          <div class="show-rating">★ ${show.rating ? show.rating.toFixed(1) : 'N/A'}</div>
        </div>
        <div class="show-info">
          <h3 class="show-title" title="${show.title}">${show.title}</h3>
          <small class="show-meta">${show.year || '2026'} · ${show.age_rating || 'TV-14'}</small>
        </div>
      </div>
    `).join('');

    if (window.lucide) window.lucide.createIcons({ root: container });
  } catch (err) {
    console.error('[Catalog] Error loading shows:', err);
    container.innerHTML = `<p style="color: #ff5555; grid-column: 1/-1;">Error al cargar el catálogo de contenido.</p>`;
  }
}

export async function loadShowDetail(showId) {
  const container = document.getElementById('show-detail-container');
  if (!container || !showId) return;

  try {
    const res = await fetch(`/api/shows/${showId}`);
    if (!res.ok) {
      container.innerHTML = `<div style="text-align: center; padding: 60px; color: #ff5555;">
        <h2>Anime no encontrado</h2>
        <button type="button" class="btn btn-primary" onclick="location.hash='#/'">Volver al Inicio</button>
      </div>`;
      return;
    }

    const show = await res.json();
    let castArray = [];
    try {
      castArray = typeof show.cast_members === 'string' ? JSON.parse(show.cast_members) : (show.cast_members || []);
    } catch(e) {}

    const episodes = show.episodes || [];

    container.innerHTML = `
      <div class="show-detail-hero" style="background-image: linear-gradient(to bottom, rgba(15,23,42,0.4), var(--bg-color)), url('${show.backdrop_path || show.poster_path || ''}');">
        <div class="show-detail-content">
          <img src="${show.poster_path || '/api/placeholder-poster'}" class="show-detail-poster" alt="${show.title}" onerror="this.src='/api/placeholder-poster'">
          <div class="show-detail-main">
            <h1 class="show-detail-title">${show.title}</h1>
            <div class="show-detail-badges">
              <span class="badge badge-accent">${show.media_type === 'movie' ? 'Película' : 'Anime'}</span>
              <span class="badge">${show.year || '2026'}</span>
              <span class="badge">${show.age_rating || 'TV-14'}</span>
              <span class="badge badge-rating">★ ${show.rating ? show.rating.toFixed(1) : '8.5'}</span>
            </div>
            <p class="show-detail-synopsis">${show.synopsis || 'Sin descripción disponible para esta serie.'}</p>
          </div>
        </div>
      </div>

      <div class="show-detail-body" style="max-width: 1200px; margin: 0 auto; padding: 20px;">
        <h2 style="font-family: var(--font-title); margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
          <i data-lucide="play-circle" style="color: var(--accent-color);"></i> Capítulos (${episodes.length})
        </h2>
        <div class="episodes-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-bottom: 40px;">
          ${episodes.length === 0 ? '<p style="color: var(--text-muted);">No hay capítulos agregados aún.</p>' : episodes.map(ep => `
            <div class="episode-card" onclick="window.playVideoEpisode('${show.id}', '${ep.season_number}', '${ep.episode_number}')" style="cursor: pointer; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 12px; transition: transform 0.2s;">
              <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-main); margin-bottom: 4px;">Capítulo ${ep.episode_number}: ${ep.title || `Capítulo ${ep.episode_number}`}</div>
              <small style="color: var(--text-muted); font-size: 0.78rem;">Temporada ${ep.season_number} · ${ep.duration ? Math.round(ep.duration / 60) + ' min' : '24 min'}</small>
            </div>
          `).join('')}
        </div>

        <!-- Secciones de Staff y Reparto abajo del todo -->
        ${(show.studio || show.director || show.writer || castArray.length > 0) ? `
          <div style="border-top: 1px solid var(--border-color); padding-top: 30px; margin-top: 30px;">
            <h3 style="font-family: var(--font-title); font-size: 1.1rem; margin-bottom: 15px; color: var(--text-muted);">Información de Producción y Autores</h3>
            <div style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 20px; font-size: 0.88rem;">
              ${show.studio ? `<div><strong style="color: var(--text-muted);">Estudio:</strong> ${show.studio}</div>` : ''}
              ${show.director ? `<div><strong style="color: var(--text-muted);">Director:</strong> ${show.director}</div>` : ''}
              ${show.writer ? `<div><strong style="color: var(--text-muted);">Guionista:</strong> ${show.writer}</div>` : ''}
            </div>

            ${castArray.length > 0 ? `
              <h4 style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 10px;">Reparto de Voces:</h4>
              <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                ${castArray.map(c => `<span class="badge" style="background: rgba(255,255,255,0.06); color: var(--text-main); font-weight: 500;">${c.character ? `${c.character} (${c.name || c.actor || 'Actor'})` : (c.name || c.actor || c)}</span>`).join('')}
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;

    if (window.lucide) window.lucide.createIcons({ root: container });
  } catch (err) {
    console.error('[Catalog] Detail load error:', err);
  }
}

if (typeof window !== 'undefined') {
  window.playVideoEpisode = function(showId, season, episode) {
    if (window.initPlayerOverlay) {
      window.initPlayerOverlay(showId, season, episode);
    } else {
      alert(`Reproduciendo Show ${showId} S${season}E${episode}`);
    }
  };
}
