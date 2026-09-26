/**
 * KuraStream - Public Catalog Module
 * Safe catalog and show detail rendering with robust escaping and no fabricated metadata.
 */

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeHtmlAttribute(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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

    container.innerHTML = shows.map(show => {
      const showId = encodeURIComponent(show.id || '');
      const rating = (show.rating && Number(show.rating) > 0) ? Number(show.rating).toFixed(1) : 'N/A';
      const year = show.year ? escapeHtml(String(show.year)) : 'N/A';
      const ageRating = show.age_rating ? escapeHtml(show.age_rating) : 'TV-14';
      const poster = show.poster_path ? escapeHtmlAttribute(show.poster_path) : '/api/placeholder-poster';
      const title = escapeHtml(show.title || 'Sin título');

      return `
        <div class="show-card" onclick="location.hash='#/show/${showId}'" style="cursor: pointer;">
          <div class="show-poster-wrap">
            <img src="${poster}" class="show-poster" alt="${title}" onerror="this.src='/api/placeholder-poster'">
            <div class="show-badge">${show.media_type === 'movie' ? 'Película' : 'Anime'}</div>
            <div class="show-rating">${rating !== 'N/A' ? `<i data-lucide="star" style="width: 12px; height: 12px; display: inline-block;"></i> ${rating}` : 'N/A'}</div>
          </div>
          <div class="show-info">
            <h3 class="show-title" title="${title}">${title}</h3>
            <small class="show-meta">${year} · ${ageRating}</small>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons({ root: container });
  } catch (err) {
    console.error('[Catalog] Error loading shows:', err);
    container.innerHTML = `<p style="color: var(--danger-color, #fb7185); grid-column: 1/-1;">Error al cargar el catálogo de contenido.</p>`;
  }
}

export async function loadShowDetail(showId) {
  const container = document.getElementById('show-detail-container');
  if (!container || !showId) return;

  try {
    const res = await fetch(`/api/shows/${encodeURIComponent(showId)}`);
    if (!res.ok) {
      container.innerHTML = `<div style="text-align: center; padding: 60px; color: var(--danger-color, #fb7185);">
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
    const rating = (show.rating && Number(show.rating) > 0) ? Number(show.rating).toFixed(1) : 'N/A';
    const year = show.year ? escapeHtml(String(show.year)) : 'N/A';
    const ageRating = show.age_rating ? escapeHtml(show.age_rating) : 'TV-14';
    const title = escapeHtml(show.title || 'Sin título');
    const synopsis = escapeHtml(show.synopsis || 'Sin descripción disponible para esta serie.');
    const poster = show.poster_path ? escapeHtmlAttribute(show.poster_path) : '/api/placeholder-poster';
    const backdrop = show.backdrop_path ? escapeHtmlAttribute(show.backdrop_path) : poster;

    container.innerHTML = `
      <div class="show-detail-hero" style="background-image: linear-gradient(to bottom, rgba(15,23,42,0.4), var(--bg-color)), url('${backdrop}');">
        <div class="show-detail-content">
          <img src="${poster}" class="show-detail-poster" alt="${title}" onerror="this.src='/api/placeholder-poster'">
          <div class="show-detail-main">
            <h1 class="show-detail-title">${title}</h1>
            <div class="show-detail-badges">
              <span class="badge badge-accent">${show.media_type === 'movie' ? 'Película' : 'Anime'}</span>
              <span class="badge ${show.status === 'airing' ? 'badge-status-airing' : (show.status === 'upcoming' ? 'badge-status-upcoming' : 'badge-status-finished')}">
                ${show.status === 'airing' ? 'En Emisión' : (show.status === 'upcoming' ? 'En Espera (Próx. Temp.)' : 'Finalizado')}
              </span>
              <span class="badge">${year}</span>
              <span class="badge">${ageRating}</span>
              ${rating !== 'N/A' ? `<span class="badge badge-rating"><i data-lucide="star" style="width: 12px; height: 12px; display: inline-block;"></i> ${rating}</span>` : ''}
            </div>
            <p class="show-detail-synopsis">${synopsis}</p>
          </div>
        </div>
      </div>

      <div class="show-detail-body" style="max-width: 1200px; margin: 0 auto; padding: 20px;">
        <h2 style="font-family: var(--font-title); margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
          <i data-lucide="play-circle" style="color: var(--accent-color);"></i> Capítulos (${episodes.length})
        </h2>
        <div class="episodes-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-bottom: 40px;">
          ${episodes.length === 0 ? '<p style="color: var(--text-muted);">No hay capítulos agregados aún.</p>' : episodes.map(ep => {
            const epNum = escapeHtml(String(ep.episode_number || 1));
            const epSeason = escapeHtml(String(ep.season_number || 1));
            const epTitle = escapeHtml(ep.title || `Capítulo ${ep.episode_number}`);
            const durationText = ep.duration ? `${Math.round(ep.duration / 60)} min` : 'N/A';
            const epId = encodeURIComponent(ep.id || `${show.id}_S${ep.season_number}_E${ep.episode_number}`);

            return `
              <div class="episode-card" onclick="location.hash='#/player/${epId}'" style="cursor: pointer; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 12px; transition: transform 0.2s;">
                <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-main); margin-bottom: 4px;">Capítulo ${epNum}: ${epTitle}</div>
                <small style="color: var(--text-muted); font-size: 0.78rem;">Temporada ${epSeason} · ${durationText}</small>
              </div>
            `;
          }).join('')}
        </div>

        ${(show.studio || show.director || show.writer || castArray.length > 0) ? `
          <div style="border-top: 1px solid var(--border-color); padding-top: 30px; margin-top: 30px;">
            <h3 style="font-family: var(--font-title); font-size: 1.1rem; margin-bottom: 15px; color: var(--text-muted);">Información de Producción y Autores</h3>
            <div style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 20px; font-size: 0.88rem;">
              ${show.studio ? `<div><strong style="color: var(--text-muted);">Estudio:</strong> ${escapeHtml(show.studio)}</div>` : ''}
              ${show.director ? `<div><strong style="color: var(--text-muted);">Director:</strong> ${escapeHtml(show.director)}</div>` : ''}
              ${show.writer ? `<div><strong style="color: var(--text-muted);">Guionista:</strong> ${escapeHtml(show.writer)}</div>` : ''}
            </div>

            ${castArray.length > 0 ? `
              <h4 style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 10px;">Reparto de Voces:</h4>
              <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                ${castArray.map(c => {
                  const charText = c.character ? `${escapeHtml(c.character)} (${escapeHtml(c.name || c.actor || 'Actor')})` : escapeHtml(c.name || c.actor || c);
                  return `<span class="badge" style="background: rgba(255,255,255,0.06); color: var(--text-main); font-weight: 500;">${charText}</span>`;
                }).join('')}
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
