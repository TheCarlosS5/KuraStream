/**
 * KuraStream 2.0 - Netflix-Grade Expandable Card Hover Popover Module
 *
 * Provides a floating singleton hover preview that expands on hover over catalogue cards (.show-card),
 * rendering 16:9 banner art, metadata badges, synopsis, and action buttons without clipping
 * inside horizontal carousel containers or viewport boundaries.
 */

// Singleton reference and state
let singletonPopover = null;
let styleElement = null;
let activeInstance = null;

/**
 * Escapes HTML characters to prevent XSS injection.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Ensures required popover styles are injected into document.head.
 */
function ensurePopoverStyles() {
  if (document.getElementById('card-popover-preview-styles')) {
    styleElement = document.getElementById('card-popover-preview-styles');
    return;
  }

  const css = `
    .popover-card-preview {
      position: absolute;
      top: 0;
      left: 0;
      width: 320px;
      background-color: #131A1C;
      border-radius: 4px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #ffffff;
      overflow: hidden;
      z-index: 99999;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: scale(0.95);
      transform-origin: center center;
      transition: opacity 0.22s cubic-bezier(0.2, 0, 0.2, 1),
                  transform 0.22s cubic-bezier(0.2, 0, 0.2, 1),
                  visibility 0.22s;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    .popover-card-preview.is-visible {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: scale(1.15);
    }

    .popover-card-preview * {
      box-sizing: border-box;
    }

    .popover-preview-banner {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 9;
      background-color: #0b0f14;
      overflow: hidden;
      cursor: pointer;
    }

    .popover-banner-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .popover-banner-gradient {
      position: absolute;
      inset: 0;
      background: linear-gradient(to top, #131A1C 0%, rgba(19, 26, 28, 0.35) 50%, transparent 100%);
      pointer-events: none;
    }

    .popover-preview-content {
      padding: 12px 14px 14px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background-color: #131A1C;
    }

    .popover-preview-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .popover-btn-play {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background: #ffffff;
      color: #111111;
      border: none;
      border-radius: 4px;
      padding: 7px 16px;
      font-weight: 700;
      font-size: 0.85rem;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.15s ease;
      line-height: 1;
    }

    .popover-btn-play:hover {
      background: rgba(255, 255, 255, 0.85);
      transform: scale(1.03);
    }

    .popover-btn-play:active {
      transform: scale(0.97);
    }

    .popover-btn-list,
    .popover-btn-info {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: rgba(42, 50, 60, 0.6);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.25);
      cursor: pointer;
      transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
      padding: 0;
    }

    .popover-btn-info {
      margin-left: auto;
    }

    .popover-btn-list:hover,
    .popover-btn-info:hover {
      border-color: #ffffff;
      background: rgba(60, 72, 85, 0.85);
      transform: scale(1.08);
    }

    .popover-btn-list:active,
    .popover-btn-info:active {
      transform: scale(0.95);
    }

    .popover-btn-list.is-active {
      background: #00d26a;
      border-color: #00d26a;
      color: #000000;
    }

    .popover-btn-play i:empty::before { content: ""; display: inline-block; width: 0; height: 0; border-top: 4px solid transparent; border-bottom: 4px solid transparent; border-left: 7px solid currentColor; margin-right: 2px; }
    .popover-btn-list i:empty::before { content: "+"; font-style: normal; font-size: 1.1rem; line-height: 1; }
    .popover-btn-info i:empty::before { content: "i"; font-style: normal; font-weight: bold; font-family: sans-serif; font-size: 0.9rem; line-height: 1; }

    .popover-btn-play svg,
    .popover-btn-list svg,
    .popover-btn-info svg {
      width: 16px;
      height: 16px;
      display: inline-block;
      vertical-align: middle;
    }

    .popover-btn-play svg {
      fill: currentColor;
    }

    .popover-preview-meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 0.78rem;
      line-height: 1.2;
    }

    .popover-badge-rating {
      font-weight: 700;
      color: #46d369;
      letter-spacing: 0.3px;
    }

    .popover-badge-year {
      color: #94a3b8;
      font-weight: 500;
    }

    .popover-badge-episodes {
      border: 1px solid rgba(255, 255, 255, 0.28);
      border-radius: 3px;
      padding: 1px 5px;
      font-size: 0.7rem;
      color: #cbd5e1;
      font-weight: 600;
    }

    .popover-preview-genres {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }

    .popover-genre-tag {
      font-size: 0.72rem;
      color: #e2e8f0;
      position: relative;
    }

    .popover-genre-tag:not(:last-child)::after {
      content: "•";
      margin-left: 6px;
      color: #64748b;
    }

    .popover-preview-synopsis {
      font-size: 0.76rem;
      line-height: 1.4;
      color: #94a3b8;
      margin: 0;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  `;

  const style = document.createElement('style');
  style.id = 'card-popover-preview-styles';
  style.textContent = css;
  document.head.appendChild(style);
  styleElement = style;
}

