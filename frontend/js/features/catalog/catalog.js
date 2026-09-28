/**
 * KuraStream v2.0 - Catalog Feature Module
 * Cinematic Billboard Hero, Continue Watching, Media Rails & Filter System.
 */

import { api } from '../../core/api.js';
import { appState } from '../../core/state.js';
import { escapeHtml, escapeHtmlAttribute } from '../../core/ui.js';

export function createShowCardHTML(show) {
  const ratingText = show.rating ? show.rating.toFixed(1) : '';
  const posterUrl = show.cover_image || show.poster_image || '/api/placeholder-poster';

  return `
    <article class="show-card" data-show-id="${escapeHtmlAttribute(String(show.id))}" tabindex="0" role="button" aria-label="${escapeHtmlAttribute(show.title)}">
      <img class="show-card-poster" src="${escapeHtmlAttribute(posterUrl)}" alt="${escapeHtmlAttribute(show.title)}" loading="lazy" />
      <div class="show-card-info">
        <h4 class="show-card-title">${escapeHtml(show.title)}</h4>
        <div class="show-card-meta">
          <span class="badge ${show.status === 'airing' ? 'badge-airing' : ''}">${show.status === 'airing' ? 'En Emisión' : (show.status === 'upcoming' ? 'En Espera' : 'Finalizado')}</span>
          ${ratingText ? `<span class="badge-rating"><i data-lucide="star" style="width:10px;height:10px;fill:var(--rating-color);stroke:var(--rating-color);display:inline-block;vertical-align:middle;"></i> ${escapeHtml(ratingText)}</span>` : ''}
        </div>
      </div>
    </article>
  `;
}

export function renderBillboardHero(show) {
  if (!show) return '';
  const backdrop = show.backdrop_image || show.banner_image || show.cover_image || '';
  const synopsis = show.synopsis || show.description || '';
  const ratingText = show.rating ? show.rating.toFixed(1) : '';

  return `
    <div class="billboard-hero" style="background-image: url('${escapeHtmlAttribute(backdrop)}');">
      <div class="billboard-vignette"></div>
      <div class="billboard-content">
        <h1 class="billboard-title">${escapeHtml(show.title)}</h1>
        <div class="billboard-meta">
          ${ratingText ? `<span class="badge-rating"><i data-lucide="star" style="width:12px;height:12px;fill:var(--rating-color);stroke:var(--rating-color);display:inline-block;vertical-align:middle;margin-right:2px;"></i> ${escapeHtml(ratingText)}</span>` : ''}
          ${show.year ? `<span class="badge">${escapeHtml(String(show.year))}</span>` : ''}
          <span class="badge ${show.status === 'airing' ? 'badge-airing' : ''}">${show.status === 'airing' ? 'En Emisión' : 'Finalizado'}</span>
        </div>
        ${synopsis ? `<p class="billboard-synopsis">${escapeHtml(synopsis)}</p>` : ''}
        <div class="billboard-actions">
          <button class="btn btn-primary btn-billboard-play" data-action="play-hero" data-show-id="${escapeHtmlAttribute(String(show.id))}">
            <i data-lucide="play" style="width: 18px; height: 18px; fill: currentColor;"></i> Reproducir
          </button>
          <button class="btn btn-secondary btn-billboard-info" data-action="info-hero" data-show-id="${escapeHtmlAttribute(String(show.id))}">
            <i data-lucide="info" style="width: 18px; height: 18px;"></i> Más información
          </button>
        </div>
      </div>
    </div>
  `;
}

export function renderContinueWatching(items) {
  if (!items || items.length === 0) return '';

  const seenShows = new Set();
  const groupedItems = [];
  for (const item of items) {
    const key = String(item.show_id || item.show_title || item.episode_id);
    if (!seenShows.has(key)) {
      seenShows.add(key);
      groupedItems.push(item);
    }
  }

  const cardsHtml = groupedItems.map(item => {
    const progressPct = item.duration > 0 ? Math.min(100, Math.round((item.current_time / item.duration) * 100)) : 0;
    const thumb = item.episode_thumbnail || item.show_backdrop || item.show_cover || '';

    return `
      <div class="continue-watching-card" data-show-id="${escapeHtmlAttribute(String(item.show_id))}" data-episode-id="${escapeHtmlAttribute(String(item.episode_id))}" tabindex="0" role="button" aria-label="Continuar viendo ${escapeHtmlAttribute(item.show_title || '')}">
        <div class="continue-watching-thumb-wrap">
          <img class="continue-watching-thumb" src="${escapeHtmlAttribute(thumb)}" alt="${escapeHtmlAttribute(item.episode_title || '')}" loading="lazy" />
          <div class="continue-watching-progress">
            <div class="continue-watching-progress-bar" style="width: ${progressPct}%;"></div>
          </div>
        </div>
        <div class="continue-watching-info">
          <div class="continue-watching-title">${escapeHtml(item.show_title || '')}</div>
          <div class="continue-watching-sub">Episodio ${escapeHtml(String(item.episode_number || 1))} &bull; ${progressPct}% completado</div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <section class="catalog-section continue-watching">
      <div class="section-header">
        <h2 class="section-title">Continuar viendo</h2>
      </div>
      <div class="media-rail">
        ${cardsHtml}
      </div>
    </section>
  `;
}

export async function loadCatalogData() {
  try {
    const res = await api.get('/api/shows');
    const shows = res.data && res.data.shows ? res.data.shows : (Array.isArray(res.data) ? res.data : []);
    appState.set('catalog', shows);

    // Continue watching
    let continueItems = [];
    try {
      const histRes = await api.get('/api/user/continue-watching');
      continueItems = histRes.data && histRes.data.items ? histRes.data.items : [];
    } catch {}
    appState.set('continueWatching', continueItems);

    return { shows, continueWatching: continueItems };
  } catch (err) {
    console.error('[Catalog] Error fetching shows catalog:', err);
    return { shows: [], continueWatching: [] };
  }
}

export function attachCatalogEventListeners(container) {
  if (!container) return;

  // Delegate card clicks
  container.addEventListener('click', (e) => {
    const playHeroBtn = e.target.closest('[data-action="play-hero"]');
    if (playHeroBtn) {
      const showId = playHeroBtn.getAttribute('data-show-id');
      if (showId) window.location.hash = `#/show/${encodeURIComponent(showId)}`;
      return;
    }

    const infoHeroBtn = e.target.closest('[data-action="info-hero"]');
    if (infoHeroBtn) {
      const showId = infoHeroBtn.getAttribute('data-show-id');
      if (showId) window.location.hash = `#/show/${encodeURIComponent(showId)}`;
      return;
    }

    const contCard = e.target.closest('.continue-watching-card');
    if (contCard) {
      const epId = contCard.getAttribute('data-episode-id');
      const showId = contCard.getAttribute('data-show-id');
      if (epId) {
        window.location.hash = `#/player/${encodeURIComponent(epId)}`;
      } else if (showId) {
        window.location.hash = `#/show/${encodeURIComponent(showId)}`;
      }
      return;
    }

    const showCard = e.target.closest('.show-card');
    if (showCard) {
      const showId = showCard.getAttribute('data-show-id');
      if (showId) {
        window.location.hash = `#/show/${encodeURIComponent(showId)}`;
      }
    }
  });

  // Keyboard navigation
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const card = e.target.closest('.show-card, .continue-watching-card');
      if (card) {
        e.preventDefault();
        card.click();
      }
    }
  });
}
