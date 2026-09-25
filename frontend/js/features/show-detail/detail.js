/**
 * KuraStream v2.0 - Show Details Feature Module
 * Hero backdrop, Smart Resume CTA, Season selector tabs, and 16:9 Episode List.
 */

import { api } from '../../core/api.js';
import { escapeHtml, escapeHtmlAttribute, renderIcons } from '../../core/ui.js';

export function renderEpisodeList(episodes) {
  if (!episodes || episodes.length === 0) {
    return '<p style="color: var(--text-muted); padding: var(--space-4);">No hay episodios disponibles para esta temporada.</p>';
  }

  return episodes.map(ep => {
    const isWatched = ep.progress_pct >= 90 || ep.is_watched;
    const progressPct = Math.min(100, Math.round(ep.progress_pct || 0));
    const thumb = ep.thumbnail || '/api/placeholder-poster';

    return `
      <div class="episode-item" data-episode-id="${escapeHtmlAttribute(String(ep.id))}" tabindex="0" role="button" aria-label="Reproducir Episodio ${escapeHtmlAttribute(String(ep.episode_number))}: ${escapeHtmlAttribute(ep.title || '')}">
        <div class="episode-thumb-wrapper">
          <img class="episode-thumb" src="${escapeHtmlAttribute(thumb)}" alt="Miniatura ${escapeHtmlAttribute(String(ep.episode_number))}" loading="lazy" />
          ${progressPct > 0 && !isWatched ? `
            <div class="episode-progress-bar" style="position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: rgba(0,0,0,0.6);">
              <div class="episode-progress-fill" style="width: ${progressPct}%; height: 100%; background: var(--progress-color);"></div>
            </div>
          ` : ''}
          ${isWatched ? '<span class="badge badge-visto" style="position: absolute; top: 8px; right: 8px;">VISTO</span>' : ''}
        </div>
        <div class="episode-info">
          <h4 class="episode-title">Ep. ${escapeHtml(String(ep.episode_number))}: ${escapeHtml(ep.title || 'Episodio ' + ep.episode_number)}</h4>
          <div class="episode-meta">
            ${ep.duration_formatted ? `<span>${escapeHtml(ep.duration_formatted)}</span>` : ''}
            ${ep.resolution ? `<span>${escapeHtml(ep.resolution)}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

export function renderShowDetailHTML(show) {
  const backdrop = show.backdrop_image || show.cover_image || '';
  const synopsis = show.synopsis || show.description || 'Sin sinopsis disponible.';
  const ratingText = show.rating ? show.rating.toFixed(1) : '';

  // Calculate Smart Resume episode
  const episodes = show.episodes || [];
  let resumeEp = episodes.find(e => (e.progress_pct > 0 && e.progress_pct < 90)) || episodes[0];
  const resumeBtnText = resumeEp && resumeEp.progress_pct > 0 ? `Continuar Ep. ${resumeEp.episode_number}` : 'Ver Episodio 1';
  const resumeEpId = resumeEp ? resumeEp.id : '';

  return `
    <div class="show-detail-container">
      <div class="detail-hero" style="background-image: url('${escapeHtmlAttribute(backdrop)}');">
        <div class="detail-hero-vignette"></div>
        <div class="detail-hero-content">
          <button class="btn btn-secondary btn-back-catalog" data-action="back-catalog" style="margin-bottom: var(--space-4);">
            <i data-lucide="arrow-left" style="width: 16px; height: 16px;"></i> Volver
          </button>
          <h1 class="detail-title">${escapeHtml(show.title)}</h1>
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
            ${ratingText ? `<span class="badge-rating"><i data-lucide="star" style="width:12px;height:12px;fill:var(--rating-color);stroke:var(--rating-color);display:inline-block;vertical-align:middle;"></i> ${escapeHtml(ratingText)}</span>` : ''}
            ${show.year ? `<span class="badge">${escapeHtml(String(show.year))}</span>` : ''}
            <span class="badge ${show.status === 'airing' ? 'badge-airing' : ''}">${show.status === 'airing' ? 'En Emisión' : 'Finalizado'}</span>
            ${show.episodes ? `<span class="badge">${escapeHtml(String(show.episodes.length))} Episodios</span>` : ''}
          </div>
          <p style="font-size: 0.95rem; line-height: 1.6; color: var(--text-secondary); margin-bottom: 24px; max-width: 680px;">${escapeHtml(synopsis)}</p>
          <div style="display: flex; align-items: center; gap: 12px;">
            <button class="btn btn-primary detail-smart-resume-btn" data-action="resume-episode" data-episode-id="${escapeHtmlAttribute(String(resumeEpId))}">
              <i data-lucide="play" style="width: 18px; height: 18px; fill: currentColor;"></i> ${escapeHtml(resumeBtnText)}
            </button>
            <button class="btn btn-secondary btn-toggle-favorite" data-action="toggle-fav" data-show-id="${escapeHtmlAttribute(String(show.id))}">
              <i data-lucide="bookmark" style="width: 18px; height: 18px;"></i> Mi Lista
            </button>
          </div>
        </div>
      </div>

      <!-- Episodes Section -->
      <section style="margin-top: 32px;">
        <h2 style="font-size: 1.4rem; font-weight: 700; margin-bottom: 16px;">Episodios</h2>
        <div class="episodes-grid" id="detail-episodes-grid">
          ${renderEpisodeList(episodes)}
        </div>
      </section>
    </div>
  `;
}

export async function loadAndRenderShowDetail(showId, container) {
  if (!container) return;
  try {
    const res = await api.get(`/api/shows/${showId}`);
    const show = res.data && res.data.show ? res.data.show : res.data;
    container.innerHTML = renderShowDetailHTML(show);
    renderIcons(container);

    // Attach listeners
    container.onclick = (e) => {
      const backBtn = e.target.closest('[data-action="back-catalog"]');
      if (backBtn) {
        window.location.hash = '#/';
        return;
      }

      const resumeBtn = e.target.closest('[data-action="resume-episode"]');
      if (resumeBtn) {
        const epId = resumeBtn.getAttribute('data-episode-id');
        if (typeof window.playEpisode === 'function' && epId) {
          window.playEpisode(epId);
        }
        return;
      }

      const epItem = e.target.closest('.episode-item');
      if (epItem) {
        const epId = epItem.getAttribute('data-episode-id');
        if (typeof window.playEpisode === 'function' && epId) {
          window.playEpisode(epId);
        }
      }
    };
  } catch (err) {
    console.error('[ShowDetail] Error loading show details:', err);
    container.innerHTML = `<div class="container" style="padding: 40px; text-align: center;"><p style="color: var(--danger-color);">Error al cargar los detalles del anime.</p><button class="btn btn-secondary" onclick="window.location.hash='#/'">Volver al catálogo</button></div>`;
  }
}