/**
 * Extracts card metadata from dataset attributes or DOM children.
 * @param {HTMLElement} card
 * @returns {object}
 */
export function extractCardMetadata(card) {
  const ds = card.dataset || {};

  // Extract ID
  let id = ds.id || ds.showId || card.getAttribute('data-id') || card.getAttribute('data-show-id') || '';
  if (!id) {
    const route = card.getAttribute('data-catalogue-route') || '';
    const routeMatch = route.match(/#\/show\/([^/?#]+)/);
    if (routeMatch) {
      id = decodeURIComponent(routeMatch[1]);
    }
  }
  if (!id) {
    const onclick = card.getAttribute('onclick') || '';
    const onclickMatch = onclick.match(/#\/show\/([^'"]+)/) || onclick.match(/playVideoEpisode\(\s*['"]([^'"]+)['"]/);
    if (onclickMatch) {
      id = onclickMatch[1];
    }
  }
  if (!id) {
    const link = card.querySelector('a[href*="#/show/"]');
    if (link) {
      const hrefMatch = link.getAttribute('href').match(/#\/show\/([^/?#]+)/);
      if (hrefMatch) id = decodeURIComponent(hrefMatch[1]);
    }
  }

  // Extract Title
  let title = ds.title || '';
  if (!title) {
    const titleEl = card.querySelector('.show-title, .card-title, h3, h4');
    if (titleEl) title = titleEl.getAttribute('title') || titleEl.textContent;
  }
  if (!title) {
    const imgEl = card.querySelector('img');
    if (imgEl) title = imgEl.getAttribute('alt') || '';
  }
  title = (title || 'Sin título').trim();

  // Extract Posters & Backdrop
  const imgEl = card.querySelector('.show-poster, .card-img-wrapper img, img');
  const imgSrc = imgEl ? (imgEl.currentSrc || imgEl.getAttribute('src') || '') : '';
  const cover = ds.cover || ds.poster || imgSrc || '/api/placeholder-poster';
  const backdrop = ds.backdrop || cover;

  // Extract Rating
  let rating = ds.rating || '';
  if (!rating) {
    const ratingEl = card.querySelector('.card-rating-badge, .show-rating, .badge-rating');
    if (ratingEl) {
      rating = ratingEl.textContent.replace(/[^\d.]/g, '').trim();
    }
  }
  if (!rating) rating = '8.5';
  const formattedRating = parseFloat(rating) ? parseFloat(rating).toFixed(1) : String(rating).replace(/[^\d.]/g, '');

  // Extract Year
  let year = ds.year || '';
  if (!year) {
    const metaEl = card.querySelector('.show-meta, .card-meta');
    if (metaEl) {
      const match = metaEl.textContent.match(/\b(19\d\d|20\d\d)\b/);
      if (match) year = match[1];
    }
  }
  if (!year) year = '2024';

  // Extract Episodes / Duration
  let episodes = ds.episodes || '';
  if (!episodes) {
    const badgeEl = card.querySelector('.show-badge, .badge');
    const badgeText = badgeEl ? badgeEl.textContent.trim() : '';
    if (badgeText.toLowerCase().includes('película') || ds.mediaType === 'movie') {
      episodes = 'Película';
    } else {
      episodes = '24 eps';
    }
  }

  // Extract Genres
  let genres = [];
  if (ds.genres) {
    try {
      if (ds.genres.startsWith('[')) {
        genres = JSON.parse(ds.genres);
      } else {
        genres = ds.genres.split(',').map((g) => g.trim()).filter(Boolean);
      }
    } catch {
      genres = ds.genres.split(',').map((g) => g.trim()).filter(Boolean);
    }
  }
  if (!genres || genres.length === 0) {
    const genreEls = card.querySelectorAll('.genre-badge, .show-genre');
    if (genreEls.length > 0) {
      genres = Array.from(genreEls).map((el) => el.textContent.trim());
    }
  }
  if (!genres || genres.length === 0) {
    genres = ['Anime', 'HD'];
  }

  // Extract Synopsis
  let synopsis = ds.synopsis || ds.description || '';
  if (!synopsis) {
    const synEl = card.querySelector('.show-synopsis, .card-synopsis, p');
    if (synEl) synopsis = synEl.textContent.trim();
  }
  if (!synopsis) {
    synopsis = 'Disfruta de esta emocionante producción en alta calidad cinematográfica en KuraStream.';
  }

  return {
    id,
    title,
    cover,
    backdrop,
    rating: formattedRating,
    year,
    episodes,
    genres,
    synopsis,
  };
}

/**
 * Returns or creates the singleton popover container element attached to document.body.
 * @returns {HTMLElement}
 */
export function getOrCreatePopoverElement() {
  if (singletonPopover && singletonPopover.parentNode) {
    return singletonPopover;
  }

  const existing = document.querySelector('.popover-card-preview');
  if (existing) {
    singletonPopover = existing;
    return singletonPopover;
  }

  const el = document.createElement('div');
  el.className = 'popover-card-preview';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Vista previa de contenido');
  el.setAttribute('tabindex', '-1');
  document.body.appendChild(el);
  singletonPopover = el;
  return singletonPopover;
}

/**
 * Initializes Netflix-grade hover popovers on catalogue cards.
 *
 * @param {string|HTMLElement} containerSelector Container element or selector (default: document.body)
 * @param {object} options Configuration options
 * @returns {{ destroy: Function, hide: Function }}
 */
export function initCardPopovers(containerSelector = document.body, options = {}) {
  // If an active instance exists, clean up listeners first
  if (activeInstance) {
    activeInstance.destroy();
  }

  ensurePopoverStyles();

  const container = typeof containerSelector === 'string'
    ? (document.querySelector(containerSelector) || document.body)
    : (containerSelector || document.body);

  const popoverEl = getOrCreatePopoverElement();

  const hoverDelay = typeof options.hoverDelay === 'number' ? options.hoverDelay : 350;
  const leaveDelay = typeof options.leaveDelay === 'number' ? options.leaveDelay : 200;
  const cardSelector = options.cardSelector || '.show-card';

  let openTimer = null;
  let hideTimer = null;
  let activeCard = null;
  let isVisible = false;
  let currentMeta = null;

  function clearTimers() {
    if (openTimer) {
      clearTimeout(openTimer);
      openTimer = null;
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function hidePopover(immediate = false) {
    if (!isVisible && !popoverEl.classList.contains('is-visible')) return;
    isVisible = false;
    activeCard = null;
    popoverEl.classList.remove('is-visible');

    if (immediate) {
      popoverEl.style.visibility = 'hidden';
      popoverEl.style.display = 'none';
    } else {
      setTimeout(() => {
        if (!isVisible) {
          popoverEl.style.visibility = 'hidden';
          popoverEl.style.display = 'none';
        }
      }, 220);
    }
  }

  function renderPopoverContent(meta) {
    currentMeta = meta;
    const bannerUrl = meta.backdrop || meta.cover || '/api/placeholder-poster';

    const genresHtml = meta.genres.map(
      (g) => `<span class="popover-genre-chip">${escapeHtml(g)}</span>`
    ).join('');

    popoverEl.innerHTML = `
      <div class="popover-preview-banner" title="${escapeHtml(meta.title)}">
        <img class="popover-banner-img" src="${escapeHtml(bannerUrl)}" alt="${escapeHtml(meta.title)}" onerror="this.src='/api/placeholder-poster'">
        <div class="popover-banner-gradient"></div>
      </div>
      <div class="popover-preview-content">
        <div class="popover-preview-actions">
          <button class="popover-btn-play cta-copper" type="button" aria-label="Reproducir"><i data-lucide="play" style="width:16px;height:16px;fill:currentColor;"></i> Reproducir</button>
          <button class="popover-btn-list" type="button" title="Mi Lista" aria-label="Mi Lista"><i data-lucide="plus"></i></button>
          <button class="popover-btn-info" type="button" title="Más información" aria-label="Más información"><i data-lucide="info"></i></button>
        </div>
        <div class="popover-preview-meta">
          <span class="popover-badge-rating-tabular"><i data-lucide="star" style="width:10px;height:10px;fill:var(--rating-color);stroke:var(--rating-color);"></i> ${escapeHtml(meta.rating)}</span>
          <span class="popover-badge-year">${escapeHtml(meta.year)}</span>
          <span class="popover-badge-episodes">${escapeHtml(meta.episodes)}</span>
        </div>
        <div class="popover-preview-genres" style="gap: 6px;">
          ${genresHtml}
        </div>
        <p class="popover-preview-synopsis">${escapeHtml(meta.synopsis)}</p>
      </div>
    `;

    // Re-run Lucide icons if available
    if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
      try {
        window.lucide.createIcons({
          root: popoverEl,
          attrs: { 'stroke-width': 1.75 },
        });
      } catch {
        try {
          window.lucide.createIcons();
        } catch (err) {
          console.warn('[CardPopover] Lucide render warning:', err);
        }
      }
    }

    // Bind action events
    const playBtn = popoverEl.querySelector('.popover-btn-play');
    if (playBtn) {
      playBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = currentMeta?.id;
        hidePopover(true);
        if (typeof options.onPlay === 'function') {
          options.onPlay(id, activeCard, currentMeta);
        } else if (id) {
          window.location.hash = `#/player/${encodeURIComponent(id)}`;
        }
      });
    }

    const listBtn = popoverEl.querySelector('.popover-btn-list');
    if (listBtn) {
      listBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = currentMeta?.id;
        if (!id) return;

        const isCurrentlyActive = listBtn.classList.contains('is-active');
        const nextActive = !isCurrentlyActive;
        listBtn.classList.toggle('is-active', nextActive);

        if (typeof options.onList === 'function') {
          options.onList(id, activeCard, nextActive);
        } else if (typeof window.toggleFavorite === 'function') {
          window.toggleFavorite(id);
        } else if (typeof window.toggleMyList === 'function') {
          window.toggleMyList(id);
        } else {
          const evt = new CustomEvent('kurastream:toggle-list', {
            bubbles: true,
            detail: { id, showId: id, isFavorite: nextActive, card: activeCard },
          });
          window.dispatchEvent(evt);
          if (activeCard) activeCard.dispatchEvent(evt);
        }

        if (nextActive) {
          listBtn.setAttribute('title', 'Quitar de mi lista');
          listBtn.setAttribute('aria-label', 'Quitar de mi lista');
          listBtn.innerHTML = '<i data-lucide="check"></i>';
        } else {
          listBtn.setAttribute('title', 'Mi Lista');
          listBtn.setAttribute('aria-label', 'Mi Lista');
          listBtn.innerHTML = '<i data-lucide="plus"></i>';
        }

        if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
          try {
            window.lucide.createIcons({
              root: listBtn,
              attrs: { 'stroke-width': 1.75 },
            });
          } catch {
            // ignore
          }
        }
      });
    }

    const infoBtn = popoverEl.querySelector('.popover-btn-info');
    if (infoBtn) {
      infoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = currentMeta?.id;
        hidePopover(true);
        if (typeof options.onInfo === 'function') {
          options.onInfo(id, activeCard, currentMeta);
        } else if (id) {
          window.location.hash = `#/show/${encodeURIComponent(id)}`;
        }
      });
    }

    const bannerEl = popoverEl.querySelector('.popover-preview-banner');
    if (bannerEl) {
      bannerEl.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const id = currentMeta?.id;
        if (id) {
          hidePopover(true);
          window.location.hash = `#/show/${encodeURIComponent(id)}`;
        }
      });
    }
  }

  function showPopover(card) {
    if (!card || !card.isConnected) return;
    activeCard = card;

    const meta = extractCardMetadata(card);
    renderPopoverContent(meta);

    // Prepare for layout measurement
    popoverEl.style.visibility = 'hidden';
    popoverEl.style.display = 'block';
    popoverEl.classList.remove('is-visible');

    const cardRect = card.getBoundingClientRect();
    const popoverWidth = popoverEl.offsetWidth || 320;
    const popoverHeight = popoverEl.offsetHeight || 340;
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;

    // Center popover over card:
    // left = cardRect.left + (cardRect.width / 2) - (popoverWidth / 2) + window.scrollX
    // top = cardRect.top + window.scrollY - 10
    let left = cardRect.left + (cardRect.width / 2) - (popoverWidth / 2) + scrollX;
    let top = cardRect.top + scrollY - 10;

    // Clamps left so it never bleeds beyond 16px from viewport edges
    const minLeft = scrollX + 16;
    const maxLeft = scrollX + viewportWidth - popoverWidth - 16;
    if (maxLeft >= minLeft) {
      left = Math.max(minLeft, Math.min(maxLeft, left));
    } else {
      left = minLeft;
    }

    // Check if card is near bottom edge, flip upward or adjust top offset
    const spaceBelow = viewportHeight - cardRect.bottom;
    const spaceAbove = cardRect.top;
    if (spaceBelow < (popoverHeight * 0.6) && spaceAbove > (popoverHeight * 0.6)) {
      top = cardRect.bottom + scrollY - popoverHeight;
    }

    // Clamp top so it never overflows offscreen top or bottom
    const minTop = scrollY + 16;
    const maxTop = scrollY + Math.max(16, viewportHeight - popoverHeight - 16);
    top = Math.max(minTop, Math.min(maxTop, top));

    popoverEl.style.left = `${Math.round(left)}px`;
    popoverEl.style.top = `${Math.round(top)}px`;

    // Trigger transition expansion
    void popoverEl.offsetWidth; // Force DOM reflow
    popoverEl.style.visibility = 'visible';
    popoverEl.classList.add('is-visible');
    isVisible = true;
  }

  function handleCardEnter(card) {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    if (isVisible && activeCard === card) {
      return;
    }

    if (openTimer) {
      clearTimeout(openTimer);
      openTimer = null;
    }

    openTimer = setTimeout(() => {
      openTimer = null;
      showPopover(card);
    }, hoverDelay);
  }

  function handleCardLeave() {
    if (openTimer) {
      clearTimeout(openTimer);
      openTimer = null;
    }

    if (isVisible) {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        hideTimer = null;
        hidePopover();
      }, leaveDelay);
    }
  }

  function handlePopoverEnter() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function handlePopoverLeave() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      hidePopover();
    }, leaveDelay);
  }

  function onMouseOver(e) {
    const card = e.target.closest(cardSelector);
    if (!card || !container.contains(card)) return;
    if (e.relatedTarget && card.contains(e.relatedTarget)) return;
    handleCardEnter(card);
  }

  function onMouseOut(e) {
    const card = e.target.closest(cardSelector);
    if (!card || !container.contains(card)) return;
    if (e.relatedTarget && card.contains(e.relatedTarget)) return;
    handleCardLeave();
  }

  function onScroll() {
    if (isVisible) {
      hidePopover(true);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && isVisible) {
      hidePopover(true);
    }
  }

  // Event Listeners
  container.addEventListener('mouseover', onMouseOver);
  container.addEventListener('mouseout', onMouseOut);
  popoverEl.addEventListener('mouseenter', handlePopoverEnter);
  popoverEl.addEventListener('mouseleave', handlePopoverLeave);
  popoverEl.addEventListener('focusin', handlePopoverEnter);
  popoverEl.addEventListener('focusout', (e) => {
    if (!popoverEl.contains(e.relatedTarget)) {
      handlePopoverLeave();
    }
  });

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('keydown', onKeyDown);

  const instance = {
    hide() {
      clearTimers();
      hidePopover(true);
    },
    destroy() {
      clearTimers();
      hidePopover(true);

      container.removeEventListener('mouseover', onMouseOver);
      container.removeEventListener('mouseout', onMouseOut);
      popoverEl.removeEventListener('mouseenter', handlePopoverEnter);
      popoverEl.removeEventListener('mouseleave', handlePopoverLeave);

      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('keydown', onKeyDown);

      if (singletonPopover) {
        if (typeof singletonPopover.remove === 'function') {
          singletonPopover.remove();
        } else if (singletonPopover.parentNode) {
          singletonPopover.parentNode.removeChild(singletonPopover);
        }
      }
      singletonPopover = null;

      if (styleElement) {
        if (typeof styleElement.remove === 'function') {
          styleElement.remove();
        } else if (styleElement.parentNode) {
          styleElement.parentNode.removeChild(styleElement);
        }
      }
      styleElement = null;

      if (activeInstance === instance) {
        activeInstance = null;
      }
    },
  };

  activeInstance = instance;
  return instance;
}

export default initCardPopovers;
