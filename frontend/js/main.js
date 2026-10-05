/**
 * KuraStream v2.0 - Canonical Application Entry Point
 * Orchestrates modular architecture, client routing, catalog rendering, and player lifecycle.
 */

import { AuthManager } from './core/auth.js';
import { fetchJson, loadErrorState } from './core/http.js';
import { readLanguagePrefs } from './player/tracks.js';
import { initDialogs } from './core/dialogs.js';
import { appState } from './core/state.js';
import { playerController } from './features/player/player_controller.js';
import { initPlayer, destroyPlayer, getActiveEpisodeId, getShowIdFromEpisodeId, orderEpisodes } from '../player.js?v=2026.10.05-security';
import { partyManager } from './modules/party.js';
import { updateActiveNavHighlight, initHeaderDropdowns, initAdminSidebar, stopAdminPolling } from './modules/navigation.js';
import { initCardPopovers } from './modules/card_popover_preview.js';
import { renderAppDownloadView } from './modules/app_download.js';
import { mountHeroCarousel, pickHeroShows } from './modules/hero_carousel.js';

// Cache for calendar day items
export let calendarDataCache = {};
export let currentShowEpisodes = [];
export let mylistSortValue = 'recent';
export let currentView = '';

// -------------------------------------------------------------
// Security & Formatting Utilities
// -------------------------------------------------------------

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function escapeHtmlAttribute(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Bumped on every route change. A view that awaits the network compares it afterwards and stops when the person
// has already moved on, so a slow answer for show A can no longer paint over show B.
let navigationGeneration = 0;

// One catalogue request shared by every view that needs the list (home, genres, "popular", avatar picker): it used
// to be fetched again, and parsed again, in seven places. Cached for 30 s per signed-in token; the server also
// answers 304 when nothing changed.
let catalogLoad = null;
let catalogLoadedAt = 0;
let catalogToken = null;

export function loadCatalog({ force = false } = {}) {
  const token = (typeof AuthManager !== 'undefined' && AuthManager.getToken) ? AuthManager.getToken() : null;
  const usable = catalogLoad && token === catalogToken && (catalogLoadedAt === 0 || Date.now() - catalogLoadedAt < 30000);
  if (!force && usable) return catalogLoad;
  const load = fetchJson('/api/shows').then(data => (Array.isArray(data) ? data : (data.shows || [])));
  catalogLoad = load;
  catalogLoadedAt = 0;
  catalogToken = token;
  load.then(() => { if (catalogLoad === load) catalogLoadedAt = Date.now(); }, () => { if (catalogLoad === load) catalogLoad = null; });
  return load;
}

// Lists (catalogue, history...) come back to where the person left them; every other view starts at the top.
const scrollPositions = new Map();
const SCROLL_RESTORED_ROUTES = new Set(['/', '/airing', '/movies', '/my-list', '/history', '/calendar', '/stats']);
let scrollRouteKey = null;

function trackRouteScroll(path) {
  if (scrollRouteKey !== null && typeof window.scrollY === 'number') scrollPositions.set(scrollRouteKey, window.scrollY);
  scrollRouteKey = path === '' ? '/' : path;
}

function restoreScrollFor(path) {
  if (typeof window.scrollTo !== 'function') return;
  const target = SCROLL_RESTORED_ROUTES.has(path) ? (scrollPositions.get(path) || 0) : 0;
  window.scrollTo(0, target);
  // The list is painted after its data arrives: try again while it grows.
  if (target > 0) [150, 500, 1200].forEach((ms) => setTimeout(() => window.scrollTo(0, target), ms));
}

/** `url("...")` for a CSS background, with the address JSON-escaped so a quote or parenthesis cannot end the string. */
export function cssUrl(src) {
  return `url(${JSON.stringify(String(src))})`;
}

/**
 * Paints avatars marked with data-bg-image / data-bg-color after they were inserted. Interpolating profile data
 * into a `style="..."` string lets a crafted value add declarations (a full-screen overlay); assigning a single
 * style property can only ever set that property.
 */
export function applyDynamicBackgrounds(root) {
  if (!root) return;
  root.querySelectorAll('[data-bg-image]').forEach(el => {
    el.style.backgroundImage = cssUrl(el.dataset.bgImage);
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
  });
  root.querySelectorAll('[data-bg-color]').forEach(el => {
    el.style.background = /^#[0-9a-fA-F]{6}$/.test(el.dataset.bgColor) ? el.dataset.bgColor : 'var(--accent-color)';
  });
}

// Broken artwork (404, deleted file) falls back to a placeholder instead of showing alt text
// over the card badges. Capture phase because 'error' does not bubble.
document.addEventListener('error', (event) => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement)) return;
  const fallback = img.dataset.fallbackSrc;
  if (fallback && !img.src.endsWith(fallback)) {
    img.src = fallback;
  }
}, true);

export function catalogueImageUrl(value) {
  const url = String(value ?? '').trim();
  if (!url) return '';
  try {
    const parsed = new URL(url, 'https://kurastream.invalid/');
    return ['http:', 'https:'].includes(parsed.protocol) ? url : '';
  } catch {
    return '';
  }
}

export function getUserAndProfile() {
  const user = AuthManager.getUser();
  const profile = AuthManager.getActiveProfile();
  const token = AuthManager.getToken();
  return {
    activeUser: user ? user.username : 'Guest',
    profileName: profile ? profile.name : 'Principal',
    isGuest: !user,
    // History, favorites, stats, notifications and preferences are per profile: the API answers 403 without one.
    hasProfile: Boolean(token && profile),
    token: token || ''
  };
}

export function showToast(message, type = 'info', duration = 3000) {
  const existing = document.getElementById('kura-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'kura-toast';
  toast.className = `kura-toast kura-toast-${type}`;
  toast.setAttribute('role', 'alert');
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('kura-toast-exit');
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

if (typeof window !== 'undefined') {
  window.showToast = showToast;
}

// -------------------------------------------------------------
// Auth & Header State Synchronization
// -------------------------------------------------------------

export function renderAuthState() {
  const btnLoginTrigger = document.getElementById('btn-login-trigger');
  const userProfileMenu = document.getElementById('user-profile-menu');
  const userProfileName = document.getElementById('user-profile-name');
  const userAvatarInitial = document.getElementById('user-avatar-initial');
  const btnAdminDirect = document.getElementById('btn-admin-direct');
  const notifContainer = document.getElementById('notifications-container');
  const btnSwitchProfile = document.getElementById('btn-switch-profile');
  const profilesList = document.getElementById('dropdown-profiles-list');

  const isAuth = AuthManager.isAuthenticated();
  const isAdmin = AuthManager.isAdmin();
  const user = AuthManager.getUser();
  const activeProfile = AuthManager.getActiveProfile();

  if (isAuth && user) {
    if (btnLoginTrigger) btnLoginTrigger.style.display = 'none';
    if (userProfileMenu) userProfileMenu.style.display = 'flex';

    if (isAdmin) {
      // Admins browse without a profile (preview mode) but can pick one to keep history and a list;
      // the header then shows who is watching, like for everyone else.
      const shownName = (activeProfile && activeProfile.name) || user.username || 'admin';
      if (userProfileName) userProfileName.textContent = shownName;
      if (userAvatarInitial) {
        if (activeProfile && activeProfile.avatar) {
          userAvatarInitial.textContent = '';
          userAvatarInitial.style.backgroundImage = cssUrl(activeProfile.avatar);
          userAvatarInitial.style.backgroundSize = 'cover';
          userAvatarInitial.style.backgroundPosition = 'center';
        } else {
          userAvatarInitial.style.backgroundImage = 'none';
          userAvatarInitial.textContent = (shownName[0] || 'A').toUpperCase();
        }
      }
      if (btnAdminDirect) btnAdminDirect.style.display = 'flex';
      if (btnSwitchProfile) btnSwitchProfile.style.display = 'flex';
      if (profilesList) profilesList.style.display = 'none';
    } else {
      if (btnAdminDirect) btnAdminDirect.style.display = 'none';
      if (btnSwitchProfile) btnSwitchProfile.style.display = 'flex';
      if (profilesList) profilesList.style.display = 'block';

      if (activeProfile && activeProfile.name) {
        if (userProfileName) userProfileName.textContent = activeProfile.name;
        if (userAvatarInitial) {
          if (activeProfile.avatar) {
            userAvatarInitial.textContent = '';
            userAvatarInitial.style.backgroundImage = cssUrl(activeProfile.avatar);
            userAvatarInitial.style.backgroundSize = 'cover';
            userAvatarInitial.style.backgroundPosition = 'center';
          } else {
            userAvatarInitial.style.backgroundImage = 'none';
            userAvatarInitial.textContent = (activeProfile.name[0] || 'U').toUpperCase();
          }
        }
      } else {
        if (userProfileName) userProfileName.textContent = user.username || 'Usuario';
        if (userAvatarInitial) {
          userAvatarInitial.style.backgroundImage = 'none';
          userAvatarInitial.textContent = (user.username || 'U')[0].toUpperCase();
        }

        // Auto-select default profile if authenticated but no active profile in storage
        if (!window._fetchingDefaultProfile) {
          window._fetchingDefaultProfile = true;
          const token = AuthManager.getToken();
          if (token) {
            fetch('/api/profiles', { headers: { 'Authorization': `Bearer ${token}` } })
              .then(r => r.ok ? r.json() : [])
              .then(profs => {
                const list = Array.isArray(profs) ? profs : (profs.profiles || []);
                if (list.length > 0) {
                  AuthManager.selectProfile(list[0].id).then(() => {
                    window._fetchingDefaultProfile = false;
                    renderAuthState();
                  }).catch(() => { window._fetchingDefaultProfile = false; });
                } else {
                  window._fetchingDefaultProfile = false;
                }
              })
              .catch(() => { window._fetchingDefaultProfile = false; });
          }
        }
      }
    }
  } else {
    if (btnLoginTrigger) btnLoginTrigger.style.display = 'flex';
    if (userProfileMenu) userProfileMenu.style.display = 'none';
    if (btnAdminDirect) btnAdminDirect.style.display = 'none';
  }

  if (notifContainer) {
    notifContainer.style.display = 'flex';
  }
}


export function openAuthModal(mode = 'login') {
  const modal = document.getElementById('login-modal');
  if (!modal) return;
  const title = document.getElementById('login-modal-title');
  const submitBtn = document.getElementById('login-modal-submit');
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const errorMsg = document.getElementById('login-error-msg');
  const userInput = document.getElementById('login-username-input');
  const passInput = document.getElementById('login-password-input');

  if (errorMsg) {
    errorMsg.textContent = '';
    errorMsg.style.display = 'none';
  }
  if (userInput) userInput.value = '';
  if (passInput) passInput.value = '';

  modal.dataset.mode = (mode === 'register') ? 'register' : (mode === 'admin' ? 'admin' : 'login');
  // Tells the browser/password manager whether to fill a saved password or offer to save a new one.
  if (passInput) passInput.setAttribute('autocomplete', mode === 'register' ? 'new-password' : 'current-password');

  if (mode === 'register') {
    if (tabLogin) {
      tabLogin.classList.remove('active');
      tabLogin.style.borderBottom = '2px solid transparent';
      tabLogin.style.color = 'var(--text-muted)';
    }
    if (tabRegister) {
      tabRegister.classList.add('active');
      tabRegister.style.borderBottom = '2px solid var(--accent-color)';
      tabRegister.style.color = 'var(--text-main)';
    }
    if (title) title.textContent = 'Crear una nueva cuenta';
    if (submitBtn) submitBtn.textContent = 'Registrarse';
  } else if (mode === 'admin') {
    if (tabLogin) {
      tabLogin.classList.add('active');
      tabLogin.style.borderBottom = '2px solid var(--accent-color)';
      tabLogin.style.color = 'var(--text-main)';
    }
    if (tabRegister) {
      tabRegister.classList.remove('active');
      tabRegister.style.borderBottom = '2px solid transparent';
      tabRegister.style.color = 'var(--text-muted)';
    }
    if (title) title.textContent = 'Acceso de Administrador';
    if (submitBtn) submitBtn.textContent = 'Iniciar Sesión';
  } else {
    // Default login
    if (tabLogin) {
      tabLogin.classList.add('active');
      tabLogin.style.borderBottom = '2px solid var(--accent-color)';
      tabLogin.style.color = 'var(--text-main)';
    }
    if (tabRegister) {
      tabRegister.classList.remove('active');
      tabRegister.style.borderBottom = '2px solid transparent';
      tabRegister.style.color = 'var(--text-muted)';
    }
    if (title) title.textContent = 'Inicia sesión en tu cuenta';
    if (submitBtn) submitBtn.textContent = 'Iniciar Sesión';
  }

  modal.style.display = 'flex';
  if (userInput) userInput.focus();
}

export function closeAuthModal() {
  const modal = document.getElementById('login-modal');
  if (modal) modal.style.display = 'none';
  const errorMsg = document.getElementById('login-error-msg');
  if (errorMsg) {
    errorMsg.textContent = '';
    errorMsg.style.display = 'none';
  }
}

export function setupAuthModalListeners() {
  const modal = document.getElementById('login-modal');
  const btnLoginTrigger = document.getElementById('btn-login-trigger');
  const cancelBtn = document.getElementById('login-modal-cancel');
  const submitBtn = document.getElementById('login-modal-submit');
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const userInput = document.getElementById('login-username-input');
  const passInput = document.getElementById('login-password-input');
  const errorMsg = document.getElementById('login-error-msg');

  if (btnLoginTrigger) {
    btnLoginTrigger.addEventListener('click', (e) => {
      e.preventDefault();
      openAuthModal('login');
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => closeAuthModal());
  }

  // The link navigates to #/app; the modal would otherwise stay on top of the download view.
  const appLink = document.getElementById('login-app-link');
  if (appLink) {
    appLink.addEventListener('click', () => closeAuthModal());
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeAuthModal();
    });
  }

  if (tabLogin) {
    tabLogin.addEventListener('click', (e) => {
      e.preventDefault();
      openAuthModal('login');
    });
  }
  if (tabRegister) {
    tabRegister.addEventListener('click', (e) => {
      e.preventDefault();
      openAuthModal('register');
    });
  }

  const handleAuthSubmit = async () => {
    const username = userInput ? userInput.value.trim() : '';
    const password = passInput ? passInput.value : '';
    const mode = modal ? modal.dataset.mode : 'login';

    if (!username || !password) {
      if (errorMsg) {
        errorMsg.textContent = 'Por favor introduce usuario y contraseña';
        errorMsg.style.display = 'block';
      }
      return;
    }

    if (errorMsg) errorMsg.style.display = 'none';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.dataset.originalText = submitBtn.textContent;
      submitBtn.textContent = mode === 'register' ? 'Registrando...' : 'Iniciando...';
    }

    try {
      if (mode === 'register') {
        await AuthManager.register(username, password);
        closeAuthModal();
        renderAuthState();
        showToast('Cuenta creada con éxito');
        window.location.hash = '#/profiles';
      } else {
        await AuthManager.login(username, password);
        closeAuthModal();
        renderAuthState();
        showToast('Sesión iniciada con éxito');
        if (mode === 'admin' || AuthManager.isAdmin()) {
          window.location.hash = '#/admin';
        } else if (!AuthManager.getActiveProfile()) {
          window.location.hash = '#/profiles';
        }
      }
    } catch (err) {
      if (errorMsg) {
        errorMsg.textContent = err.message || 'Error de autenticación';
        errorMsg.style.display = 'block';
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        if (submitBtn.dataset.originalText) {
          submitBtn.textContent = submitBtn.dataset.originalText;
        }
      }
    }
  };

  // A real <form>: Enter in either field and the button both submit it, and password managers recognise it.
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleAuthSubmit();
    });
  } else if (submitBtn) {
    submitBtn.addEventListener('click', handleAuthSubmit);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.style.display !== 'none' && modal.style.display !== '') closeAuthModal();
  });
}

// -------------------------------------------------------------
// Catalogue & Media Presentation Renderers
// -------------------------------------------------------------

export function setupCatalogueActions() {
  const activate = target => {
    const card = target.closest('[data-catalogue-route], .episode-item[data-episode-id]');
    if (!card) return;
    if (card.dataset.catalogueRoute !== undefined) {
      window.location.hash = card.dataset.catalogueRoute;
    } else if (card.dataset.episodeId) {
      if (card.classList && card.classList.contains('is-missing')) {
        // The file is not in the library right now (moved, deleted, disk offline): say so instead of failing in the player.
        window.showToast?.('Este episodio no está disponible en la biblioteca ahora mismo', 'error');
        return;
      }
      if (typeof window.showEpisodeDetails === 'function') {
        window.showEpisodeDetails(card.dataset.episodeId);
      } else {
        window.location.hash = `#/player/${encodeURIComponent(card.dataset.episodeId)}`;
      }
    }
  };

  document.addEventListener('click', event => activate(event.target));
  document.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[role="link"][data-catalogue-route], [role="button"][data-episode-id]')) {
      event.preventDefault();
      activate(event.target);
    }
  });
}

export function renderBillboardHero(featuredShow, index = 0, resume = null) {
  if (!featuredShow) return '';
  const rawBg = featuredShow.backdrop_path || featuredShow.poster_path || '';
  const bgUrl = catalogueImageUrl(rawBg) || '/assets/illustrations/backdrop_placeholder.svg';
  const rating = (featuredShow.rating && Number(featuredShow.rating) > 0) ? Number(featuredShow.rating).toFixed(1) : 'N/A';
  const year = featuredShow.year ? String(featuredShow.year) : 'N/A';
  // Every title here is animated, so TMDB's "Animación" only takes room from the real genres.
  const genreNames = showGenreList(featuredShow).map(genreLabel);
  const specific = genreNames.filter(g => !/^(animación|animation)$/i.test(g));
  const genres = (specific.length ? specific : ['Anime']).slice(0, 3)
    .map(g => `<span class="billboard-genre-tag">${escapeHtml(g)}</span>`).join('');
  const synopsis = featuredShow.synopsis || 'Sin sinopsis disponible.';
  const showRoute = '#/show/' + encodeURIComponent(featuredShow.id);
  // Only the first slide loads its artwork right away; the carousel fills in the others.
  const imgSrc = index === 0
    ? `src="${escapeHtmlAttribute(bgUrl)}" fetchpriority="high"`
    : `src="/assets/illustrations/backdrop_placeholder.svg" data-src="${escapeHtmlAttribute(bgUrl)}"`;
  const statusBadge = featuredShow.status === 'airing'
    ? '<span class="badge-airing-neon"><span class="airing-pulse-dot"></span> EN EMISIÓN</span>'
    : '';
  const playLabel = resume ? `Continuar ${escapeHtml(resume.label)}` : 'Reproducir';

  return `
    <div class="billboard-hero${index === 0 ? ' is-active' : ''}" data-index="${index}" role="group" aria-roledescription="diapositiva">
      <img class="billboard-hero-background" ${imgSrc} alt="" data-fallback-src="/assets/illustrations/backdrop_placeholder.svg">
      <div class="billboard-hero-vignette"></div>
      <div class="billboard-hero-content">
        <div class="billboard-hero-badges">
          ${statusBadge}
          <span class="billboard-hero-meta">
            <span class="badge-rating"><i data-lucide="star"></i>${rating}</span>
            <span class="badge-year">${escapeHtml(year)}</span>
          </span>
          <div class="billboard-genres">${genres}</div>
        </div>
        <h1 class="billboard-hero-title">${escapeHtml(featuredShow.title)}</h1>
        <p class="billboard-hero-synopsis">${escapeHtml(synopsis)}</p>
        <div class="billboard-hero-actions">
          <button type="button" class="btn-billboard-play" data-hero-play="${escapeHtmlAttribute(featuredShow.id)}"${resume ? ` data-episode-id="${escapeHtmlAttribute(resume.episodeId)}"` : ''}>
            <i data-lucide="play"></i> ${playLabel}
          </button>
          <button type="button" class="btn-billboard-info" data-catalogue-route="${escapeHtmlAttribute(showRoute)}">
            <i data-lucide="info"></i> Más información
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Plays a show: the profile's last unfinished episode of it when known, otherwise its first
 * episode (specials last). Falls back to the detail page if the episodes cannot be loaded.
 */
export async function playShow(showId, resumeEpisodeId = '') {
  const resumeId = resumeEpisodeId || (catalogHistoryMap.get(String(showId)) || {}).episode_id;
  if (resumeId) {
    window.location.hash = `#/player/${encodeURIComponent(resumeId)}`;
    return;
  }
  try {
    const res = await fetch(`/api/shows/${encodeURIComponent(showId)}`);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const episodes = orderEpisodes(Array.isArray(data.episodes) ? data.episodes : []);
    window.location.hash = episodes.length
      ? `#/player/${encodeURIComponent(episodes[0].id)}`
      : `#/show/${encodeURIComponent(showId)}`;
  } catch {
    window.location.hash = `#/show/${encodeURIComponent(showId)}`;
  }
}

/** Adds or removes a show from "Mi Lista"; resolves with the new state, or null on failure. */
export async function toggleFavoriteShow(showId) {
  const { token, hasProfile } = getUserAndProfile();
  if (!hasProfile) {
    showToast(AuthManager.isAuthenticated() ? 'Elige un perfil para usar Mi Lista' : 'Inicia sesión para usar Mi Lista', 'warning');
    if (!AuthManager.isAuthenticated()) openAuthModal('login');
    return null;
  }
  try {
    const res = await fetch('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ show_id: showId })
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const favorited = Boolean(data && data.favorited);
    showToast(favorited ? 'Agregado a tu lista' : 'Eliminado de tu lista', 'info');
    return favorited;
  } catch {
    showToast('No se pudo actualizar tu lista', 'error');
    return null;
  }
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-hero-play]');
  if (!button || button.disabled) return;
  button.disabled = true;
  try {
    await playShow(button.dataset.heroPlay, button.dataset.episodeId || '');
  } finally {
    button.disabled = false;
  }
});

/**
 * "Continuar viendo" rail. Items come from /api/history/continue: one per show, either the episode
 * in progress or the next one after a finished episode (up_next). Shows watched to the end are absent.
 */
export function renderContinueWatching(continueItems) {
  if (!Array.isArray(continueItems) || continueItems.length === 0) return '';

  const cardsHTML = continueItems.map(item => {
    const dur = item.duration > 0 ? item.duration : 0;
    const progress = item.progress_seconds || 0;
    const progressPercent = dur > 0 ? Math.min(100, Math.max(0, (progress / dur) * 100)) : 0;
    const img = item.thumbnail_path || item.backdrop_path || item.poster_path || '';
    const imgUrl = catalogueImageUrl(img) || '/assets/illustrations/backdrop_placeholder.svg';
    const epLabel = Number(item.season_number) > 0
      ? `T${item.season_number}:E${item.episode_number}`
      : (item.media_type === 'movie' ? 'Película' : `Especial ${item.episode_number}`);
    const remainingMin = Math.ceil(Math.max(0, dur - progress) / 60);
    let detail;
    if (item.up_next && progress < 1) detail = 'Siguiente episodio';
    else if (remainingMin > 0) detail = `${remainingMin} min restantes`;
    else detail = `${Math.round(progressPercent)}% visto`;
    const subtext = `${epLabel} • ${detail}`;

    return `
      <div class="continue-watching-card" role="link" tabindex="0" data-catalogue-route="${escapeHtmlAttribute('#/player/' + encodeURIComponent(item.episode_id))}" title="${escapeHtmlAttribute(`${item.show_title || ''} - ${item.episode_title || epLabel}`)}">
        <div class="continue-watching-thumb-wrapper">
          <img class="continue-watching-thumb" src="${escapeHtmlAttribute(imgUrl)}" alt="${escapeHtmlAttribute(item.show_title || '')}" loading="lazy">
          <div class="continue-watching-play-btn" aria-label="Reproducir">
            <i data-lucide="play"></i>
          </div>
          ${item.up_next && progress < 1 ? '<span class="continue-watching-next-badge">Nuevo</span>' : ''}
          <div class="continue-watching-progress-bar">
            <div class="continue-watching-progress-fill" style="width: ${progressPercent}%;"></div>
          </div>
        </div>
        <div class="continue-watching-info">
          <h4 class="continue-watching-title">${escapeHtml(item.show_title || '')}</h4>
          <span class="continue-watching-subtext">${escapeHtml(subtext)}</span>
          <div class="continue-watching-action">${item.up_next && progress < 1 ? 'Ver ahora' : 'Continuar'} <i data-lucide="chevron-right"></i></div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <section class="dashboard-section continue-watching-section">
      <h2 class="section-title">Continuar Viendo</h2>
      <div class="continue-watching-rail">
        ${cardsHTML}
      </div>
    </section>
  `;
}

export function createShowCardHTML(show, historyMap = new Map()) {
  const poster = show.poster_path || '';
  const posterSrc = catalogueImageUrl(poster) || '/assets/illustrations/poster_placeholder.svg';
  const rating = show.rating ? Number(show.rating).toFixed(1) : 'N/A';

  const historyItem = historyMap && historyMap.get ? historyMap.get(String(show.id)) : null;
  let progressHTML = '';
  if (historyItem && historyItem.duration > 0 && historyItem.progress_seconds > 0) {
    const progressPercent = Math.min(100, Math.max(0, ((historyItem.progress_seconds || 0) / historyItem.duration) * 100));
    progressHTML = `
      <div class="card-progress-bar-container">
        <div class="card-progress-bar" style="width: ${progressPercent}%;"></div>
      </div>
      <div class="card-continue-watching-indicator">
        <i data-lucide="play"></i>
        ${Math.round(progressPercent)}% visto
      </div>
    `;
  }

  const isAiring = show.status === 'airing';
  const airingBadgeHTML = isAiring ? `
    <div class="badge-airing-neon">
      <span class="airing-pulse-dot"></span> EMISIÓN
    </div>
  ` : '';

  return `
    <a class="show-card" href="${escapeHtmlAttribute('#/show/' + encodeURIComponent(show.id))}" data-catalogue-route="${escapeHtmlAttribute('#/show/' + encodeURIComponent(show.id))}">
      <div class="card-img-wrapper">
        <img class="show-card-poster" src="${escapeHtmlAttribute(posterSrc)}" alt="${escapeHtmlAttribute(show.title)}" loading="lazy" decoding="async" data-fallback-src="/assets/illustrations/poster_placeholder.svg">
        <div class="card-rating-badge">
          <i data-lucide="star"></i>${rating}
        </div>
        ${airingBadgeHTML}
        ${progressHTML}
      </div>
      <div class="card-info">
        <h3 class="card-title">${escapeHtml(show.title)}</h3>
        <div class="card-meta">
          <span>${show.media_type === 'movie' ? 'Película' : 'Anime'}${show.year ? ` · ${escapeHtml(show.year)}` : ''}</span>
        </div>
      </div>
    </a>
  `;
}

export function renderEpisodeList(epList, targetContainer, fallbackPoster = '', showProgressMap = {}) {
  if (!targetContainer) return;
  if (!epList || epList.length === 0) {
    targetContainer.innerHTML = '<div class="empty-state">No hay capítulos importados en esta temporada.</div>';
    return;
  }

  targetContainer.innerHTML = epList.map(ep => {
    const durationMin = Math.round((ep.duration || 0) / 60);
    const thumb = ep.thumbnail_path || fallbackPoster || '';
    const thumbSrc = catalogueImageUrl(thumb) || '/assets/illustrations/backdrop_placeholder.svg';

    const prog = (showProgressMap && showProgressMap[ep.id]) || {};
    const watchedSec = prog.progress_seconds ?? prog.progress ?? 0;
    const durSec = prog.duration || ep.duration || 0;
    const progressPercent = durSec > 0 ? Math.min(100, Math.max(0, (watchedSec / durSec) * 100)) : 0;
    const isCompleted = Boolean(prog.completed) || progressPercent >= 85;
    const isInProgress = !isCompleted && progressPercent >= 3;

    const completedBadgeHTML = isCompleted ? `
      <div class="badge-visto">
        <i data-lucide="check"></i> VISTO
      </div>
    ` : '';

    const progressBarHTML = isInProgress ? `
      <div class="episode-progress-bar">
        <div class="episode-progress-fill" style="width: ${Math.round(progressPercent)}%;"></div>
      </div>
    ` : '';

    return `
      <div class="episode-item${ep.available === false ? ' is-missing' : ''}" role="button" tabindex="0"${ep.available === false ? ' aria-disabled="true"' : ''} data-episode-id="${escapeHtmlAttribute(ep.id)}">
        <div class="episode-thumbnail-container">
          <img class="episode-thumb" src="${escapeHtmlAttribute(thumbSrc)}" alt="${escapeHtmlAttribute(ep.title || 'Episodio')}" loading="lazy">
          ${durationMin > 0 ? `<div class="episode-duration-pill">${durationMin}m</div>` : ''}
          ${completedBadgeHTML}
          ${ep.available === false ? '<div class="badge-missing">No disponible</div>' : ''}
          ${progressBarHTML}
          <div class="episode-play-overlay">
            <span class="play-icon-small"><i data-lucide="play"></i></span>
          </div>
        </div>
        <div class="episode-info">
          <div class="episode-title-row">
            <span class="episode-number">${ep.episode_number ? `Ep. ${escapeHtml(ep.episode_number)}` : 'Episodio'}</span>
            <h4 class="episode-title">${escapeHtml(ep.title || `Capítulo ${ep.episode_number || 1}`)}</h4>
          </div>
          <p class="episode-synopsis">${escapeHtml(ep.synopsis || 'Sin descripción disponible.')}</p>
        </div>
      </div>
    `;
  }).join('');

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

export function showEpisodeDetails(episodeId) {
  const ep = currentShowEpisodes.find(e => e.id === episodeId);
  if (!ep) return;

  const numberEl = document.getElementById('ep-detail-number');
  const titleEl = document.getElementById('ep-detail-title');
  const synopsisEl = document.getElementById('ep-detail-synopsis');
  const durationEl = document.getElementById('ep-detail-duration');
  const resolutionEl = document.getElementById('ep-detail-resolution');
  const codecEl = document.getElementById('ep-detail-codec');
  const sizeEl = document.getElementById('ep-detail-size');
  const audioEl = document.getElementById('ep-detail-audio');
  const subsEl = document.getElementById('ep-detail-subtitles');
  const playBtn = document.getElementById('ep-detail-play-btn');
  const closeBtn = document.getElementById('ep-detail-close');
  const modal = document.getElementById('episode-detail-modal');

  if (numberEl) {
    numberEl.textContent = ep.season_number ? `Temporada ${ep.season_number} • Capítulo ${ep.episode_number}` : `Capítulo ${ep.episode_number}`;
  }
  if (titleEl) titleEl.textContent = ep.title || `Capítulo ${ep.episode_number}`;
  if (synopsisEl) synopsisEl.textContent = ep.synopsis || 'Sin descripción disponible para este capítulo.';
  if (durationEl) durationEl.textContent = `${Math.round((ep.duration || 0) / 60)} min`;
  if (resolutionEl) resolutionEl.textContent = ep.resolution || 'N/A';
  if (codecEl) codecEl.textContent = ep.video_codec || 'N/A';
  if (sizeEl) sizeEl.textContent = ep.size ? `${(ep.size / (1024 * 1024)).toFixed(1)} MB` : 'N/A';

  // Subtitles are intentionally excluded from this modal view
  if (subsEl) {
    subsEl.innerHTML = '';
  }

  let selectedAudioTrack = 0;

  if (audioEl) {
    let audioTracks = [];
    if (ep.audio_tracks) {
      try {
        audioTracks = typeof ep.audio_tracks === 'string' ? JSON.parse(ep.audio_tracks) : ep.audio_tracks;
      } catch {
        audioTracks = [];
      }
    }
    if (!Array.isArray(audioTracks)) audioTracks = [];

    const formatAudioTrack = (t, index = 0) => {
      const trackObj = (t && typeof t === 'object') ? t : {};
      const rawLang = String(trackObj.language || trackObj.lang || '').toLowerCase().trim();
      const rawTitle = String(trackObj.title || trackObj.name || trackObj.label || (typeof t === 'string' ? t : '')).trim();
      const trackNum = trackObj.track_number !== undefined ? trackObj.track_number : (trackObj.index !== undefined ? trackObj.index : index);

      let detectedLang = '';
      let isLatino = false;
      let isCastellano = false;

      // Detect language from code
      if (/^(?:es[-_](?:la|419|mx|ar|co|cl|pe|us|uy|ve|ec|gt|cu|bo|do|hn|py|sv|ni|cr|pa|pr)|lat)$/i.test(rawLang)) {
        detectedLang = 'es-la';
        isLatino = true;
      } else if (/^(?:es[-_]es)$/i.test(rawLang)) {
        detectedLang = 'es';
        isCastellano = true;
      } else if (/^(?:spa|es|spanish|espa[nñ]ol)$/i.test(rawLang) || rawLang.startsWith('es-') || rawLang.startsWith('es_')) {
        detectedLang = 'spa';
      } else if (/^(?:jpn|ja|ja[-_]jp|japanese)$/i.test(rawLang)) {
        detectedLang = 'jpn';
      } else if (/^(?:eng|en|en[-_](?:us|gb|ca|au|nz)|english)$/i.test(rawLang)) {
        detectedLang = 'eng';
      } else if (/^(?:fra|fre|fr|fr[-_](?:fr|ca)|french)$/i.test(rawLang)) {
        detectedLang = 'fra';
      } else if (/^(?:deu|ger|de|de[-_](?:de|at|ch)|german)$/i.test(rawLang)) {
        detectedLang = 'deu';
      } else if (/^(?:ita|it|it[-_]it|italian)$/i.test(rawLang)) {
        detectedLang = 'ita';
      } else if (/^(?:por|pt|pt[-_](?:br|pt)|portuguese)$/i.test(rawLang)) {
        detectedLang = 'por';
      } else if (/^(?:kor|ko|ko[-_]kr|korean)$/i.test(rawLang)) {
        detectedLang = 'kor';
      } else if (/^(?:zho|chi|zh|zh[-_](?:cn|tw|hk)|chinese)$/i.test(rawLang)) {
        detectedLang = 'zho';
      } else if (/^(?:rus|ru|ru[-_]ru|russian)$/i.test(rawLang)) {
        detectedLang = 'rus';
      }

      // Detect language or dialect from track title
      const titleLower = rawTitle.toLowerCase();
      if (/\b(latino|lat|es-la|es-419|hispanoam[eé]rica|mexico|m[eé]xico)\b/i.test(titleLower)) {
        isLatino = true;
        detectedLang = 'es-la';
      } else if (/\b(castellano|espa[nñ]a|spain|es-es)\b/i.test(titleLower)) {
        isCastellano = true;
        detectedLang = 'es';
      } else if (!detectedLang || detectedLang === 'und') {
        if (/(?:^|[_\s\-\[\(\/])(?:spa|esp|es|spanish|espa[nñ]ol)(?:$|[_\s\-\]\)\/])/i.test(titleLower) || /\b(?:spanish|espa[nñ]ol)\b/i.test(titleLower)) {
          detectedLang = 'spa';
        } else if (/(?:^|[_\s\-\[\(\/])(?:jpn|jap|ja|japanese|japon[eé]s)(?:$|[_\s\-\]\)\/])/i.test(titleLower) || /\b(?:japanese|japon[eé]s)\b/i.test(titleLower)) {
          detectedLang = 'jpn';
        } else if (/(?:^|[_\s\-\[\(\/])(?:eng|en|english|ingl[eé]s)(?:$|[_\s\-\]\)\/])/i.test(titleLower) || /\b(?:english|ingl[eé]s)\b/i.test(titleLower)) {
          detectedLang = 'eng';
        } else if (/(?:^|[_\s\-\[\(\/])(?:fra|fre|fr|french|franc[eé]s)(?:$|[_\s\-\]\)\/])/i.test(titleLower) || /\b(?:french|franc[eé]s)\b/i.test(titleLower)) {
          detectedLang = 'fra';
        } else if (/(?:^|[_\s\-\[\(\/])(?:deu|ger|de|german|alem[aá]n)(?:$|[_\s\-\]\)\/])/i.test(titleLower) || /\b(?:german|alem[aá]n)\b/i.test(titleLower)) {
          detectedLang = 'deu';
        } else if (/(?:^|[_\s\-\[\(\/])(?:ita|it|italian|italiano)(?:$|[_\s\-\]\)\/])/i.test(titleLower) || /\b(?:italian|italiano)\b/i.test(titleLower)) {
          detectedLang = 'ita';
        } else if (/(?:^|[_\s\-\[\(\/])(?:por|pt|portuguese|portugu[eé]s)(?:$|[_\s\-\]\)\/])/i.test(titleLower) || /\b(?:portuguese|portugu[eé]s)\b/i.test(titleLower)) {
          detectedLang = 'por';
        } else if (/(?:^|[_\s\-\[\(\/])(?:kor|ko|korean|coreano)(?:$|[_\s\-\]\)\/])/i.test(titleLower) || /\b(?:korean|coreano)\b/i.test(titleLower)) {
          detectedLang = 'kor';
        } else if (/(?:^|[_\s\-\[\(\/])(?:zho|chi|zh|chinese|chino)(?:$|[_\s\-\]\)\/])/i.test(titleLower) || /\b(?:chinese|chino)\b/i.test(titleLower)) {
          detectedLang = 'zho';
        } else if (/(?:^|[_\s\-\[\(\/])(?:rus|ru|russian|ruso)(?:$|[_\s\-\]\)\/])/i.test(titleLower) || /\b(?:russian|ruso)\b/i.test(titleLower)) {
          detectedLang = 'rus';
        }
      }

      let label = '';
      if (isLatino) {
        label = 'Español Latino';
      } else if (isCastellano) {
        label = 'Español (España)';
      } else if (detectedLang === 'spa') {
        label = 'Español';
      } else if (detectedLang === 'jpn') {
        label = 'Japonés';
      } else if (detectedLang === 'eng') {
        label = 'Inglés';
      } else if (detectedLang === 'fra') {
        label = 'Francés';
      } else if (detectedLang === 'deu') {
        label = 'Alemán';
      } else if (detectedLang === 'ita') {
        label = 'Italiano';
      } else if (detectedLang === 'por') {
        label = 'Portugués';
      } else if (detectedLang === 'kor') {
        label = 'Coreano';
      } else if (detectedLang === 'zho') {
        label = 'Chino';
      } else if (detectedLang === 'rus') {
        label = 'Ruso';
      }

      if (!label) {
        let clean = rawTitle
          .replace(/\[[^\]]*\]/g, '')
          .replace(/\([^)]*\)/g, '')
          .replace(/\b(?:gaton|erai-raws|subsplease|horriblesubs|judas|ember|asw|puya|crunchyroll|netflix|animetime)\b/gi, '')
          .replace(/[_\-]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        label = clean || `Pista ${index + 1}`;
      }

      return {
        label,
        lang: detectedLang || rawLang || 'und',
        trackNum
      };
    };

    if (audioTracks.length === 0) {
      audioEl.innerHTML = '<button type="button" class="detail-pref-pill active" data-track="0" data-lang="default">Audio predeterminado</button>';
      selectedAudioTrack = 0;
    } else {
      const processedTracks = audioTracks.map((t, idx) => ({
        ...formatAudioTrack(t, idx),
        orig: t,
        idx
      }));

      // Disambiguate duplicate labels if any
      const labelGroups = new Map();
      processedTracks.forEach(t => {
        if (!labelGroups.has(t.label)) labelGroups.set(t.label, []);
        labelGroups.get(t.label).push(t);
      });

      labelGroups.forEach((group, baseLabel) => {
        if (group.length > 1) {
          const channelLabels = group.map(t => {
            const ch = t.orig?.channels;
            if (ch === 6) return '5.1';
            if (ch === 2) return 'Estéreo';
            if (ch > 2) return `${ch}ch`;
            return '';
          });
          const hasEmptyChannel = channelLabels.some(c => !c);
          const uniqueChannels = new Set(channelLabels);

          if (!hasEmptyChannel && uniqueChannels.size === group.length) {
            group.forEach((t, i) => {
              t.label = `${baseLabel} (${channelLabels[i]})`;
            });
          } else {
            group.forEach((t, i) => {
              const ch = channelLabels[i];
              if (ch) {
                t.label = `${baseLabel} (${ch} ${i + 1})`;
              } else {
                t.label = `${baseLabel} (${i + 1})`;
              }
            });
          }
        }
      });

      const prefAudio = readLanguagePrefs(typeof localStorage !== 'undefined' ? localStorage : null, typeof window !== 'undefined' ? window.userPreferences : null).audio;

      const matchesLang = (trackLang, pref) => {
        if (!trackLang || !pref) return false;
        const t = String(trackLang).toLowerCase().trim();
        const p = String(pref).toLowerCase().trim();
        if (p === 'default' || p === 'off') return false;
        if (t === p) return true;
        const spanishAliases = ['spa', 'es', 'es-es', 'es-la', 'es-419', 'spanish', 'español', 'castellano', 'lat'];
        const englishAliases = ['eng', 'en', 'en-us', 'en-gb', 'english', 'inglés'];
        const japaneseAliases = ['jpn', 'ja', 'japanese', 'japonés'];
        if (spanishAliases.includes(p) && spanishAliases.includes(t)) return true;
        if (englishAliases.includes(p) && englishAliases.includes(t)) return true;
        if (japaneseAliases.includes(p) && japaneseAliases.includes(t)) return true;
        return t.startsWith(p) || p.startsWith(t);
      };

      let activeTrack = processedTracks.find(t => matchesLang(t.lang, prefAudio));
      if (!activeTrack) {
        activeTrack = processedTracks.find((t, i) => {
          const raw = audioTracks[i];
          return raw && (raw.disposition?.default || raw.is_default);
        });
      }
      if (!activeTrack && processedTracks.length > 0) {
        activeTrack = processedTracks[0];
      }

      selectedAudioTrack = activeTrack ? activeTrack.trackNum : 0;

      audioEl.innerHTML = processedTracks.map(info => `
        <button type="button"
                class="detail-pref-pill ${info.trackNum === selectedAudioTrack ? 'active' : ''}"
                data-track="${info.trackNum}"
                data-lang="${escapeHtmlAttribute(info.lang)}">
          ${escapeHtml(info.label)}
        </button>
      `).join('');

      audioEl.querySelectorAll('.detail-pref-pill').forEach(pill => {
        pill.onclick = () => {
          audioEl.querySelectorAll('.detail-pref-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          const trackNum = parseInt(pill.getAttribute('data-track'), 10);
          const lang = pill.getAttribute('data-lang');
          selectedAudioTrack = trackNum;
          if (lang && lang !== 'und') {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('kura_pref_audio_lang', lang);
              localStorage.setItem('kurastream_preferred_audio_language', lang);
            }
            if (typeof window !== 'undefined' && window.userPreferences) {
              window.userPreferences.preferred_audio_language = lang;
            }
          }
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('kura_play_audio_track', String(trackNum));
            sessionStorage.setItem('kura_play_audio_ep', String(ep.id));
          }
        };
      });
    }
  }

  if (playBtn) {
    playBtn.onclick = () => {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('kura_play_audio_track', String(selectedAudioTrack));
        sessionStorage.setItem('kura_play_audio_ep', String(ep.id));
      }
      if (modal) modal.style.display = 'none';
      location.hash = `#/player/${encodeURIComponent(ep.id)}`;
    };
  }

  if (closeBtn) {
    closeBtn.onclick = () => {
      if (modal) modal.style.display = 'none';
    };
  }

  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) modal.style.display = 'none';
    };
    modal.style.display = 'flex';
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

export async function loadShowDetails(id) {
  const generation = navigationGeneration;
  const detailTitle = document.getElementById('detail-title');
  const detailSynopsis = document.getElementById('detail-synopsis');
  const detailPoster = document.getElementById('detail-poster');
  const detailRating = document.getElementById('detail-rating');
  const detailYear = document.getElementById('detail-year');
  const detailAge = document.getElementById('detail-age');
  const detailStatusBadge = document.getElementById('detail-status-badge');
  const detailCast = document.getElementById('detail-cast');
  const detailStudio = document.getElementById('detail-studio');
  const detailDirector = document.getElementById('detail-director');
  const detailWriter = document.getElementById('detail-writer');
  const seasonTabs = document.getElementById('season-tabs');
  const episodesList = document.getElementById('episodes-list');

  if (detailTitle) detailTitle.textContent = 'Cargando...';
  if (detailSynopsis) detailSynopsis.textContent = '';
  if (detailCast) detailCast.innerHTML = '';
  if (detailStudio) detailStudio.textContent = '--';
  if (detailDirector) detailDirector.textContent = '--';
  if (detailWriter) detailWriter.textContent = '--';
  if (detailStatusBadge) detailStatusBadge.textContent = '--';

  try {
    const res = await fetch(`/api/shows/${encodeURIComponent(id)}`);
    if (res.ok !== undefined && !res.ok) {
      throw new Error(`Error ${res.status}: no se pudo cargar el show`);
    }
    const data = await res.json();
    if (generation !== navigationGeneration) return;   // the person already left this show
    const show = data.show || data;
    const episodes = Array.isArray(data.episodes) ? data.episodes : (show.episodes || []);
    currentShowEpisodes = episodes;
    // Per-season poster/banner/synopsis (the show's own art is its latest season's).
    const seasonInfoList = Array.isArray(data.season_info) ? data.season_info : (Array.isArray(show.season_info) ? show.season_info : []);
    const seasonInfo = new Map(seasonInfoList.map(info => [String(info.season_number), info]));

    if (detailTitle) detailTitle.textContent = show.title || 'Detalle del Anime';
    if (detailSynopsis) detailSynopsis.textContent = show.synopsis || 'Sin sinopsis disponible.';
    const detailPosterSrc = catalogueImageUrl(show.poster_path || '') || '/assets/illustrations/poster_placeholder.svg';
    if (detailPoster) {
      detailPoster.onerror = () => { detailPoster.src = '/assets/illustrations/poster_placeholder.svg'; };
      detailPoster.src = detailPosterSrc;
    }
    const ambientBg = document.querySelector('.detail-ambient-bg');
    if (ambientBg) {
      let loops = [];
      if (Array.isArray(show.backdrop_loops)) {
        loops = show.backdrop_loops;
      } else if (typeof show.backdrop_loops === 'string') {
        try { loops = JSON.parse(show.backdrop_loops); } catch { loops = []; }
      }

      let ambientVideo = typeof ambientBg.querySelector === 'function'
        ? ambientBg.querySelector('video.ambient-loop-video')
        : (typeof ambientBg.querySelectorAll === 'function' ? (ambientBg.querySelectorAll('video.ambient-loop-video')[0] || null) : null);

      if (loops && loops.length > 0 && loops[0]) {
        const loopSrc = loops[0].startsWith('/') ? loops[0] : `/library/${loops[0]}`;
        if (!ambientVideo) {
          ambientVideo = document.createElement('video');
          ambientVideo.className = 'ambient-loop-video';
          ambientVideo.setAttribute('muted', '');
          ambientVideo.muted = true;
          ambientVideo.setAttribute('loop', '');
          ambientVideo.loop = true;
          ambientVideo.setAttribute('playsinline', '');
          ambientVideo.setAttribute('autoplay', '');
          ambientVideo.style.position = 'absolute';
          ambientVideo.style.inset = '0';
          ambientVideo.style.width = '100%';
          ambientVideo.style.height = '100%';
          ambientVideo.style.objectFit = 'cover';
          ambientVideo.style.opacity = '0.35';
          ambientVideo.style.pointerEvents = 'none';
          if (typeof ambientBg.prepend === 'function') {
            ambientBg.prepend(ambientVideo);
          } else if (typeof ambientBg.insertAdjacentElement === 'function') {
            ambientBg.insertAdjacentElement('afterbegin', ambientVideo);
          } else if (typeof ambientBg.appendChild === 'function') {
            ambientBg.appendChild(ambientVideo);
          }
        }
        ambientVideo.src = loopSrc;
        ambientVideo.play().catch(() => {});
        ambientBg.style.backgroundImage = 'none';
        // The loop is the show's art: season changes must not paint a banner under it.
        if (ambientBg.dataset) delete ambientBg.dataset.seasonArt;
      } else {
        if (ambientVideo) {
          ambientVideo.pause();
          ambientVideo.src = '';
          ambientVideo.remove();
        }
        const backdropUrl = catalogueImageUrl(show.backdrop_path || show.poster_path || '') || '/assets/illustrations/backdrop_placeholder.svg';
        ambientBg.style.backgroundImage = `url("${backdropUrl}")`;
        if (ambientBg.dataset) ambientBg.dataset.seasonArt = '1';
      }
    }

    // Trailer Button & Modal
    const trailerBtn = document.getElementById('detail-trailer-btn');
    const trailerModal = document.getElementById('trailer-modal');
    const trailerIframe = document.getElementById('trailer-iframe');
    const trailerClose = document.getElementById('trailer-close-btn');

    if (trailerBtn) {
      if (show.trailer_key) {
        trailerBtn.style.display = 'inline-flex';
        trailerBtn.onclick = () => {
          if (trailerIframe) {
            trailerIframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(show.trailer_key)}?autoplay=1`;
          }
          if (trailerModal) trailerModal.style.display = 'flex';
        };
      } else {
        trailerBtn.style.display = 'none';
      }
    }

    if (trailerClose && trailerModal && trailerIframe) {
      trailerClose.onclick = () => {
        trailerModal.style.display = 'none';
        trailerIframe.src = '';
      };
      trailerModal.onclick = (e) => {
        if (e.target === trailerModal) {
          trailerModal.style.display = 'none';
          trailerIframe.src = '';
        }
      };
    }

    if (detailRating) detailRating.textContent = show.rating ? Number(show.rating).toFixed(1) : 'N/A';
    if (detailYear) detailYear.textContent = show.year || 'N/A';
    const statusLabel = show.status === 'airing' ? 'En Emisión' : (show.status === 'upcoming' ? 'Próximamente' : 'Finalizado');
    if (detailAge) {
      detailAge.textContent = show.age_rating || '';
      const ageItem = detailAge.closest?.('.stat-item');
      if (ageItem) ageItem.style.display = show.age_rating ? '' : 'none';
    }
    if (detailStatusBadge) {
      const isAiring = show.status === 'airing';
      detailStatusBadge.textContent = statusLabel;
      detailStatusBadge.className = `badge ${isAiring ? 'badge-status-airing' : 'badge-subtle'}`;
    }

    // Badges row
    let metaBadgesEl = document.getElementById('detail-meta-badges');
    if (!metaBadgesEl && detailTitle) {
      metaBadgesEl = document.createElement('div');
      metaBadgesEl.id = 'detail-meta-badges';
      metaBadgesEl.className = 'detail-meta-row';
      detailTitle.insertAdjacentElement('afterend', metaBadgesEl);
    }
    if (metaBadgesEl) {
      const genreTags = String(show.genres || '').split(',').map(g => g.trim()).filter(Boolean)
        .map(g => `<span class="detail-genre-tag">${escapeHtml(genreLabel(g))}</span>`).join('');
      metaBadgesEl.innerHTML = `
        ${show.rating ? `<span class="detail-badge-pill"><i data-lucide="star" class="icon-star-badge"></i> ${Number(show.rating).toFixed(1)}</span>` : ''}
        ${show.year ? `<span class="detail-badge-pill" data-meta="year">${escapeHtml(show.year)}</span>` : ''}
        ${show.age_rating ? `<span class="detail-badge-pill">${escapeHtml(show.age_rating)}</span>` : ''}
        <span class="badge ${show.status === 'airing' ? 'badge-status-airing' : 'badge-subtle'}" data-meta="status">${statusLabel}</span>
        ${genreTags}
      `;
    }

    // Cast members
    if (detailCast) {
      let cast = [];
      if (Array.isArray(show.cast_members)) {
        cast = show.cast_members;
      } else if (typeof show.cast_members === 'string') {
        try { cast = JSON.parse(show.cast_members); } catch { cast = []; }
      }
      if (!Array.isArray(cast) || cast.length === 0) {
        detailCast.innerHTML = '<p class="text-muted">Sin información de reparto.</p>';
      } else {
        detailCast.innerHTML = cast.map(c => `
          <div class="cast-chip">
            <span class="cast-character">${escapeHtml(c.character || 'Personaje')}</span>
            <span class="cast-actor">(${escapeHtml(c.name || 'Actor')})</span>
          </div>
        `).join('');
      }
    }

    // Production credits (Estudio, Director, Guionista)
    if (detailStudio) detailStudio.textContent = (show.studio && show.studio.trim()) || '--';
    if (detailDirector) detailDirector.textContent = (show.director && show.director.trim()) || '--';
    if (detailWriter) detailWriter.textContent = (show.writer && show.writer.trim()) || '--';

    // User session for show interactions
    const userSession = (typeof getUserAndProfile === 'function')
      ? getUserAndProfile()
      : { activeUser: 'Guest', profileName: 'Principal', token: '' };
    const activeUser = userSession.activeUser;
    const profileName = userSession.profileName;
    const token = userSession.token;

    // Fetch user progress for this show's episodes
    const showProgressMap = {};
    let lastWatchedEpisodeId = '';
    if (userSession.hasProfile) {
      try {
        const histRes = await fetch(`/api/history?username=${encodeURIComponent(activeUser)}&profile_name=${encodeURIComponent(profileName)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (histRes.ok) {
          const histItems = await histRes.json();
          if (Array.isArray(histItems)) {
            // History is newest first: the latest episode of this show decides the opening season.
            const showEpisodeIds = new Set(episodes.map(ep => String(ep.id)));
            const latest = histItems.find(item => showEpisodeIds.has(String(item.episode_id)));
            if (latest) lastWatchedEpisodeId = String(latest.episode_id);
            histItems.forEach(item => {
              if (item.episode_id) {
                showProgressMap[item.episode_id] = {
                  progress_seconds: item.progress_seconds || item.progress || 0,
                  duration: item.duration || item.ep_duration || 0,
                  completed: Boolean(item.completed)
                };
              }
            });
          }
        }
      } catch (e) {
        console.warn('Could not fetch episode progress:', e);
      }
    }

    // Seasons and episodes
    if (seasonTabs && episodesList) {
      const seasons = {};
      episodes.forEach(ep => {
        const sNum = (ep.season_number !== undefined && ep.season_number !== null && ep.season_number !== '') ? ep.season_number : 1;
        if (!seasons[sNum]) seasons[sNum] = [];
        seasons[sNum].push(ep);
      });

      const seasonNums = Object.keys(seasons).sort((a, b) => {
        const na = parseInt(a, 10);
        const nb = parseInt(b, 10);
        if (!isNaN(na) && !isNaN(nb)) {
          if (na === 0) return 1;
          if (nb === 0) return -1;
          return na - nb;
        }
        return String(a).localeCompare(String(b));
      });

      // Open on the season being watched; otherwise the first regular season.
      const watched = lastWatchedEpisodeId && episodes.find(ep => String(ep.id) === lastWatchedEpisodeId);
      const watchedSeason = watched ? String(watched.season_number ?? 1) : '';
      const defaultSeason = seasons[watchedSeason] ? watchedSeason : (seasons[1] ? '1' : seasonNums[0]);
      const seasonLabel = num => (num === 0 || num === '0') ? 'Especiales' : `Temporada ${num}`;

      // Poster, banner, synopsis, year and status of the selected season.
      const seasonEyebrow = document.getElementById('detail-season-eyebrow');
      const applySeason = num => {
        const info = seasonInfo.get(String(num));
        if (detailPoster) {
          detailPoster.src = catalogueImageUrl((info && info.poster_path) || show.poster_path || '') || '/assets/illustrations/poster_placeholder.svg';
        }
        if (ambientBg && ambientBg.dataset && ambientBg.dataset.seasonArt) {
          const backdropUrl = catalogueImageUrl((info && info.backdrop_path) || show.backdrop_path || show.poster_path || '') || '/assets/illustrations/backdrop_placeholder.svg';
          ambientBg.style.backgroundImage = `url("${backdropUrl}")`;
        }
        if (detailSynopsis) detailSynopsis.textContent = (info && info.synopsis) || show.synopsis || 'Sin sinopsis disponible.';
        if (seasonEyebrow) {
          const extra = info && info.title && info.title !== show.title ? info.title : '';
          seasonEyebrow.textContent = [seasonLabel(num), extra].filter(Boolean).join(' · ');
          seasonEyebrow.hidden = seasonNums.length < 2;
        }
        const year = (info && info.year) || show.year;
        if (detailYear) detailYear.textContent = year || 'N/A';
        const status = (info && info.status) || show.status;
        const label = status === 'airing' ? 'En Emisión' : (status === 'upcoming' ? 'Próximamente' : 'Finalizado');
        const statusClass = `badge ${status === 'airing' ? 'badge-status-airing' : 'badge-subtle'}`;
        if (metaBadgesEl && typeof metaBadgesEl.querySelector === 'function') {
          const yearPill = metaBadgesEl.querySelector('[data-meta="year"]');
          if (yearPill && year) yearPill.textContent = year;
          const statusPill = metaBadgesEl.querySelector('[data-meta="status"]');
          if (statusPill) {
            statusPill.textContent = label;
            statusPill.className = statusClass;
          }
        }
        if (detailStatusBadge) {
          detailStatusBadge.textContent = label;
          detailStatusBadge.className = statusClass;
        }
      };

      // Several seasons with their own art: a row of season posters in watch order instead of pills.
      const seasonStrip = document.getElementById('season-strip');
      const useStrip = Boolean(seasonStrip) && seasonNums.length > 1 && seasonNums.some(num => (seasonInfo.get(String(num)) || {}).poster_path);
      const watchedCount = list => list.filter(ep => {
        const prog = showProgressMap[ep.id];
        if (!prog) return false;
        const dur = prog.duration || ep.duration || 0;
        return prog.completed || (dur > 0 && prog.progress_seconds / dur >= 0.85);
      }).length;

      if (useStrip) {
        seasonTabs.innerHTML = '';
        seasonTabs.hidden = true;
        seasonStrip.hidden = false;
        let order = 0;
        seasonStrip.innerHTML = `
          <div class="season-strip-head">
            <h2 class="section-title">Temporadas</h2>
            <span class="season-strip-hint">en orden para ver</span>
          </div>
          <div class="season-strip-row" role="tablist" aria-label="Temporadas">
            ${seasonNums.map(num => {
              const info = seasonInfo.get(String(num)) || {};
              const list = seasons[num] || [];
              const done = watchedCount(list);
              const pct = list.length ? Math.round((done / list.length) * 100) : 0;
              const poster = catalogueImageUrl(info.poster_path || show.poster_path || '') || '/assets/illustrations/poster_placeholder.svg';
              const meta = [info.year, `${list.length} cap.`].filter(Boolean).join(' · ');
              const active = String(num) === String(defaultSeason);
              const isSpecials = num === 0 || num === '0';
              if (!isSpecials) order++;
              return `
                <button type="button" class="season-tab season-card${active ? ' active' : ''}" role="tab" aria-selected="${active}" data-season="${escapeHtmlAttribute(num)}">
                  <span class="season-card-poster">
                    <img src="${escapeHtmlAttribute(poster)}" alt="" loading="lazy" data-fallback-src="/assets/illustrations/poster_placeholder.svg">
                    ${isSpecials ? '' : `<span class="season-card-order">${order}</span>`}
                    ${pct >= 100 ? '<span class="season-card-done" title="Vista"><i data-lucide="check"></i></span>' : ''}
                    ${pct > 0 && pct < 100 ? `<span class="season-card-progress"><span style="width:${pct}%"></span></span>` : ''}
                  </span>
                  <span class="season-card-name">${escapeHtml(seasonLabel(num))}</span>
                  <span class="season-card-meta">${escapeHtml(meta)}</span>
                </button>`;
            }).join('')}
          </div>`;
        seasonStrip.querySelectorAll('img[data-fallback-src]').forEach(img => {
          img.onerror = () => { img.onerror = null; img.src = img.dataset.fallbackSrc; };
        });
      } else {
        if (seasonStrip) {
          seasonStrip.hidden = true;
          seasonStrip.innerHTML = '';
        }
        seasonTabs.hidden = false;
        seasonTabs.innerHTML = seasonNums.map(num => {
          const isActive = String(num) === String(defaultSeason);
          return `<button class="season-tab ${isActive ? 'active' : ''}" data-season="${escapeHtmlAttribute(num)}">${escapeHtml(seasonLabel(num))}</button>`;
        }).join('');
      }

      applySeason(defaultSeason);
      renderEpisodeList(seasons[defaultSeason] || episodes, episodesList, show.poster_path, showProgressMap);

      const tabRoot = useStrip ? seasonStrip : seasonTabs;
      tabRoot.querySelectorAll('.season-tab').forEach(tab => {
        tab.onclick = () => {
          tabRoot.querySelectorAll('.season-tab').forEach(t => {
            t.classList.remove('active');
            if (t.setAttribute) t.setAttribute('aria-selected', 'false');
          });
          tab.classList.add('active');
          if (tab.setAttribute) tab.setAttribute('aria-selected', 'true');
          const sNum = tab.getAttribute('data-season');
          applySeason(sNum);
          renderEpisodeList(seasons[sNum] || [], episodesList, show.poster_path, showProgressMap);
        };
      });
    }

    // Pre-playback track preferences
    const trackPrefContainer = document.getElementById('detail-track-preferences');
    const audioPillsContainer = document.getElementById('detail-audio-pills');
    const subPillsContainer = document.getElementById('detail-sub-pills');

    if (trackPrefContainer && audioPillsContainer && subPillsContainer) {
      const audioTracksMap = new Map();
      const subTracksMap = new Map();

      const formatTrackLang = (code, rawTitle = '') => {
        const c = String(code || 'und').toLowerCase();
        const map = {
          'jpn': 'Japonés',
          'ja': 'Japonés',
          'spa': 'Español',
          'es': 'Español',
          'es-la': 'Español (Latino)',
          'es-419': 'Español (Latino)',
          'lat': 'Español (Latino)',
          'eng': 'Inglés',
          'en': 'Inglés',
          'por': 'Portugués',
          'pt': 'Portugués',
          'fra': 'Francés',
          'fr': 'Francés',
          'deu': 'Alemán',
          'de': 'Alemán',
          'ita': 'Italiano',
          'it': 'Italiano',
          'kor': 'Coreano',
          'ko': 'Coreano',
          'zho': 'Chino',
          'chi': 'Chino',
          'zh': 'Chino',
          'rus': 'Ruso',
          'ru': 'Ruso'
        };
        const titleLower = String(rawTitle).toLowerCase();
        if (/\b(latino|lat|es-la|es-419|hispanoam[eé]rica|mexico|m[eé]xico)\b/i.test(titleLower)) return 'Español (Latino)';
        if (/\b(castellano|espa[nñ]a|spain|es-es)\b/i.test(titleLower)) return 'Español (España)';
        if (/(?:^|[_\s\-\[\(\/])(?:spa|esp|es|spanish|espa[nñ]ol)(?:$|[_\s\-\]\)\/])/i.test(titleLower) || /\b(?:spanish|espa[nñ]ol)\b/i.test(titleLower)) return 'Español';
        if (/(?:^|[_\s\-\[\(\/])(?:jpn|jap|ja|japanese|japon[eé]s)(?:$|[_\s\-\]\)\/])/i.test(titleLower) || /\b(?:japanese|japon[eé]s)\b/i.test(titleLower)) return 'Japonés';
        if (/(?:^|[_\s\-\[\(\/])(?:eng|en|english|ingl[eé]s)(?:$|[_\s\-\]\)\/])/i.test(titleLower) || /\b(?:english|ingl[eé]s)\b/i.test(titleLower)) return 'Inglés';
        if (/(?:^|[_\s\-\[\(\/])(?:fra|fre|fr|french|franc[eé]s)(?:$|[_\s\-\]\)\/])/i.test(titleLower) || /\b(?:french|franc[eé]s)\b/i.test(titleLower)) return 'Francés';
        if (/(?:^|[_\s\-\[\(\/])(?:deu|ger|de|german|alem[aá]n)(?:$|[_\s\-\]\)\/])/i.test(titleLower) || /\b(?:german|alem[aá]n)\b/i.test(titleLower)) return 'Alemán';
        if (/(?:^|[_\s\-\[\(\/])(?:ita|it|italian|italiano)(?:$|[_\s\-\]\)\/])/i.test(titleLower) || /\b(?:italian|italiano)\b/i.test(titleLower)) return 'Italiano';
        if (/(?:^|[_\s\-\[\(\/])(?:por|pt|portuguese|portugu[eé]s)(?:$|[_\s\-\]\)\/])/i.test(titleLower) || /\b(?:portuguese|portugu[eé]s)\b/i.test(titleLower)) return 'Portugués';

        if (map[c]) return map[c];
        // Strip release tags if title is provided
        const clean = String(rawTitle)
          .replace(/\[[^\]]*\]/g, '')
          .replace(/\([^)]*\)/g, '')
          .replace(/\b(?:gaton|erai-raws|subsplease|horriblesubs|judas|ember|asw|puya|crunchyroll|netflix|animetime)\b/gi, '')
          .replace(/[_\-]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (clean) return clean;
        return c !== 'und' ? c.toUpperCase() : 'Audio';
      };

      const inferTrackLangCode = (t) => {
        let lang = String(t.language || t.lang || 'und').toLowerCase().trim();
        if (/^(?:es[-_](?:la|419|mx|ar|co|cl|pe|us|uy|ve|ec|gt|cu|bo|do|hn|py|sv|ni|cr|pa|pr)|lat)$/i.test(lang)) return 'es-la';
        if (/^(?:es[-_]es)$/i.test(lang)) return 'es';
        if (/^(?:spa|es|spanish|espa[nñ]ol)$/i.test(lang) || lang.startsWith('es-') || lang.startsWith('es_')) return 'spa';
        if (/^(?:jpn|ja|ja[-_]jp|japanese)$/i.test(lang)) return 'jpn';
        if (/^(?:eng|en|en[-_](?:us|gb|ca|au|nz)|english)$/i.test(lang)) return 'eng';
        if (lang === 'und' && t.title) {
          const tl = String(t.title).toLowerCase();
          if (/\b(latino|lat|es-la|es-419)\b/i.test(tl)) return 'es-la';
          if (/\b(castellano|espa[nñ]a|spain|es-es)\b/i.test(tl)) return 'es';
          if (/(?:^|[_\s\-\[\(\/])(?:spa|esp|es|spanish|espa[nñ]ol)(?:$|[_\s\-\]\)\/])/i.test(tl) || /\b(?:spanish|espa[nñ]ol)\b/i.test(tl)) return 'spa';
          if (/(?:^|[_\s\-\[\(\/])(?:jpn|jap|ja|japanese|japon[eé]s)(?:$|[_\s\-\]\)\/])/i.test(tl) || /\b(?:japanese|japon[eé]s)\b/i.test(tl)) return 'jpn';
          if (/(?:^|[_\s\-\[\(\/])(?:eng|en|english|ingl[eé]s)(?:$|[_\s\-\]\)\/])/i.test(tl) || /\b(?:english|ingl[eé]s)\b/i.test(tl)) return 'eng';
        }
        return lang;
      };

      episodes.forEach(ep => {
        let audios = [];
        let subs = [];
        if (ep.audio_tracks) {
          try {
            audios = typeof ep.audio_tracks === 'string' ? JSON.parse(ep.audio_tracks) : ep.audio_tracks;
          } catch {}
        }
        if (ep.subtitle_tracks) {
          try {
            subs = typeof ep.subtitle_tracks === 'string' ? JSON.parse(ep.subtitle_tracks) : ep.subtitle_tracks;
          } catch {}
        }
        if (Array.isArray(audios)) {
          audios.forEach(t => {
            const lang = inferTrackLangCode(t);
            if (!audioTracksMap.has(lang)) {
              audioTracksMap.set(lang, formatTrackLang(lang, t.title));
            }
          });
        }
        if (Array.isArray(subs)) {
          subs.forEach(t => {
            const lang = inferTrackLangCode(t);
            if (!subTracksMap.has(lang)) {
              subTracksMap.set(lang, formatTrackLang(lang, t.title));
            }
          });
        }
      });

      // One untagged audio track and no subtitles (hardsubbed releases) leaves nothing to choose;
      // the box used to show a lone "Pista 1" pill and an empty "Subtítulos:" label.
      const hasAudioChoice = audioTracksMap.size > 1;
      const hasSubChoice = subTracksMap.size > 0;
      const audioGroup = document.getElementById('detail-pref-audio-group');
      const subGroup = document.getElementById('detail-pref-sub-group');
      if (audioGroup) audioGroup.style.display = hasAudioChoice ? '' : 'none';
      if (subGroup) subGroup.style.display = hasSubChoice ? '' : 'none';

      if (hasAudioChoice || hasSubChoice) {
        trackPrefContainer.style.display = 'flex';

        const languagePrefs = readLanguagePrefs(localStorage, window.userPreferences);
        let currentAudioPref = languagePrefs.audio;
        let currentSubPref = languagePrefs.subtitle;

        // Render Audio Pills
        if (audioTracksMap.size > 0) {
          const audioKeys = Array.from(audioTracksMap.keys());
          if (!audioTracksMap.has(currentAudioPref)) {
            currentAudioPref = audioKeys[0];
          }
          audioPillsContainer.innerHTML = audioKeys.map(lang => `
            <button type="button" class="detail-pref-pill ${lang === currentAudioPref ? 'active' : ''}" data-pref-type="audio" data-lang="${escapeHtmlAttribute(lang)}">
              ${escapeHtml(audioTracksMap.get(lang))}
            </button>
          `).join('');

          audioPillsContainer.querySelectorAll('.detail-pref-pill').forEach(pill => {
            pill.onclick = () => {
              audioPillsContainer.querySelectorAll('.detail-pref-pill').forEach(p => p.classList.remove('active'));
              pill.classList.add('active');
              const lang = pill.getAttribute('data-lang');
              localStorage.setItem('kura_pref_audio_lang', lang);
              localStorage.setItem('kurastream_preferred_audio_language', lang);
              if (window.userPreferences) {
                window.userPreferences.preferred_audio_language = lang;
              }
              showToast(`Preferencia de audio: ${audioTracksMap.get(lang)}`, 'info', 1500);
            };
          });
        }

        // Render Subtitle Pills
        if (subTracksMap.size > 0) {
          const subKeys = Array.from(subTracksMap.keys());
          if (!subTracksMap.has(currentSubPref)) {
            currentSubPref = subKeys[0];
          }
          let subHtml = `
            <button type="button" class="detail-pref-pill ${currentSubPref === 'off' ? 'active' : ''}" data-pref-type="sub" data-lang="off">
              Desactivados
            </button>
          `;
          subHtml += subKeys.map(lang => `
            <button type="button" class="detail-pref-pill ${lang === currentSubPref ? 'active' : ''}" data-pref-type="sub" data-lang="${escapeHtmlAttribute(lang)}">
              ${escapeHtml(subTracksMap.get(lang))}
            </button>
          `).join('');

          subPillsContainer.innerHTML = subHtml;

          subPillsContainer.querySelectorAll('.detail-pref-pill').forEach(pill => {
            pill.onclick = () => {
              subPillsContainer.querySelectorAll('.detail-pref-pill').forEach(p => p.classList.remove('active'));
              pill.classList.add('active');
              const lang = pill.getAttribute('data-lang');
              localStorage.setItem('kura_pref_sub_lang', lang);
              localStorage.setItem('kurastream_preferred_subtitle_language', lang);
              if (window.userPreferences) {
                window.userPreferences.preferred_subtitle_language = lang;
              }
              showToast(`Preferencia de subtítulos: ${lang === 'off' ? 'Desactivados' : (subTracksMap.get(lang) || lang)}`, 'info', 1500);
            };
          });
        }
      } else {
        trackPrefContainer.style.display = 'none';
      }
    }

    // Favorite Button Wiring
    const favBtn = document.getElementById('detail-favorite-btn');
    const favText = document.getElementById('detail-favorite-text');
    const favIcon = document.getElementById('detail-favorite-icon');

    const updateFavoriteUI = (isFav) => {
      if (favText) favText.textContent = isFav ? 'En mi Lista' : 'Añadir a mi Lista';
      if (favBtn) {
        if (isFav) {
          favBtn.classList.add('btn-favorite-active');
          favBtn.style.borderColor = 'var(--accent-color)';
          favBtn.style.color = 'var(--accent-color)';
        } else {
          favBtn.classList.remove('btn-favorite-active');
          favBtn.style.borderColor = '';
          favBtn.style.color = '';
        }
      }
      if (favIcon) {
        favIcon.setAttribute('fill', isFav ? 'currentColor' : 'none');
      }
    };

    if (userSession.hasProfile) {
      try {
        const favCheckRes = await fetch(`/api/favorites/check?show_id=${encodeURIComponent(id)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (favCheckRes.ok) {
          const favData = await favCheckRes.json();
          updateFavoriteUI(Boolean(favData && favData.favorited));
        }
      } catch {}
    } else {
      updateFavoriteUI(false);
    }

    const hasAuth = typeof AuthManager !== 'undefined';
    const isUserAuth = hasAuth && typeof AuthManager.isAuthenticated === 'function' ? AuthManager.isAuthenticated() : Boolean(token);
    const getAuthUser = () => (hasAuth && typeof AuthManager.getUser === 'function' ? AuthManager.getUser() : null);
    const getAuthProfile = () => (hasAuth && typeof AuthManager.getActiveProfile === 'function' ? AuthManager.getActiveProfile() : null);
    const getAuthToken = () => (hasAuth && typeof AuthManager.getToken === 'function' ? AuthManager.getToken() : (token || ''));
    const safeToast = (msg, type, dur) => { if (typeof showToast === 'function') showToast(msg, type, dur); };
    const safeOpenLogin = () => { if (typeof openAuthModal === 'function') openAuthModal('login'); };

    if (favBtn) {
      favBtn.onclick = async () => {
        if (!isUserAuth) {
          safeToast('Inicia sesión para agregar a tu lista', 'warning');
          safeOpenLogin();
          return;
        }
        favBtn.disabled = true;
        try {
          const res = await fetch('/api/favorites', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({ show_id: id })
          });
          if (res.ok) {
            const data = await res.json();
            const nowFav = Boolean(data && data.favorited);
            updateFavoriteUI(nowFav);
            safeToast(nowFav ? 'Agregado a tu lista' : 'Eliminado de tu lista', 'info');
          } else {
            safeToast('No se pudo actualizar tu lista', 'error');
          }
        } catch {
          safeToast('Error de red al actualizar tu lista', 'error');
        } finally {
          favBtn.disabled = false;
        }
      };
    }

    // Comments Section Wiring
    const user = getAuthUser();
    const activeProfile = getAuthProfile();
    const commentUserAvatar = document.getElementById('comment-user-avatar');
    const commentAuthorName = document.getElementById('comment-author-name');
    const commentGuestNotice = document.getElementById('comment-guest-notice');
    const commentsListContainer = document.getElementById('comments-list');
    const commentTextarea = document.getElementById('comment-textarea');
    const btnSubmitComment = document.getElementById('btn-submit-comment');

    if (user) {
      const displayName = (activeProfile && activeProfile.name) ? `${user.username} (${activeProfile.name})` : user.username;
      const initial = ((activeProfile && activeProfile.name) || user.username || 'U')[0].toUpperCase();
      if (commentAuthorName) commentAuthorName.textContent = displayName;
      if (commentUserAvatar) {
        if (activeProfile && activeProfile.avatar) {
          commentUserAvatar.textContent = '';
          commentUserAvatar.style.backgroundImage = cssUrl(activeProfile.avatar);
          commentUserAvatar.style.backgroundSize = 'cover';
          commentUserAvatar.style.backgroundPosition = 'center';
        } else {
          commentUserAvatar.style.backgroundImage = 'none';
          commentUserAvatar.style.backgroundColor = (activeProfile && activeProfile.color) || 'var(--accent-color)';
          commentUserAvatar.textContent = initial;
        }
      }
      if (commentGuestNotice) {
        commentGuestNotice.innerHTML = `Comentarás como <strong id="comment-author-name" class="text-accent">${escapeHtml(displayName)}</strong>.`;
      }
    } else {
      if (commentAuthorName) commentAuthorName.textContent = 'Invitado';
      if (commentUserAvatar) {
        commentUserAvatar.style.backgroundImage = 'none';
        commentUserAvatar.style.backgroundColor = '';
        commentUserAvatar.textContent = '?';
      }
      if (commentGuestNotice) {
        commentGuestNotice.innerHTML = `Comentarás como <strong id="comment-author-name" class="text-accent">Invitado</strong>. Inicia sesión para usar tu cuenta.`;
      }
    }

    const loadComments = async () => {
      if (!commentsListContainer) return;
      commentsListContainer.innerHTML = '<div class="state-box-loading">Cargando comentarios...</div>';
      try {
        const cData = await fetchJson(`/api/comments?show_id=${encodeURIComponent(id)}`);
        const comments = Array.isArray(cData.comments) ? cData.comments : [];
        if (comments.length === 0) {
          commentsListContainer.innerHTML = '<div class="empty-state text-muted" style="padding: 24px 0; text-align: center;">No hay comentarios todavía. ¡Sé el primero en comentar!</div>';
          return;
        }
        commentsListContainer.innerHTML = comments.map(c => {
          // The API deliberately does not send account (login) names; comments show the profile name.
          const author = c.profile_name || 'Usuario';
          const initial = (c.profile_name || 'U')[0].toUpperCase();
          const dateStr = c.created_at ? new Date(c.created_at).toLocaleDateString() : '';
          const avatarAttrs = c.avatar
            ? `data-bg-image="${escapeHtmlAttribute(c.avatar)}"`
            : `data-bg-color="${escapeHtmlAttribute(c.avatar_color || '')}"`;
          const avatarContent = c.avatar ? '' : escapeHtml(initial);
          return `
            <div class="comment-item" style="display: flex; gap: 12px; margin-bottom: 16px; padding: 12px; background: var(--surface-control); border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
              <div class="user-avatar-initial" style="width: 36px; height: 36px; font-size: 0.9rem; flex-shrink: 0;" ${avatarAttrs}>${avatarContent}</div>
              <div style="flex: 1;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <strong style="color: var(--text-main); font-size: 0.9rem;">${escapeHtml(author)}</strong>
                  <span style="color: var(--text-muted); font-size: 0.75rem;">${escapeHtml(dateStr)}</span>
                </div>
                <p style="color: var(--text-secondary); font-size: 0.85rem; margin: 0; white-space: pre-wrap;">${escapeHtml(c.content)}</p>
              </div>
            </div>
          `;
        }).join('');
        applyDynamicBackgrounds(commentsListContainer);
      } catch (error) {
        renderLoadErrorState(commentsListContainer, error, 'los comentarios', loadComments);
      }
    };

    await loadComments();

    if (btnSubmitComment && commentTextarea) {
      btnSubmitComment.onclick = async () => {
        const content = commentTextarea.value.trim();
        if (!content) {
          safeToast('Escribe un comentario antes de enviar', 'warning');
          return;
        }
        if (!isUserAuth) {
          safeToast('Debes iniciar sesión para comentar', 'warning');
          safeOpenLogin();
          return;
        }
        btnSubmitComment.disabled = true;
        try {
          const res = await fetch('/api/comments', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({
              show_id: id,
              content
            })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            commentTextarea.value = '';
            safeToast('Comentario publicado', 'success');
            await loadComments();
          } else {
            safeToast(data.error || 'Error al publicar comentario', 'error');
          }
        } catch {
          safeToast('Error de red al publicar comentario', 'error');
        } finally {
          btnSubmitComment.disabled = false;
        }
      };
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
    loadPopularSidebar(id).catch(() => {});
  } catch (err) {
    console.error('Error loading show details:', err);
    if (detailTitle) detailTitle.textContent = 'Error';
  }
}

/**
 * Shows why a list could not be loaded (no connection, expired session, server error) with the right action,
 * instead of the "empty" illustration that made a failure look like the user having no data.
 */
function renderLoadErrorState(container, error, what, retry) {
  const info = loadErrorState(error, what);
  const icon = info.kind === 'network' ? 'wifi-off' : (info.kind === 'auth' ? 'user' : 'triangle-alert');
  container.innerHTML = `
    <div class="empty-state-card col-span-all load-error-state" role="alert" data-error-kind="${escapeHtmlAttribute(info.kind)}">
      <h3><i data-lucide="${icon}"></i> ${escapeHtml(info.title)}</h3>
      <p>${escapeHtml(info.message)}</p>
      ${info.retry ? '<button type="button" class="btn btn-primary" data-action="retry-load"><i data-lucide="refresh-cw"></i> Reintentar</button>' : ''}
      ${info.login ? '<button type="button" class="btn btn-primary" data-action="login-again"><i data-lucide="user"></i> Iniciar sesión</button>' : ''}
    </div>
  `;
  const retryBtn = container.querySelector('[data-action="retry-load"]');
  if (retryBtn && typeof retry === 'function') retryBtn.onclick = retry;
  const loginBtn = container.querySelector('[data-action="login-again"]');
  if (loginBtn) loginBtn.onclick = () => openAuthModal('login');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderLoginRequiredState(container, title, message, illustration) {
  const needsProfileOnly = AuthManager.isAuthenticated();
  container.innerHTML = `
    <div class="empty-state-card col-span-all">
      <img src="${escapeHtmlAttribute(illustration)}" alt="" class="empty-state-img">
      <h3>${escapeHtml(needsProfileOnly ? 'Selecciona un perfil' : title)}</h3>
      <p>${escapeHtml(message)}</p>
      <button class="btn btn-primary" data-action="login-required"><i data-lucide="user"></i> ${needsProfileOnly ? 'Elegir Perfil' : 'Iniciar Sesión'}</button>
    </div>
  `;
  const btnLogin = container.querySelector('[data-action="login-required"]');
  if (btnLogin) {
    btnLogin.onclick = () => {
      if (needsProfileOnly) window.location.hash = '#/profiles';
      else openAuthModal('login');
    };
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

export async function renderMyListView() {
  const container = document.getElementById('mylist-grid');
  if (!container) return;
  const generation = navigationGeneration;

  container.innerHTML = `<div class="shows-grid"><div class="show-card skeleton" style="height:250px;"></div><div class="show-card skeleton" style="height:250px;"></div><div class="show-card skeleton" style="height:250px;"></div><div class="show-card skeleton" style="height:250px;"></div></div>`;
  const { activeUser, profileName, token, hasProfile } = getUserAndProfile();
  let favorites = [];

  if (!hasProfile) {
    renderLoginRequiredState(container, 'Inicia sesión para ver tu lista', 'Guarda tus series y películas favoritas para encontrarlas fácilmente en cualquier momento.', '/assets/illustrations/empty_watchlist.svg');
    return;
  }

  try {
    favorites = await fetchJson(`/api/favorites?username=${encodeURIComponent(activeUser)}&profile_name=${encodeURIComponent(profileName)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (error) {
    if (generation !== navigationGeneration) return;
    renderLoadErrorState(container, error, 'tu lista', renderMyListView);
    return;
  }
  if (generation !== navigationGeneration) return;

  if (!Array.isArray(favorites) || favorites.length === 0) {
    container.innerHTML = `
      <div class="empty-state-card col-span-all">
        <img src="/assets/illustrations/empty_watchlist.svg" alt="" class="empty-state-img">
        <h3>Tu lista está vacía</h3>
        <p>Guarda tus series y películas favoritas para encontrarlas fácilmente en cualquier momento.</p>
        <a href="#/" class="btn btn-primary"><i data-lucide="compass"></i> Explorar Catálogo</a>
      </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  // "Ordenar por" had no handler; the API returns favourites newest first ("Recientes").
  const sortSelect = document.getElementById('mylist-sort');
  const renderSorted = () => {
    const mode = sortSelect ? sortSelect.value : 'recent';
    mylistSortValue = mode;
    const list = [...favorites];
    if (mode === 'title_asc') list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'es'));
    else if (mode === 'rating_desc') list.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
    else if (mode === 'year_desc') list.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
    container.innerHTML = list.map(s => createShowCardHTML(s)).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };
  if (sortSelect) {
    sortSelect.value = mylistSortValue;
    sortSelect.onchange = renderSorted;
  }
  renderSorted();
}

export async function renderHistoryView() {
  const container = document.getElementById('history-list');
  if (!container) return;
  const generation = navigationGeneration;

  container.innerHTML = `<div class="history-list-container"><div class="history-item skeleton" style="height:80px;"></div><div class="history-item skeleton" style="height:80px;"></div><div class="history-item skeleton" style="height:80px;"></div></div>`;
  const { activeUser, profileName, token, hasProfile } = getUserAndProfile();
  let historyItems = [];
  const clearBtn = document.getElementById('btn-clear-history');
  if (clearBtn) clearBtn.style.display = 'none';

  if (!hasProfile) {
    renderLoginRequiredState(container, 'Inicia sesión para ver tu historial', 'Los episodios y películas que reproduzcas aparecerán aquí para que continúes donde los dejaste.', '/assets/illustrations/empty_history.svg');
    return;
  }

  try {
    const headers = { 'Authorization': `Bearer ${token}` };
    historyItems = await fetchJson(`/api/history?username=${encodeURIComponent(activeUser)}&profile_name=${encodeURIComponent(profileName)}`, { headers });
  } catch (error) {
    if (generation !== navigationGeneration) return;
    renderLoadErrorState(container, error, 'tu historial', renderHistoryView);
    return;
  }
  if (generation !== navigationGeneration) return;

  if (!Array.isArray(historyItems) || historyItems.length === 0) {
    container.innerHTML = `
      <div class="empty-state-card">
        <img src="/assets/illustrations/empty_history.svg" alt="" class="empty-state-img">
        <h3>Tu historial está despejado</h3>
        <p>Los episodios y películas que reproduzcas aparecerán aquí para que continúes donde los dejaste.</p>
        <a href="#/" class="btn btn-primary"><i data-lucide="compass"></i> Explorar Catálogo</a>
      </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  if (clearBtn) clearBtn.style.display = '';
  container.innerHTML = historyItems.map(item => {
    const poster = item.thumbnail_path || item.poster_path || '';
    const progressPercent = item.duration > 0 ? Math.min(100, Math.round(((item.progress_seconds || 0) / item.duration) * 100)) : 0;
    const showTitle = item.show_title || item.title || '';
    const epTitle = item.episode_title || item.title || `Episodio ${item.episode_number || ''}`;
    const seasonEpStr = item.season_number && item.episode_number ? `T${item.season_number} E${item.episode_number}` : (item.episode_number ? `Ep. ${item.episode_number}` : '');

    return `
      <div class="history-item">
        <img src="${escapeHtmlAttribute(catalogueImageUrl(poster) || '/assets/illustrations/backdrop_placeholder.svg')}" alt="${escapeHtmlAttribute(showTitle)}">
        <div class="history-item-info">
          <h4>${escapeHtml(showTitle)}</h4>
          <span>${escapeHtml(seasonEpStr ? seasonEpStr + ' - ' : '')}${escapeHtml(epTitle)} • ${progressPercent}% visto</span>
          <div class="history-progress"><div class="history-progress-bar" style="width: ${progressPercent}%;"></div></div>
        </div>
        <div class="history-item-actions">
          <a href="${escapeHtmlAttribute('#/player/' + encodeURIComponent(item.episode_id))}" class="btn btn-secondary">${item.completed ? 'Volver a ver' : 'Continuar'}</a>
          <button type="button" class="history-remove-btn" data-remove-episode="${escapeHtmlAttribute(item.episode_id)}" aria-label="Quitar del historial" title="Quitar del historial"><i data-lucide="x"></i></button>
        </div>
      </div>
    `;
  }).join('');

  const deleteHistory = async (query) => {
    const res = await fetch(`/api/history?${query}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) throw new Error(String(res.status));
  };
  container.querySelectorAll('[data-remove-episode]').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await deleteHistory(`episode_id=${encodeURIComponent(btn.dataset.removeEpisode)}`);
        renderHistoryView();
      } catch {
        btn.disabled = false;
        showToast('No se pudo quitar del historial', 'error');
      }
    };
  });
  if (clearBtn) {
    clearBtn.onclick = async () => {
      if (!confirm('¿Borrar todo el historial de este perfil? También se reinicia "Continuar viendo".')) return;
      clearBtn.disabled = true;
      try {
        await deleteHistory('clear=all');
        showToast('Historial borrado', 'success');
        renderHistoryView();
      } catch {
        showToast('No se pudo borrar el historial', 'error');
      } finally {
        clearBtn.disabled = false;
      }
    };
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

export async function loadPopularSidebar(currentShowId) {
  const popularSidebar = document.getElementById('detail-popular-sidebar');
  if (!popularSidebar) return;

  try {
    const allShows = await loadCatalog();
    const isTestShow = (s) => {
      const id = String(s.id || '').toLowerCase();
      const title = String(s.title || '').toLowerCase();
      return id.startsWith('show_pin_test')
        || id.startsWith('test_')
        || id.startsWith('show_party_')
        || id.startsWith('notif_show')
        || id.startsWith('show_sec_')
        || id.startsWith('mock_')
        || id.endsWith('_test')
        || id.includes('_test_')
        || /\btest\b/i.test(title);
    };
    const popularShows = (Array.isArray(allShows) ? allShows : (allShows.shows || []))
      .filter(s => s.id !== currentShowId && !isTestShow(s))
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 5);

    if (popularShows.length === 0) {
      popularSidebar.style.display = 'none';
      return;
    }

    popularSidebar.style.display = '';
    popularSidebar.innerHTML = `
      <h3 class="section-title section-title-compact">Populares</h3>
      ${popularShows.map(s => `
        <a class="popular-item" href="${escapeHtmlAttribute('#/show/' + encodeURIComponent(s.id))}" data-catalogue-route="${escapeHtmlAttribute('#/show/' + encodeURIComponent(s.id))}">
          <img class="popular-item-img" src="${escapeHtmlAttribute(catalogueImageUrl(s.poster_path || ''))}" alt="${escapeHtmlAttribute(s.title)}">
          <div class="popular-item-info">
            <h4 class="popular-item-title">${escapeHtml(s.title)}</h4>
            <span class="popular-item-rating">${(s.rating && Number(s.rating) > 0) ? `<i data-lucide="star"></i> ${Number(s.rating).toFixed(1)}` : '<span>N/A</span>'}</span>
          </div>
        </a>
      `).join('')}
    `;
  } catch {
    popularSidebar.style.display = 'none';
  }
}

const CALENDAR_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CALENDAR_UNSCHEDULED = 'TBA';
let calendarOnlyLibrary = false;

function calendarItems(dayName) {
  const list = Array.isArray(calendarDataCache[dayName]) ? calendarDataCache[dayName] : [];
  return calendarOnlyLibrary ? list.filter(item => item.in_library) : list;
}

/** "Episodio 5 · 19:30 · Studio": the row tooltip. */
function calendarCardMeta(item) {
  const parts = [];
  if (item.episode) parts.push(`Episodio ${item.episode}`);
  if (item.airing_at) {
    const time = new Date(Number(item.airing_at) * 1000);
    if (!Number.isNaN(time.getTime())) parts.push(time.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }));
  }
  if (item.studio) parts.push(item.studio);
  return parts.join(' · ');
}

function calendarTime(item) {
  if (!item.airing_at) return '—';
  const time = new Date(Number(item.airing_at) * 1000);
  return Number.isNaN(time.getTime()) ? '—' : time.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

/** Day tabs show how many titles air that day; the "Por confirmar" tab only exists when needed. */
function renderCalendarTabCounts() {
  const tabs = document.getElementById('day-picker-tabs');
  if (!tabs) return;
  tabs.querySelectorAll('.day-tab').forEach(tab => {
    const day = tab.getAttribute('data-day');
    const count = calendarItems(day).length;
    if (day === CALENDAR_UNSCHEDULED) tab.hidden = count === 0;
    let badge = tab.querySelector('.day-tab-count');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'day-tab-count';
      tab.appendChild(badge);
    }
    badge.textContent = String(count);
  });
}

/** One table per day: hour, title, episode, studio and whether it is already in the library. */
export function renderCalendarDay(dayName) {
  const gridContainer = document.getElementById('calendar-grid-content');
  if (!gridContainer || !calendarDataCache) return;

  const showsList = calendarItems(dayName);

  if (showsList.length === 0) {
    const title = calendarOnlyLibrary ? 'Ningún anime de tu biblioteca se emite este día' : 'No hay estrenos programados para este día';
    gridContainer.innerHTML = `
      <div class="empty-state">
        <i data-lucide="calendar-off"></i>
        <h2>${escapeHtml(title)}</h2>
      </div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  const nowSec = Date.now() / 1000;
  const rows = showsList.map(item => {
    const localId = item.local_show_id || item.library_show_id;
    const hasLocal = Boolean(item.in_library && localId);
    const route = hasLocal ? '#/show/' + encodeURIComponent(localId) : '';
    const aired = item.airing_at && Number(item.airing_at) < nowSec;
    const cover = catalogueImageUrl(item.cover_image || '') || '/assets/illustrations/poster_placeholder.svg';
    const subtitle = item.romaji_title && item.romaji_title !== item.title ? item.romaji_title : (item.genres || '');
    const titleHtml = hasLocal
      ? `<a href="${escapeHtmlAttribute(route)}">${escapeHtml(item.title || '')}</a>`
      : `<strong>${escapeHtml(item.title || '')}</strong>`;
    const status = hasLocal
      ? '<span class="calendar-status is-library"><i data-lucide="check"></i> En tu biblioteca</span>'
      : '<span class="calendar-status is-external">No disponible</span>';
    return `
      <tr class="${hasLocal ? 'is-linked' : ''}${aired ? ' is-aired' : ''}" title="${escapeHtmlAttribute(calendarCardMeta(item))}"${hasLocal ? ` data-catalogue-route="${escapeHtmlAttribute(route)}"` : ''}>
        <td class="calendar-cell-time"><span class="calendar-time">${escapeHtml(calendarTime(item))}</span></td>
        <td class="calendar-cell-title">
          <div class="calendar-title-cell">
            <img src="${escapeHtmlAttribute(cover)}" alt="" loading="lazy" data-fallback-src="/assets/illustrations/poster_placeholder.svg">
            <div class="calendar-title-text">${titleHtml}${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ''}</div>
          </div>
        </td>
        <td class="calendar-cell-episode">${item.episode ? `Episodio ${escapeHtml(String(item.episode))}` : '—'}</td>
        <td class="calendar-cell-studio">${escapeHtml(item.studio || '—')}</td>
        <td class="calendar-cell-status">${status}</td>
      </tr>`;
  }).join('');

  const note = dayName === CALENDAR_UNSCHEDULED
    ? '<p class="calendar-note">Animes de tu biblioteca marcados como "en emisión" cuyo día aún no se conoce (el servidor no tiene conexión con AniList).</p>'
    : '';

  gridContainer.innerHTML = `
    <div class="calendar-table-wrap">
      <table class="calendar-table">
        <thead>
          <tr>
            <th class="calendar-col-time">Hora</th>
            <th>Anime</th>
            <th class="calendar-col-episode">Episodio</th>
            <th class="calendar-col-studio">Estudio</th>
            <th class="calendar-col-status">Estado</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${note}
  `;

  // Linked rows navigate through the shared [data-catalogue-route] click handler.
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

export async function openRandomAnimeModal() {
  const modal = document.getElementById('random-modal');
  const cardBody = document.getElementById('random-card-body');
  if (!modal || !cardBody) return;

  // The × had no handler, so the modal could only be left through "Ver Anime".
  if (!modal._kuraCloseWired) {
    modal._kuraCloseWired = true;
    const close = () => { modal.style.display = 'none'; };
    if (typeof lucide !== 'undefined') lucide.createIcons();
    document.getElementById('btn-close-random')?.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.style.display !== 'none') close();
    });
  }

  modal.style.display = 'flex';
  cardBody.className = 'random-card';
  cardBody.innerHTML = `<div class="state-box"><div class="spinner"></div>Buscando anime aleatorio...</div>`;

  try {
    const res = await fetch('/api/shows/random');
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const show = data.show || data;
    if (!show || !show.id) throw new Error('empty');

    const poster = catalogueImageUrl(show.poster_path || '') || '/assets/illustrations/poster_placeholder.svg';
    const backdrop = catalogueImageUrl(show.backdrop_path || '');
    const meta = [];
    if (Number(show.rating) > 0) meta.push(`<span><i data-lucide="star"></i>${escapeHtml(Number(show.rating).toFixed(1))}</span>`);
    if (show.year) meta.push(`<span>${escapeHtml(String(show.year))}</span>`);
    if (show.status === 'airing') meta.push('<span>En emisión</span>');
    String(show.genres || '').split(',').map(g => g.trim()).filter(Boolean).slice(0, 3)
      .forEach(g => meta.push(`<span>${escapeHtml(genreLabel(g))}</span>`));

    cardBody.innerHTML = `
      <div class="random-hero">
        ${backdrop ? `<img class="random-hero-backdrop" src="${escapeHtmlAttribute(backdrop)}" alt="">` : ''}
        <img src="${escapeHtmlAttribute(poster)}" alt="${escapeHtmlAttribute(show.title || '')}" class="random-poster-img" data-fallback-src="/assets/illustrations/poster_placeholder.svg">
        <div class="random-info">
          <p class="random-kicker">Descubrimiento aleatorio</p>
          <h3 class="random-title">${escapeHtml(show.title || '')}</h3>
          ${meta.length ? `<div class="random-meta">${meta.join('')}</div>` : ''}
          <p class="random-synopsis">${escapeHtml(show.synopsis || 'Sin sinopsis disponible.')}</p>
          <div class="random-actions">
            <a class="btn btn-primary" id="random-card-watch-btn" href="${escapeHtmlAttribute('#/show/' + encodeURIComponent(show.id))}"><i data-lucide="info"></i> Ver anime</a>
            <button type="button" class="btn btn-secondary" id="random-card-again-btn"><i data-lucide="shuffle"></i> Otro al azar</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('random-card-watch-btn')?.addEventListener('click', () => {
      modal.style.display = 'none';
    });
    document.getElementById('random-card-again-btn')?.addEventListener('click', () => openRandomAnimeModal());
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch {
    cardBody.innerHTML = `<div class="state-box state-box-error">Error al buscar anime aleatorio.</div>`;
  }
}

export function formatWatchTime(totalSeconds) {
  const sec = Math.max(0, parseInt(totalSeconds, 10) || 0);
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);

  if (hours > 0 && minutes > 0) {
    return `${hours} h ${minutes} min`;
  } else if (hours > 0) {
    return `${hours} h`;
  } else if (minutes > 0) {
    return `${minutes} min`;
  } else {
    return '0 min';
  }
}

export async function renderStatsView() {
  const cardsGrid = document.getElementById('stats-cards-grid');
  const chartContainer = document.getElementById('stats-genre-chart');
  if (!cardsGrid || !chartContainer) return;
  const generation = navigationGeneration;

  const { activeUser, profileName, token, hasProfile } = getUserAndProfile();
  const chartCard = document.getElementById('stats-chart-card');
  if (!hasProfile) {
    renderLoginRequiredState(cardsGrid, 'Inicia sesión para ver tus estadísticas', 'Tu tiempo de visionado, capítulos vistos y géneros favoritos se calculan por perfil.', '/assets/illustrations/empty_history.svg');
    chartContainer.innerHTML = '';
    if (chartCard) chartCard.style.display = 'none';
    return;
  }
  if (chartCard) chartCard.style.display = '';

  cardsGrid.innerHTML = '<div class="state-box col-span-all"><div class="spinner"></div>Cargando estadísticas...</div>';
  chartContainer.innerHTML = '<div class="state-box">Cargando gráfico...</div>';

  let stats = {
    total_time_seconds: 0,
    completed_shows: 0,
    watched_episodes: 0,
    top_genre: 'Ninguno',
    genres_breakdown: {}
  };

  try {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const data = await fetchJson(`/api/user/stats?username=${encodeURIComponent(activeUser)}&profile_name=${encodeURIComponent(profileName)}`, { headers });
    stats = data.stats || data || stats;
    if (generation !== navigationGeneration) return;
  } catch (error) {
    if (generation !== navigationGeneration) return;
    renderLoadErrorState(cardsGrid, error, 'tus estadísticas', renderStatsView);
    chartContainer.innerHTML = '';
    if (chartCard) chartCard.style.display = 'none';
    return;
  }

  const formattedTime = formatWatchTime(stats.total_time_seconds || 0);
  cardsGrid.innerHTML = `
    <div class="stat-card">
      <span class="stat-card-label">Tiempo Total</span>
      <div class="stat-card-value text-info">${escapeHtml(formattedTime)}</div>
    </div>
    <div class="stat-card">
      <span class="stat-card-label">Capítulos Vistos</span>
      <div class="stat-card-value text-accent">${stats.watched_episodes || 0}</div>
    </div>
    <div class="stat-card">
      <span class="stat-card-label">Series Completadas</span>
      <div class="stat-card-value text-success">${stats.completed_shows || 0}</div>
    </div>
  `;

  // Top genres as proportional bars (the card used to show only the favourite genre's name)
  const breakdown = Object.entries(stats.genres_breakdown || {})
    .map(([genre, value]) => [genre, Number(value) || 0])
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  if (breakdown.length === 0) {
    chartContainer.innerHTML = '<p class="stat-genre-pill">Todavía no hay suficiente actividad para calcular tus géneros.</p>';
  } else {
    const max = breakdown[0][1];
    const total = breakdown.reduce((sum, [, value]) => sum + value, 0);
    chartContainer.innerHTML = `
      <div class="genre-bars">
        ${breakdown.map(([genre, value]) => `
          <div class="genre-bar-row">
            <span class="genre-bar-label">${escapeHtml(genreLabel(genre))}</span>
            <div class="genre-bar-track"><div class="genre-bar-fill" style="width: ${Math.max(4, Math.round((value / max) * 100))}%;"></div></div>
            <span class="genre-bar-value">${Math.round((value / total) * 100)}%</span>
          </div>
        `).join('')}
      </div>`;
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

export async function loadNotifications() {
  const badge = document.getElementById('notification-badge');
  const list = document.getElementById('notifications-list');

  const { activeUser, profileName, token, hasProfile } = getUserAndProfile();
  let notifications = [];
  let unreadCount = 0;

  try {
    // Notifications are per profile; guests would only get a 401.
    const res = hasProfile
      ? await fetch(`/api/notifications?username=${encodeURIComponent(activeUser)}&profile_name=${encodeURIComponent(profileName)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      : null;
    if (res && res.ok) {
      const data = await res.json();
      notifications = Array.isArray(data) ? data : (data.notifications || []);
      unreadCount = (typeof data.unread_count === 'number') ? data.unread_count : notifications.length;
    }
  } catch (err) {
    console.error("Error loading notifications:", err);
  }

  // Settings toggle "Notificaciones en la aplicación": keep the list, but stop the unread badge.
  if (typeof window !== 'undefined' && window.userPreferences && window.userPreferences.notifications_enabled === false) {
    unreadCount = 0;
  }

  if (badge) {
    if (unreadCount > 0) {
      badge.textContent = unreadCount;
      badge.style.display = 'inline-flex';
    } else {
      badge.textContent = '0';
      badge.style.display = 'none';
    }
  }

  if (list) {
    if (notifications.length === 0) {
      list.innerHTML = `<div class="notification-empty">No hay notificaciones sin leer</div>`;
    } else {
      list.innerHTML = notifications.map(item => {
        const epNum = item.episode_number || item.episode || 1;
        const seasonNum = item.season_number || item.season || '';
        const title = item.show_title || item.title || 'Nuevo episodio';
        const poster = item.poster_path || `/api/placeholder-poster?title=${encodeURIComponent(title)}`;
        const targetHash = item.episode_id ? `#/player/${encodeURIComponent(item.episode_id)}` : `#/show/${encodeURIComponent(item.show_id)}`;

        const isUnread = !!item.is_unread;
        const readClass = isUnread ? '' : ' notification-item-read';

        return `
          <a href="${escapeHtmlAttribute(targetHash)}" class="notification-item${readClass}" data-show-id="${escapeHtmlAttribute(item.show_id || '')}" data-episode-id="${escapeHtmlAttribute(item.episode_id || '')}">
            <img src="${escapeHtmlAttribute(catalogueImageUrl(poster))}" alt="${escapeHtmlAttribute(title)}" class="notification-poster" data-fallback-src="/api/placeholder-poster?title=Show">
            <div class="notification-info">
              <span class="notification-title">${escapeHtml(title)}</span>
              <span class="notification-ep">Episodio ${escapeHtml(epNum)} ${escapeHtml(seasonNum ? `(Temporada ${seasonNum})` : '')}</span>
              <span class="notification-time">${escapeHtml(item.message || 'Nuevo lanzamiento disponible')}</span>
            </div>
          </a>
        `;
      }).join('');

      list.querySelectorAll('.notification-item').forEach(item => {
        item.addEventListener('click', () => {
          const dropdown = document.getElementById('notifications-dropdown');
          if (dropdown) {
            dropdown.style.display = 'none';
            dropdown.classList.remove('show');
          }
        });
      });
    }
  }
}

export async function joinWatchPartyByCode(roomId, nickname = '') {
  try {
    showToast(`Conectando a la sala ${roomId}...`);
    const room = await partyManager.joinRoom(roomId, nickname);
    if (room && room.episode_id) {
      window.location.hash = `#/player/${encodeURIComponent(room.episode_id)}`;
    } else {
      window.location.hash = '#/';
      showToast('La sala no tiene un episodio activo asignado', 'error');
    }
  } catch (err) {
    showToast('Error al unirse a la sala: ' + (err.message || err), 'error');
    window.location.hash = '#/';
  }
}

export function openWatchPartyModal(tab = 'join') {
  const modal = document.getElementById('modal-watch-party');
  if (!modal) return;
  modal.style.display = 'flex';
  const tabBtn = document.getElementById(`party-tab-${tab}`);
  if (tabBtn) {
    tabBtn.click();
  }
}

export function closeWatchPartyModal() {
  const modal = document.getElementById('modal-watch-party');
  if (modal) modal.style.display = 'none';
}

export function setupWatchPartyModal() {
  const modal = document.getElementById('modal-watch-party');
  const navPartyBtn = document.getElementById('nav-party');
  if (!modal) return;

  const closeModal = () => {
    modal.style.display = 'none';
  };

  if (navPartyBtn) {
    navPartyBtn.onclick = (e) => {
      e.preventDefault();
      modal.style.display = 'flex';
      switchPartyTab('join');
    };
  }

  // Close triggers
  const closeBtn = document.getElementById('party-modal-close');
  const cancelJoinBtn = document.getElementById('party-join-cancel-btn');
  const cancelCreateBtn = document.getElementById('party-create-cancel-btn');
  const cancelPublicBtn = document.getElementById('party-public-cancel-btn');

  if (closeBtn) closeBtn.onclick = closeModal;
  if (cancelJoinBtn) cancelJoinBtn.onclick = closeModal;
  if (cancelCreateBtn) cancelCreateBtn.onclick = closeModal;
  if (cancelPublicBtn) cancelPublicBtn.onclick = closeModal;

  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display !== 'none') {
      closeModal();
    }
  });

  // Tabs
  const tabJoin = document.getElementById('party-tab-join');
  const tabCreate = document.getElementById('party-tab-create');
  const tabPublic = document.getElementById('party-tab-public');

  const contentJoin = document.getElementById('party-content-join');
  const contentCreate = document.getElementById('party-content-create');
  const contentPublic = document.getElementById('party-content-public');

  const switchPartyTab = (tabName) => {
    [tabJoin, tabCreate, tabPublic].forEach(t => {
      if (t) t.classList.remove('active');
    });
    [contentJoin, contentCreate, contentPublic].forEach(c => {
      if (c) c.style.display = 'none';
    });

    if (tabName === 'create') {
      if (tabCreate) tabCreate.classList.add('active');
      if (contentCreate) contentCreate.style.display = 'block';
      populatePartyEpisodeSelect();
    } else if (tabName === 'public') {
      if (tabPublic) tabPublic.classList.add('active');
      if (contentPublic) contentPublic.style.display = 'block';
      loadPublicRooms();
    } else {
      if (tabJoin) tabJoin.classList.add('active');
      if (contentJoin) contentJoin.style.display = 'block';
    }
  };

  if (tabJoin) tabJoin.onclick = () => switchPartyTab('join');
  if (tabCreate) tabCreate.onclick = () => switchPartyTab('create');
  if (tabPublic) tabPublic.onclick = () => switchPartyTab('public');

  // Populate Episode Select across shows in catalog
  async function populatePartyEpisodeSelect() {
    const select = document.getElementById('party-create-episode-select');
    if (!select) return;

    select.innerHTML = '<option value="">Cargando episodios disponibles...</option>';
    try {
      const activeEpId = getActiveEpisodeId();

      // Opened from the player: offer the show being watched, with the current episode preselected
      if (activeEpId) {
        const showRes = await fetch(`/api/shows/${encodeURIComponent(getShowIdFromEpisodeId(activeEpId))}`);
        const showData = showRes.ok ? await showRes.json() : null;
        const eps = Array.isArray(showData?.episodes) ? showData.episodes : [];
        if (eps.length > 0) {
          select.innerHTML = '<option value="">Selecciona un episodio...</option>' +
            eps.map(ep => `<option value="${escapeHtmlAttribute(ep.id)}">${escapeHtml(ep.title || `Episodio ${ep.episode_number}`)}</option>`).join('');
          select.value = activeEpId;
          return;
        }
      }

      // If we already have current show episodes loaded in detail view
      if (currentView === 'detail' && currentShowEpisodes && currentShowEpisodes.length > 0) {
        select.innerHTML = '<option value="">Selecciona un episodio...</option>' +
          currentShowEpisodes.map(ep => `<option value="${escapeHtmlAttribute(ep.id)}">${escapeHtml(ep.title || `Episodio ${ep.episode_number}`)}</option>`).join('');
        if (activeEpId) select.value = activeEpId;
        return;
      }

      const res = await fetch('/api/shows');
      if (res.ok) {
        const data = await res.json();
        const shows = Array.isArray(data) ? data : (data.shows || []);
        if (shows.length > 0) {
          const fetchPromises = shows.slice(0, 10).map(s => 
            fetch(`/api/shows/${encodeURIComponent(s.id)}`)
              .then(r => r.ok ? r.json() : null)
              .catch(() => null)
          );
          const results = await Promise.all(fetchPromises);
          let optionsHtml = '<option value="">Selecciona un episodio...</option>';
          let hasEpisodes = false;

          results.forEach((showData, idx) => {
            if (!showData) return;
            const sTitle = shows[idx].title || 'Anime';
            const eps = Array.isArray(showData.episodes) ? showData.episodes : [];
            if (eps.length > 0) {
              hasEpisodes = true;
              optionsHtml += `<optgroup label="${escapeHtmlAttribute(sTitle)}">`;
              eps.forEach(ep => {
                optionsHtml += `<option value="${escapeHtmlAttribute(ep.id)}">${escapeHtml(sTitle)} - ${escapeHtml(ep.title || `Ep. ${ep.episode_number}`)}</option>`;
              });
              optionsHtml += `</optgroup>`;
            }
          });

          if (hasEpisodes) {
            select.innerHTML = optionsHtml;
            if (activeEpId) select.value = activeEpId;
            return;
          }
        }
      }
      select.innerHTML = '<option value="">No hay episodios disponibles</option>';
    } catch {
      select.innerHTML = '<option value="">Error al cargar episodios</option>';
    }
  }

  // Join by code
  const joinBtn = document.getElementById('party-join-submit-btn');
  const codeInput = document.getElementById('party-join-code-input');
  const nameInput = document.getElementById('party-join-name-input');
  const joinError = document.getElementById('party-join-error');

  if (joinBtn) {
    joinBtn.onclick = async () => {
      const code = codeInput ? codeInput.value.trim().toUpperCase() : '';
      const name = nameInput ? nameInput.value.trim() : '';
      if (!code) {
        if (joinError) {
          joinError.textContent = 'Por favor introduce el código de la sala';
          joinError.style.display = 'block';
        } else {
          showToast('Por favor introduce el código de la sala', 'warning');
        }
        return;
      }
      if (joinError) joinError.style.display = 'none';
      closeModal();
      await joinWatchPartyByCode(code, name);
    };
  }

  // Create room
  const createSubmitBtn = document.getElementById('party-create-submit-btn');
  const createNameInput = document.getElementById('party-create-name-input');
  const epSelect = document.getElementById('party-create-episode-select');
  const pubCheck = document.getElementById('party-create-public-check');
  const ctrlCheck = document.getElementById('party-create-controls-check');
  const guestsCheck = document.getElementById('party-create-guests-check');
  const createError = document.getElementById('party-create-error');

  if (createSubmitBtn) {
    createSubmitBtn.onclick = async () => {
      if (!AuthManager.isAuthenticated()) {
        if (createError) {
          createError.innerHTML = 'Debes iniciar sesión para crear una sala. <button type="button" id="party-login-inline-btn" class="btn btn-secondary btn-sm" style="margin-left: 8px;">Iniciar Sesión</button>';
          createError.style.display = 'block';
          const btn = document.getElementById('party-login-inline-btn');
          if (btn && typeof openAuthModal === 'function') {
            btn.onclick = () => {
              closeModal();
              openAuthModal('login');
            };
          }
        } else {
          showToast('Debes iniciar sesión para crear una sala', 'warning');
        }
        return;
      }

      const epId = epSelect ? epSelect.value : '';
      if (!epId) {
        if (createError) {
          createError.textContent = 'Por favor selecciona un episodio para la sala';
          createError.style.display = 'block';
        }
        return;
      }
      if (createError) createError.style.display = 'none';

      const partyName = createNameInput ? createNameInput.value.trim() : '';
      const isPublic = Boolean(pubCheck && pubCheck.checked);
      const allowGuestControls = Boolean(ctrlCheck && ctrlCheck.checked);
      const allowGuests = Boolean(guestsCheck && guestsCheck.checked);

      createSubmitBtn.disabled = true;
      try {
        const room = await partyManager.createRoom({
          episodeId: epId,
          name: partyName,
          isPublic,
          allowGuestControls,
          allowGuests
        });
        closeModal();
        showToast(`Sala "${room.name || room.id}" creada con éxito`, 'success');
        window.location.hash = `#/player/${encodeURIComponent(room.episode_id)}`;
      } catch (err) {
        if (createError) {
          createError.textContent = err.message || 'Error al crear la sala';
          createError.style.display = 'block';
        }
      } finally {
        createSubmitBtn.disabled = false;
      }
    };
  }

  // Public rooms
  async function loadPublicRooms() {
    const listContainer = document.getElementById('party-public-rooms-list');
    if (!listContainer) return;
    listContainer.innerHTML = '<div class="state-box-loading">Buscando salas en vivo...</div>';
    try {
      const rooms = await partyManager.fetchPublicRooms();
      if (!Array.isArray(rooms) || rooms.length === 0) {
        listContainer.innerHTML = '<div class="empty-state text-muted" style="text-align: center; padding: 24px;">No hay salas públicas activas en este momento. ¡Sé el primero en crear una!</div>';
        return;
      }
      listContainer.innerHTML = rooms.map(r => `
        <div class="party-room-card" style="margin-bottom: 8px;">
          <div class="party-room-info">
            <span class="party-room-name">${escapeHtml(r.name || r.id)}</span>
            <span class="party-room-meta">
              <span>Anfitrión: <strong>${escapeHtml(r.host_user || 'Anfitrión')}</strong></span>
              ${r.show_title ? `<span>Anime: <strong>${escapeHtml(r.show_title)}</strong></span>` : ''}
              <span class="party-room-badge"><i data-lucide="radio"></i> En vivo</span>
            </span>
          </div>
          <button class="btn btn-primary btn-sm party-room-join-btn" data-room-id="${escapeHtmlAttribute(r.id)}">
            <i data-lucide="log-in"></i> Unirme
          </button>
        </div>
      `).join('');

      listContainer.querySelectorAll('.party-room-join-btn').forEach(btn => {
        btn.onclick = async () => {
          const rId = btn.getAttribute('data-room-id');
          closeModal();
          await joinWatchPartyByCode(rId);
        };
      });

      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch {
      listContainer.innerHTML = '<div class="text-danger" style="text-align: center; padding: 12px;">Error al cargar salas públicas.</div>';
    }
  }

  const refreshPublicBtn = document.getElementById('party-refresh-public-btn');
  if (refreshPublicBtn) {
    refreshPublicBtn.onclick = () => loadPublicRooms();
  }
}

// -------------------------------------------------------------
// Router & View Lifecycle Orchestration
// -------------------------------------------------------------

export function hideAllViews() {
  const views = document.querySelectorAll('.app-view, .view-section');
  views.forEach(v => {
    v.classList.remove('active');
    v.style.display = 'none';
  });
}

export function setupRouter() {
  const handleRoute = async () => {
    navigationGeneration++;
    if (typeof renderAuthState === 'function') renderAuthState();

    const rawHash = window.location.hash || '#/';
    const [routeWithPrefix] = rawHash.split('?');
    const path = routeWithPrefix.replace(/^#/, '') || '/';
    if (typeof trackRouteScroll === 'function') trackRouteScroll(path);
    
    if (typeof updateActiveNavHighlight === 'function') updateActiveNavHighlight(rawHash);

    // The show page's ambient background clip keeps decoding (and downloading) if it is left in the DOM.
    if (!path.startsWith('/show/') && typeof document.querySelectorAll === 'function') {
      document.querySelectorAll('.ambient-loop-video').forEach((clip) => {
        clip.pause();
        clip.removeAttribute('src');
        clip.load();
        clip.remove();
      });
    }

    // If leaving player view, destroy player cleanly
    const mainHeader = document.querySelector('.app-header');
    if (mainHeader && !path.startsWith('/player/')) {
      mainHeader.style.removeProperty('display');
    }

    if (currentView === 'player' && !path.startsWith('/player/')) {
      try {
        if (typeof playerController !== 'undefined' && playerController.destroy) {
          playerController.destroy();
        } else if (typeof destroyPlayer === 'function') {
          destroyPlayer();
        }
      } catch (err) {
        console.error('[Router] Error destroying player:', err);
      }
      if (mainHeader) mainHeader.style.removeProperty('display');
    }

    // Stop background polling routines when leaving admin
    if (!path.startsWith('/admin')) {
      if (typeof stopAdminPolling === 'function') stopAdminPolling();
    }

    if (!path.startsWith('/show/')) {
      // The detail view's muted backdrop loop keeps decoding in the background unless it is stopped.
      document.querySelectorAll('.detail-ambient-bg video.ambient-loop-video').forEach(ambientVideo => {
        ambientVideo.pause();
        ambientVideo.removeAttribute('src');
        ambientVideo.remove();
      });
      const trailerModal = document.getElementById('trailer-modal');
      const trailerIframe = document.getElementById('trailer-iframe');
      if (trailerModal) trailerModal.style.display = 'none';
      if (trailerIframe) trailerIframe.src = '';
    }

    if (path !== '/party' && !path.startsWith('/party/')) {
      const partyModal = document.getElementById('modal-watch-party');
      if (partyModal) partyModal.style.display = 'none';
    }

    document.querySelectorAll('.app-view, .view-section').forEach(view => {
      view.classList.remove('active');
      view.style.display = 'none';
    });

    if (path === '/' || path === '') {
      currentView = 'dashboard';
      const dashView = document.getElementById('dashboard-view');
      if (dashView) {
        dashView.classList.add('active');
        dashView.style.display = 'block';
      }
      if (typeof initCatalogView === 'function') await initCatalogView();
    } else if (path === '/airing') {
      currentView = 'dashboard';
      const dashView = document.getElementById('dashboard-view');
      if (dashView) {
        dashView.classList.add('active');
        dashView.style.display = 'block';
      }
      if (typeof initCatalogView === 'function') await initCatalogView('airing');
    } else if (path === '/calendar') {
      currentView = 'calendar';
      const calView = document.getElementById('calendar-view');
      if (calView) {
        calView.classList.add('active');
        calView.style.display = 'block';
      }
      if (typeof loadCalendarView === 'function') await loadCalendarView();
    } else if (path === '/movies') {
      currentView = 'dashboard';
      const dashView = document.getElementById('dashboard-view');
      if (dashView) {
        dashView.classList.add('active');
        dashView.style.display = 'block';
      }
      if (typeof initCatalogView === 'function') await initCatalogView('movie');
    } else if (path === '/my-list') {
      currentView = 'mylist';
      const mylistView = document.getElementById('mylist-view');
      if (mylistView) {
        mylistView.classList.add('active');
        mylistView.style.display = 'block';
      }
      if (typeof renderMyListView === 'function') await renderMyListView();
    } else if (path === '/history') {
      currentView = 'history';
      const histView = document.getElementById('history-view');
      if (histView) {
        histView.classList.add('active');
        histView.style.display = 'block';
      }
      if (typeof renderHistoryView === 'function') await renderHistoryView();
    } else if (path.startsWith('/genres')) {
      currentView = 'genres';
      const genView = document.getElementById('genres-view');
      if (genView) {
        genView.classList.add('active');
        genView.style.display = 'block';
      }
      let activeGenre = '';
      if (rawHash.includes('?genre=')) {
        const paramStr = rawHash.split('?genre=')[1];
        if (paramStr) activeGenre = decodeURIComponent(paramStr.split('&')[0]);
      }
      if (typeof renderGenresView === 'function') await renderGenresView(activeGenre);
    } else if (path === '/stats') {
      currentView = 'stats';
      const statsView = document.getElementById('stats-view');
      if (statsView) {
        statsView.classList.add('active');
        statsView.style.display = 'block';
      }
      if (typeof renderStatsView === 'function') await renderStatsView();
    } else if (path === '/settings') {
      currentView = 'settings';
      const setView = document.getElementById('settings-view');
      if (setView) {
        setView.classList.add('active');
        setView.style.display = 'block';
      }
      if (typeof loadSettingsView === 'function') await loadSettingsView();
    } else if (path === '/app') {
      currentView = 'app-download';
      const appView = document.getElementById('app-download-view');
      if (appView) {
        appView.classList.add('active');
        appView.style.display = 'block';
      }
      await renderAppDownloadView();
    } else if (path === '/admin') {
      if (typeof AuthManager !== 'undefined' && !AuthManager.isAdmin()) {
        if (!AuthManager.isAuthenticated()) {
          if (typeof openAuthModal === 'function') openAuthModal('admin');
          window.location.hash = '#/';
          return;
        } else {
          if (typeof showToast === 'function') showToast('Acceso denegado: Se requieren permisos administrativos', 'error');
          window.location.hash = '#/';
          return;
        }
      }
      currentView = 'admin';
      const admView = document.getElementById('admin-view');
      if (admView) {
        admView.classList.add('active');
        admView.style.display = 'flex';
      }
      if (typeof initAdminSidebar === 'function') {
        Promise.resolve(initAdminSidebar()).catch(() => {
          window.showToast?.('No se pudo cargar el panel de administración. Revisa la conexión.', 'error');
        });
      }
    } else if (path === '/profiles') {
      currentView = 'profiles';
      const profView = document.getElementById('profile-switcher-view');
      if (profView) {
        profView.classList.add('active');
        profView.style.display = 'block';
      }
      if (typeof loadProfilesView === 'function') await loadProfilesView();
    } else if (path.startsWith('/show/')) {
      currentView = 'detail';
      const id = decodeURIComponent(path.replace(/^\/show\//, ''));
      const detView = document.getElementById('detail-view');
      if (detView) {
        detView.classList.add('active');
        detView.style.display = 'block';
      }
      if (typeof loadShowDetails === 'function') {
        await loadShowDetails(id);
      }
    } else if (path.startsWith('/player/')) {
      currentView = 'player';
      const id = decodeURIComponent(path.replace(/^\/player\//, ''));
      const header = document.querySelector('.app-header');
      if (header) header.style.display = 'none';
      const playView = document.getElementById('player-view');
      if (playView) {
        playView.classList.add('active');
        playView.style.display = 'block';
      }
      if (typeof playerController !== 'undefined' && playerController.mount) {
        playerController.mount(playView);
        if (typeof playerController.loadEpisode === 'function') {
          await playerController.loadEpisode(id);
        } else if (typeof initPlayer === 'function') {
          await initPlayer(id);
        }
      } else if (typeof initPlayer === 'function') {
        await initPlayer(id);
      }
    } else if (path === '/party' || path.startsWith('/party/')) {
      currentView = 'dashboard';
      const dashView = document.getElementById('dashboard-view');
      if (dashView) {
        dashView.classList.add('active');
        dashView.style.display = 'block';
      }
      if (typeof initCatalogView === 'function') await initCatalogView();

      const roomId = decodeURIComponent(path.replace(/^\/party\/?/, '')).trim();
      if (roomId) {
        // A link must not drop someone into a room (and show their name to it) without asking.
        const wantsToJoin = typeof window.confirm !== 'function' || window.confirm(`¿Unirte al Watch Party ${roomId}?`);
        if (!wantsToJoin) {
          window.location.hash = '#/';
        } else if (typeof joinWatchPartyByCode === 'function') {
          await joinWatchPartyByCode(roomId);
        }
      } else {
        openWatchPartyModal('join');
      }
    } else {
      currentView = 'dashboard';
      const dashView = document.getElementById('dashboard-view');
      if (dashView) {
        dashView.classList.add('active');
        dashView.style.display = 'block';
      }
      if (typeof initCatalogView === 'function') await initCatalogView();
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (typeof restoreScrollFor === 'function') restoreScrollFor(path);
  };

  // hashchange alone covers links, back/forward and programmatic hash changes; also listening to
  // popstate made every navigation run the route (and initPlayer) twice.
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

let catalogSearchQuery = '';

export function genreLabel(genre) {
  // TMDB leaves a few TV genres untranslated in its Spanish responses.
  const labels = {
    'Action & Adventure': 'Acción y Aventura',
    'Sci-Fi & Fantasy': 'Ciencia Ficción y Fantasía',
    'War & Politics': 'Bélica y Política',
    'Kids': 'Infantil',
    'Soap': 'Telenovela',
    'Talk': 'Entrevistas',
    'News': 'Noticias'
  };
  return labels[genre] || genre;
}

function showGenreList(show) {
  return String(show.genres || '').split(',').map(g => g.trim()).filter(Boolean);
}

// Home toolbar state (status chips, sort chips, genre pills). The markup shipped without any
// handlers, so the filters looked clickable but did nothing.
const catalogFilters = { status: '', sort: 'popular', genre: 'all' };
let catalogShows = [];
let catalogHistoryMap = new Map();
let catalogToolbarBound = false;

function syncCatalogToolbar() {
  document.querySelectorAll('.catalog-toolbar .filter-chip').forEach(chip => {
    const on = (chip.dataset.status || '') === catalogFilters.status;
    chip.classList.toggle('active', on);
    chip.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('.catalog-toolbar .sort-chip').forEach(chip => {
    const on = chip.dataset.sort === catalogFilters.sort;
    chip.classList.toggle('active', on);
    chip.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('.catalog-toolbar .genre-pill').forEach(pill => {
    const on = pill.dataset.genre === catalogFilters.genre;
    pill.classList.toggle('active', on);
    pill.setAttribute('aria-pressed', String(on));
  });
}

/** Genre pills come from the genres actually present in the library, not a fixed list. */
function renderGenrePills(shows) {
  const rail = document.querySelector('.catalog-toolbar .genre-pill-rail');
  if (!rail) return;
  const genres = [...new Set(shows.flatMap(showGenreList))]
    .sort((a, b) => genreLabel(a).localeCompare(genreLabel(b), 'es'));
  if (catalogFilters.genre !== 'all' && !genres.includes(catalogFilters.genre)) catalogFilters.genre = 'all';
  rail.innerHTML = [`<button type="button" class="genre-pill" data-genre="all">Todos</button>`]
    .concat(genres.map(g => `<button type="button" class="genre-pill" data-genre="${escapeHtmlAttribute(g)}">${escapeHtml(genreLabel(g))}</button>`))
    .join('');
  // A single genre shared by every title filters nothing; hide the rail then.
  rail.style.display = genres.length > 1 ? '' : 'none';
}

function filteredCatalogShows() {
  // A search looks through the whole library; status/genre filters would silently hide matches.
  if (catalogSearchQuery) {
    return catalogShows.filter(show => String(show.title || '').toLowerCase().includes(catalogSearchQuery));
  }
  const list = catalogShows.filter(show => {
    if (catalogFilters.status === 'airing' && show.status !== 'airing') return false;
    if (catalogFilters.status === 'completed' && show.status !== 'finished' && show.status !== 'completed') return false;
    if (catalogFilters.genre !== 'all' && !showGenreList(show).includes(catalogFilters.genre)) return false;
    return true;
  });
  if (catalogFilters.sort === 'rating') {
    list.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
  } else if (catalogFilters.sort === 'recent') {
    // "Recientes" = most recently added to the library
    list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }
  return list;
}

function renderCatalogGrid() {
  const grid = document.getElementById('catalog-grid');
  if (!grid) return;
  const list = filteredCatalogShows();
  if (list.length === 0) {
    grid.innerHTML = catalogSearchQuery
      ? `<div class="catalog-filter-empty"><p>No encontramos “${escapeHtml(catalogSearchQuery)}” en tu biblioteca.</p></div>`
      : `
      <div class="catalog-filter-empty">
        <p>No hay títulos con estos filtros.</p>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-clear-catalog-filters">Quitar filtros</button>
      </div>`;
  } else {
    grid.innerHTML = list.map(s => createShowCardHTML(s, catalogHistoryMap)).join('');
  }
  syncCatalogToolbar();
  if (typeof lucide !== 'undefined') lucide.createIcons();
  // Hover previews only make sense with a mouse; on touch screens a tap must open the title.
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    try {
      initCardPopovers(document.body, {
        onPlay: showId => playShow(showId),
        onInfo: showId => { window.location.hash = `#/show/${encodeURIComponent(showId)}`; },
        onList: async (showId, card, wanted) => {
          const result = await toggleFavoriteShow(showId);
          return result === null ? !wanted : result;
        }
      });
    } catch (err) {
      console.warn('[Catalog] Card previews unavailable:', err);
    }
  }
}

function bindCatalogToolbar() {
  if (catalogToolbarBound) return;
  const toolbar = document.querySelector('.catalog-toolbar');
  if (!toolbar) return;
  catalogToolbarBound = true;
  toolbar.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip, .sort-chip, .genre-pill');
    if (!chip) return;
    if (chip.classList.contains('filter-chip')) catalogFilters.status = chip.dataset.status || '';
    else if (chip.classList.contains('sort-chip')) catalogFilters.sort = chip.dataset.sort || 'popular';
    else catalogFilters.genre = chip.dataset.genre || 'all';
    renderCatalogGrid();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#btn-clear-catalog-filters')) return;
    catalogFilters.status = '';
    catalogFilters.genre = 'all';
    renderCatalogGrid();
  });
}

function applyCatalogSearch() {
  if (document.getElementById('catalog-grid')) {
    renderCatalogGrid();
    return;
  }
  document.querySelectorAll('#dashboard-sections .show-card').forEach(card => {
    const title = (card.querySelector('.card-title')?.textContent || '').toLowerCase();
    card.style.display = !catalogSearchQuery || title.includes(catalogSearchQuery) ? '' : 'none';
  });
}

async function initCatalogView(filterType = 'all') {
  const heroContainer = document.getElementById('hero-carousel-container');
  const heroWrapper = document.getElementById('hero-carousel-wrapper');
  const dashboardSections = document.getElementById('dashboard-sections');
  const generation = navigationGeneration;

  try {
    let shows = await loadCatalog();
    if (generation !== navigationGeneration) return;
    if (filterType === 'movie') {
      shows = shows.filter(s => s.media_type === 'movie' || s.type === 'movie');
    }
    appState.set('catalog', shows);
    // "En Emisión" opens the catalog pre-filtered; plain Inicio starts unfiltered.
    catalogFilters.status = filterType === 'airing' ? 'airing' : '';
    catalogFilters.genre = 'all';
    catalogFilters.sort = 'popular';

    // Continue Watching (history is per profile, so guests have none server-side)
    const { activeUser, profileName, token, hasProfile } = getUserAndProfile();
    let continueItems = [];
    if (hasProfile) {
      try {
        const histRes = await fetch(`/api/history/continue?username=${encodeURIComponent(activeUser)}&profile_name=${encodeURIComponent(profileName)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (histRes.ok) continueItems = await histRes.json();
      } catch {}
    }
    if (!Array.isArray(continueItems)) continueItems = [];
    if (generation !== navigationGeneration) return;

    // Hero carousel: up to five titles; "Reproducir" resumes where this profile left off.
    if (heroContainer && heroWrapper) {
      const resumeByShow = new Map();
      continueItems.forEach(item => {
        const key = String(item.show_id || '');
        if (!key || resumeByShow.has(key)) return;
        const label = Number(item.season_number) > 0 ? `T${item.season_number}:E${item.episode_number}` : (item.episode_number ? `E${item.episode_number}` : '');
        resumeByShow.set(key, { episodeId: item.episode_id, label });
      });
      mountHeroCarousel(heroContainer, pickHeroShows(shows), (show, index) => renderBillboardHero(show, index, resumeByShow.get(String(show.id)) || null));
    }

    if (dashboardSections) {
      const continueHtml = renderContinueWatching(continueItems);
      const sectionTitle = filterType === 'movie'
        ? 'Películas Disponibles'
        : (filterType === 'airing' ? 'En Emisión en tu Biblioteca' : 'Catálogo Completo');
      const catalogHtml = `
        <section class="catalog-section">
          <h2 class="section-title">${sectionTitle}</h2>
          <div class="shows-grid" id="catalog-grid"></div>
        </section>
      `;
      dashboardSections.innerHTML = continueHtml + catalogHtml;

      // Cards show the progress of the episode "Continuar viendo" points at; playShow() opens it.
      catalogHistoryMap = new Map();
      continueItems.forEach(item => {
        const key = String(item.show_id || '');
        if (key && !catalogHistoryMap.has(key)) catalogHistoryMap.set(key, item);
      });
      catalogShows = shows;
      renderGenrePills(shows);
      bindCatalogToolbar();
      renderCatalogGrid();
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (err) {
    console.error('Error initializing catalog view:', err);
    // A failed catalogue must not look like an empty library.
    if (dashboardSections) {
      if (heroWrapper) heroWrapper.style.display = 'none';
      renderLoadErrorState(dashboardSections, err, 'el catálogo', () => initCatalogView(filterType));
    }
  }
}

async function loadCalendarView() {
  const dayTabs = document.getElementById('day-picker-tabs');
  const btnRefresh = document.getElementById('btn-refresh-calendar');
  const onlyLibrary = document.getElementById('calendar-only-library');
  const todayDay = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const activeDay = () => {
    const activeTab = dayTabs ? dayTabs.querySelector('.day-tab.active') : null;
    return activeTab ? activeTab.getAttribute('data-day') : todayDay;
  };

  const fetchCalendar = async (force = false) => {
    try {
      const url = force ? '/api/calendar?force=1' : '/api/calendar';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        calendarDataCache = data && typeof data === 'object' ? data : {};
      }
    } catch (e) {
      console.warn('Error loading calendar:', e);
    }
  };

  const selectDay = day => {
    if (!dayTabs) return renderCalendarDay(day);
    dayTabs.querySelectorAll('.day-tab').forEach(t => {
      const isActive = t.getAttribute('data-day') === day;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    renderCalendarDay(day);
  };

  await fetchCalendar();
  renderCalendarTabCounts();

  if (btnRefresh) {
    btnRefresh.onclick = async () => {
      btnRefresh.disabled = true;
      try {
        await fetchCalendar(true);
        renderCalendarTabCounts();
        renderCalendarDay(activeDay());
        showToast('Calendario de estrenos actualizado', 'success');
      } catch {
        showToast('Error al actualizar el calendario', 'error');
      } finally {
        btnRefresh.disabled = false;
      }
    };
  }

  if (onlyLibrary) {
    onlyLibrary.checked = calendarOnlyLibrary;
    onlyLibrary.onchange = () => {
      calendarOnlyLibrary = onlyLibrary.checked;
      renderCalendarTabCounts();
      renderCalendarDay(activeDay());
    };
  }

  if (dayTabs) {
    dayTabs.querySelectorAll('.day-tab').forEach(tab => {
      tab.classList.toggle('is-today', tab.getAttribute('data-day') === todayDay);
      tab.onclick = () => selectDay(tab.getAttribute('data-day'));
    });
  }

  const initialDay = CALENDAR_DAYS.includes(todayDay) ? todayDay : 'Monday';
  selectDay(initialDay);
  if (dayTabs) {
    // On phones the tab rail scrolls; weekend days started off-screen with nothing selected in view.
    const activeTab = dayTabs.querySelector('.day-tab.active');
    if (activeTab && dayTabs.scrollWidth > dayTabs.clientWidth) {
      dayTabs.scrollLeft = activeTab.offsetLeft - (dayTabs.clientWidth - activeTab.offsetWidth) / 2;
    }
  }
}

async function renderGenresView(activeGenre = '') {
  const genresGrid = document.getElementById('genres-grid');
  const catalogSection = document.getElementById('genre-catalog-section');
  const catalogTitle = document.getElementById('genre-catalog-title');
  const catalogGrid = document.getElementById('genre-catalog-grid');
  if (!genresGrid) return;
  const generation = navigationGeneration;

  let shows = [];
  try {
    shows = await loadCatalog();
    if (generation !== navigationGeneration) return;
  } catch (error) {
    if (generation !== navigationGeneration) return;
    renderLoadErrorState(genresGrid, error, 'los géneros', () => renderGenresView(activeGenre));
    if (catalogSection) catalogSection.style.display = 'none';
    return;
  }

  // Genres come from the catalog's own metadata (TMDB names such as "Sci-Fi & Fantasy").
  const splitGenres = show => String(show.genres || '').split(',').map(g => g.trim()).filter(Boolean);
  const counts = new Map();
  shows.forEach(show => splitGenres(show).forEach(g => counts.set(g, (counts.get(g) || 0) + 1)));
  const genres = [...counts.keys()].sort((a, b) => genreLabel(a).localeCompare(genreLabel(b), 'es'));

  if (genres.length === 0) {
    genresGrid.innerHTML = '<div class="empty-state">Todavía no hay géneros en el catálogo.</div>';
  } else {
    genresGrid.innerHTML = genres.map(g => `
      <div class="genre-card ${g === activeGenre ? 'active' : ''}" role="link" tabindex="0" data-catalogue-route="${escapeHtmlAttribute('#/genres?genre=' + encodeURIComponent(g))}">
        <h3>${escapeHtml(genreLabel(g))}</h3>
        <span class="text-muted">${counts.get(g)} ${counts.get(g) === 1 ? 'título' : 'títulos'}</span>
      </div>
    `).join('');
  }

  if (!catalogSection || !catalogGrid) return;
  if (!activeGenre) {
    catalogSection.style.display = 'none';
    return;
  }
  const matching = shows.filter(show => splitGenres(show).includes(activeGenre));
  catalogSection.style.display = '';
  if (catalogTitle) catalogTitle.textContent = genreLabel(activeGenre);
  catalogGrid.innerHTML = matching.length > 0
    ? matching.map(show => createShowCardHTML(show)).join('')
    : '<div class="empty-state">No hay títulos con este género.</div>';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function loadSettingsView() {
  const { activeUser, profileName, token, hasProfile } = getUserAndProfile();
  const audioLangSelect = document.getElementById('pref-audio-lang');
  const subLangSelect = document.getElementById('pref-sub-lang');
  const boostSelect = document.getElementById('pref-audio-boost');
  const presetSelect = document.getElementById('pref-audio-preset');
  const skipIntroToggle = document.getElementById('autoSkipIntroToggle');
  const autoPlayNextToggle = document.getElementById('autoPlayNextToggle');
  const notifToggle = document.getElementById('notificationsToggle');
  const saveSuccessToast = document.getElementById('settings-save-success');

  try {
    // Guests keep their preferences in localStorage only (the API requires a profile session).
    const res = hasProfile
      ? await fetch(`/api/user/preferences?username=${encodeURIComponent(activeUser)}&profile_name=${encodeURIComponent(profileName)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      : null;
    const localPrefs = {
      preferred_audio_language: localStorage.getItem('kurastream_preferred_audio_language') || undefined,
      preferred_subtitle_language: localStorage.getItem('kurastream_preferred_subtitle_language') || undefined,
      audio_boost: localStorage.getItem('kura_audio_boost') || undefined,
      audio_preset: localStorage.getItem('kura_audio_preset') || undefined,
      auto_skip_intro: localStorage.getItem('kurastream_auto_skip_intro') === 'true',
      auto_play_next: localStorage.getItem('kurastream_auto_play_next') !== 'false',
      notifications_enabled: localStorage.getItem('kura_notifications_enabled') !== 'false'
    };
    const data = (res && res.ok) ? await res.json() : (hasProfile ? null : { preferences: localPrefs });
    if (data) {
      const prefs = data.preferences || data;
      if (audioLangSelect) audioLangSelect.value = prefs.preferred_audio_language || 'default';
      if (subLangSelect) subLangSelect.value = prefs.preferred_subtitle_language || 'default';
      if (boostSelect) boostSelect.value = String(prefs.audio_boost || 100);
      if (presetSelect) presetSelect.value = prefs.audio_preset || 'flat';
      if (skipIntroToggle) skipIntroToggle.checked = Boolean(prefs.auto_skip_intro);
      if (autoPlayNextToggle) autoPlayNextToggle.checked = prefs.auto_play_next !== false && prefs.auto_play_next !== 0 && prefs.auto_play_next !== 'false';
      if (notifToggle) notifToggle.checked = prefs.notifications_enabled !== false;

      if (!window.userPreferences) window.userPreferences = {};
      Object.assign(window.userPreferences, prefs);
    }
  } catch (e) {
    console.warn('Error loading settings:', e);
  }

  const savePreferences = async () => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const existingAudio = (window.userPreferences && window.userPreferences.preferred_audio_language) || localStorage.getItem('kura_pref_audio_lang') || 'default';
    const existingSub = (window.userPreferences && window.userPreferences.preferred_subtitle_language) || localStorage.getItem('kura_pref_sub_lang') || 'default';

    const payload = {
      username: activeUser,
      profile_name: profileName,
      preferred_audio_language: audioLangSelect ? audioLangSelect.value : existingAudio,
      preferred_subtitle_language: subLangSelect ? subLangSelect.value : existingSub,
      audio_boost: boostSelect ? parseInt(boostSelect.value, 10) : 100,
      audio_preset: presetSelect ? presetSelect.value : 'flat',
      auto_skip_intro: skipIntroToggle && skipIntroToggle.checked ? 1 : 0,
      auto_play_next: autoPlayNextToggle && autoPlayNextToggle.checked ? 1 : 0,
      notifications_enabled: notifToggle && notifToggle.checked ? 1 : 0
    };

    try {
      const res = hasProfile
        ? await fetch('/api/user/preferences', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        })
        : { ok: true };
      if (res.ok) {
        if (!window.userPreferences) window.userPreferences = {};
        Object.assign(window.userPreferences, payload);
        localStorage.setItem('kurastream_auto_skip_intro', String(skipIntroToggle ? skipIntroToggle.checked : false));
        localStorage.setItem('kurastream_auto_play_next', String(autoPlayNextToggle ? autoPlayNextToggle.checked : true));
        if (audioLangSelect) {
          localStorage.setItem('kurastream_preferred_audio_language', audioLangSelect.value);
          localStorage.setItem('kura_pref_audio_lang', audioLangSelect.value);
        }
        if (subLangSelect) {
          localStorage.setItem('kurastream_preferred_subtitle_language', subLangSelect.value);
          localStorage.setItem('kura_pref_sub_lang', subLangSelect.value);
        }
        localStorage.setItem('kura_audio_boost', String(boostSelect ? boostSelect.value : 100));
        localStorage.setItem('kura_audio_preset', presetSelect ? presetSelect.value : 'flat');
        localStorage.setItem('kura_notifications_enabled', String(notifToggle ? notifToggle.checked : true));
        loadNotifications();

        if (saveSuccessToast) {
          saveSuccessToast.style.display = 'block';
          setTimeout(() => { saveSuccessToast.style.display = 'none'; }, 2500);
        }
      } else {
        window.showToast?.(res.status === 401 || res.status === 403 ? 'Tu sesión terminó: inicia sesión para guardar tus ajustes' : 'No se pudieron guardar tus ajustes', 'error');
      }
    } catch (err) {
      console.warn('Error saving preferences:', err);
      window.showToast?.('Sin conexión: no se guardaron tus ajustes', 'error');
    }
  };

  if (audioLangSelect) audioLangSelect.onchange = savePreferences;
  if (subLangSelect) subLangSelect.onchange = savePreferences;
  if (boostSelect) boostSelect.onchange = savePreferences;
  if (presetSelect) presetSelect.onchange = savePreferences;
  if (skipIntroToggle) skipIntroToggle.onchange = savePreferences;
  if (autoPlayNextToggle) autoPlayNextToggle.onchange = savePreferences;

  // Visual performance mode is a per-device choice (an old PC and a phone differ), so it lives
  // in localStorage rather than in the synced profile preferences.
  const perfModeSelect = document.getElementById('perfModeSelect');
  if (perfModeSelect) {
    let storedMode = null;
    try { storedMode = localStorage.getItem('kurastream_perf_mode'); } catch { storedMode = null; }
    perfModeSelect.value = storedMode === 'lite' || storedMode === 'full' ? storedMode : 'auto';
    perfModeSelect.onchange = () => {
      const mode = perfModeSelect.value;
      try {
        if (mode === 'auto') localStorage.removeItem('kurastream_perf_mode');
        else localStorage.setItem('kurastream_perf_mode', mode);
      } catch { /* storage blocked: still apply for this session */ }
      const lowEnd = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
        (navigator.deviceMemory && navigator.deviceMemory <= 4);
      document.documentElement.classList.toggle('perf-lite', mode === 'lite' || (mode === 'auto' && Boolean(lowEnd)));
    };
  }
  if (notifToggle) notifToggle.onchange = savePreferences;
}

let isProfileManageMode = false;
let currentEditingAvatar = '';
let currentEditingColor = '#818CF8';

/**
 * Asks for the profile's current 4-digit PIN in an accessible dialog (it used to be window.prompt, which shows the
 * digits in clear text and cannot be styled or read well by assistive technology).
 * Resolves with the PIN, or null when cancelled.
 */
function askCurrentProfilePin(profile) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'pin-modal-overlay';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '2200';
    overlay.innerHTML = `
      <form class="pin-modal pin-modal-compact" novalidate>
        <h3 class="modal-title">PIN actual</h3>
        <p class="pin-profile-name">${escapeHtml(profile.name || '')}</p>
        <input type="password" class="input-text" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" aria-label="PIN actual de 4 dígitos">
        <div class="login-error-msg" role="alert" style="display: none;">El PIN debe contener exactamente 4 dígitos</div>
        <div class="pin-buttons pin-buttons-end">
          <button type="button" class="btn btn-secondary" data-dialog-close>Cancelar</button>
          <button type="submit" class="btn btn-primary">Continuar</button>
        </div>
      </form>
    `;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const input = overlay.querySelector('input');
    const error = overlay.querySelector('.login-error-msg');
    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector('[data-dialog-close]').addEventListener('click', () => finish(null));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const pin = input.value.trim();
      if (!/^\d{4}$/.test(pin)) {
        error.style.display = 'block';
        input.focus();
        return;
      }
      finish(pin);
    });
    input.focus();
  });
}

const AVATAR_OUTPUT_SIZE = 512;

/**
 * Square photo framing inside the profile modal: drag to position, slider/wheel to zoom.
 * Resolves with a 512px JPEG data URL (≈60 KB) or null if cancelled. Phone photos used to be sent
 * whole as base64 and the server rejects anything over 5 MB.
 */
function openAvatarCropper(src) {
  return new Promise(resolve => {
    const main = document.getElementById('profile-edit-main');
    const actions = document.getElementById('profile-edit-actions');
    const cropper = document.getElementById('avatar-cropper');
    const viewport = document.getElementById('avatar-crop-viewport');
    const img = document.getElementById('avatar-crop-img');
    const zoomInput = document.getElementById('avatar-crop-zoom');
    const applyBtn = document.getElementById('btn-crop-apply');
    const cancelBtn = document.getElementById('btn-crop-cancel');
    if (!cropper || !viewport || !img || !zoomInput) { resolve(null); return; }

    const state = { zoom: 1, x: 0, y: 0, base: 1, w: 0, h: 0 };
    const size = () => viewport.clientWidth || 240;
    const clamp = () => {
      const v = size();
      const maxX = Math.max(0, (state.w * state.base * state.zoom - v) / 2);
      const maxY = Math.max(0, (state.h * state.base * state.zoom - v) / 2);
      state.x = Math.min(maxX, Math.max(-maxX, state.x));
      state.y = Math.min(maxY, Math.max(-maxY, state.y));
    };
    const render = () => {
      clamp();
      img.style.width = `${state.w * state.base * state.zoom}px`;
      img.style.transform = `translate(calc(-50% + ${state.x}px), calc(-50% + ${state.y}px))`;
    };
    const finish = (result) => {
      cropper.style.display = 'none';
      if (main) main.style.display = '';
      if (actions) actions.style.display = '';
      viewport.onpointerdown = viewport.onpointermove = viewport.onpointerup = viewport.onwheel = null;
      resolve(result);
    };

    img.onload = () => {
      state.w = img.naturalWidth;
      state.h = img.naturalHeight;
      state.base = size() / Math.min(state.w, state.h); // cover the circle at zoom 1
      state.zoom = 1; state.x = 0; state.y = 0;
      zoomInput.value = '1';
      render();
    };
    img.onerror = () => {
      showToast('No se pudo leer la imagen (usa JPG, PNG o WebP)', 'error');
      finish(null);
    };

    if (main) main.style.display = 'none';
    if (actions) actions.style.display = 'none';
    cropper.style.display = 'flex';
    img.src = src;

    let drag = null;
    viewport.onpointerdown = (e) => {
      drag = { px: e.clientX, py: e.clientY, x: state.x, y: state.y };
      viewport.setPointerCapture(e.pointerId);
    };
    viewport.onpointermove = (e) => {
      if (!drag) return;
      state.x = drag.x + (e.clientX - drag.px);
      state.y = drag.y + (e.clientY - drag.py);
      render();
    };
    viewport.onpointerup = () => { drag = null; };
    viewport.onwheel = (e) => {
      e.preventDefault();
      state.zoom = Math.min(3, Math.max(1, state.zoom - e.deltaY * 0.002));
      zoomInput.value = String(state.zoom);
      render();
    };
    zoomInput.oninput = () => { state.zoom = Number(zoomInput.value) || 1; render(); };

    cancelBtn.onclick = () => finish(null);
    applyBtn.onclick = () => {
      const scale = state.base * state.zoom;
      const v = size();
      const srcSize = v / scale;
      const sx = (state.w * scale / 2 - v / 2 - state.x) / scale;
      const sy = (state.h * scale / 2 - v / 2 - state.y) / scale;
      const canvas = document.createElement('canvas');
      canvas.width = AVATAR_OUTPUT_SIZE;
      canvas.height = AVATAR_OUTPUT_SIZE;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#111824';
      ctx.fillRect(0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
      ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
      try {
        finish(canvas.toDataURL('image/jpeg', 0.88));
      } catch {
        showToast('No se pudo procesar esa imagen', 'error');
        finish(null);
      }
    };
  });
}

/** Posters stored on this server, offered as avatar sources (external URLs would taint the canvas). */
async function renderLibraryAvatarChoices(grid, onPick) {
  if (!grid || grid.dataset.loaded === '1') return;
  grid.innerHTML = '<span class="avatar-library-hint">Cargando…</span>';
  let shows = appState.get ? appState.get('catalog') : null;
  if (!Array.isArray(shows) || shows.length === 0) {
    try {
      shows = await loadCatalog();
    } catch {
      shows = [];
    }
  }
  const posters = shows
    .map(show => ({ title: show.title || '', src: catalogueImageUrl(show.poster_path || '') }))
    .filter(item => item.src.startsWith('/library/'))
    .slice(0, 24);
  if (posters.length === 0) {
    grid.innerHTML = '<span class="avatar-library-hint">No hay pósters en la biblioteca todavía.</span>';
    return;
  }
  grid.dataset.loaded = '1';
  grid.innerHTML = posters.map(item => `
    <button type="button" class="preset-avatar-option library-avatar-option" data-src="${escapeHtmlAttribute(item.src)}"
      data-bg-image="${escapeHtmlAttribute(item.src)}" title="${escapeHtmlAttribute(item.title)}" aria-label="${escapeHtmlAttribute('Usar ' + item.title)}"></button>
  `).join('');
  applyDynamicBackgrounds(grid);
  grid.querySelectorAll('.library-avatar-option').forEach(btn => {
    btn.onclick = () => onPick(btn.getAttribute('data-src'));
  });
}

export function openProfileEditModal(mode = 'create', profile = null) {
  const modal = document.getElementById('profile-edit-modal');
  const title = document.getElementById('profile-edit-title');
  const avatarDisplay = document.getElementById('profile-edit-avatar');
  const nameInput = document.getElementById('profile-name-input');
  const kidsInput = document.getElementById('profile-kids-input');
  const pinInput = document.getElementById('profile-pin-input');
  const deleteBtn = document.getElementById('btn-delete-profile');
  const errorDiv = document.getElementById('profile-edit-error');
  const fileInput = document.getElementById('profile-avatar-file-input');
  const uploadBtn = document.getElementById('btn-upload-avatar');
  const cancelBtn = document.getElementById('btn-cancel-profile');
  const saveBtn = document.getElementById('btn-save-profile');

  if (!modal) return;
  modal.style.display = 'flex';
  if (errorDiv) errorDiv.style.display = 'none';

  const isEdit = mode === 'edit' && profile;
  if (title) title.textContent = isEdit ? 'Editar Perfil' : 'Agregar Perfil';

  currentEditingAvatar = (isEdit && profile.avatar) ? profile.avatar : '';
  currentEditingColor = (isEdit && profile.color) ? profile.color : '#818CF8';

  if (nameInput) nameInput.value = isEdit ? (profile.name || '') : '';
  if (kidsInput) kidsInput.checked = Boolean(isEdit && profile.is_kids);
  if (pinInput) pinInput.value = '';
  // The API could always clear a PIN (remove_pin), but there was no way to ask for it.
  const removePinRow = document.getElementById('profile-remove-pin-row');
  const removePinInput = document.getElementById('profile-remove-pin-input');
  if (removePinRow) removePinRow.style.display = isEdit && profile.has_pin ? '' : 'none';
  if (removePinInput) removePinInput.checked = false;
  const removeAvatarBtn = document.getElementById('btn-remove-avatar');

  const updateAvatarPreview = () => {
    if (!avatarDisplay) return;
    if (currentEditingAvatar) {
      avatarDisplay.textContent = '';
      avatarDisplay.style.backgroundImage = cssUrl(currentEditingAvatar);
      avatarDisplay.style.backgroundSize = 'cover';
      avatarDisplay.style.backgroundPosition = 'center';
      avatarDisplay.style.backgroundRepeat = 'no-repeat';
    } else {
      avatarDisplay.style.backgroundImage = 'none';
      avatarDisplay.style.backgroundColor = currentEditingColor;
      const initial = nameInput && nameInput.value ? nameInput.value[0].toUpperCase() : '?';
      avatarDisplay.textContent = initial;
    }
    if (removeAvatarBtn) removeAvatarBtn.style.display = currentEditingAvatar ? '' : 'none';
  };

  updateAvatarPreview();

  if (nameInput) {
    nameInput.oninput = () => {
      if (!currentEditingAvatar) updateAvatarPreview();
    };
  }

  // Preset avatar clicks
  const presetOptions = modal.querySelectorAll('#preset-avatars-grid .preset-avatar-option');
  const clearSelection = () => modal.querySelectorAll('.preset-avatar-option').forEach(o => o.classList.remove('selected'));
  presetOptions.forEach(opt => {
    const presetPath = opt.getAttribute('data-preset');
    opt.classList.toggle('selected', presetPath === currentEditingAvatar);
    opt.onclick = () => {
      clearSelection();
      opt.classList.add('selected');
      currentEditingAvatar = presetPath;
      updateAvatarPreview();
    };
  });

  const useCroppedPhoto = async (src) => {
    const cropped = await openAvatarCropper(src);
    if (cropped) {
      currentEditingAvatar = cropped;
      clearSelection();
      updateAvatarPreview();
    }
  };

  // Own photo: framed and downscaled in the browser before upload
  if (uploadBtn && fileInput) {
    uploadBtn.onclick = () => fileInput.click();
    fileInput.onchange = async (e) => {
      const file = e.target.files && e.target.files[0];
      fileInput.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        showToast('Elige una imagen (JPG, PNG o WebP)', 'error');
        return;
      }
      const url = URL.createObjectURL(file);
      try {
        await useCroppedPhoto(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
  }

  if (removeAvatarBtn) {
    removeAvatarBtn.onclick = () => {
      currentEditingAvatar = '';
      clearSelection();
      updateAvatarPreview();
    };
  }

  // Avatar sources: bundled characters or a poster from the library
  const presetsGrid = document.getElementById('preset-avatars-grid');
  const libraryGrid = document.getElementById('library-avatars-grid');
  modal.querySelectorAll('.avatar-source-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.source === 'presets');
    tab.onclick = () => {
      modal.querySelectorAll('.avatar-source-tab').forEach(t => t.classList.toggle('active', t === tab));
      const fromLibrary = tab.dataset.source === 'library';
      if (presetsGrid) presetsGrid.style.display = fromLibrary ? 'none' : '';
      if (libraryGrid) libraryGrid.style.display = fromLibrary ? '' : 'none';
      if (fromLibrary) renderLibraryAvatarChoices(libraryGrid, useCroppedPhoto);
    };
  });
  if (presetsGrid) presetsGrid.style.display = '';
  if (libraryGrid) libraryGrid.style.display = 'none';

  // Color swatches (also the background of the initial when there is no photo)
  const swatches = modal.querySelectorAll('.color-swatches-row .color-swatch');
  const legacyColors = { Purple: '#818CF8', Green: '#4DD4A7', Blue: '#5AA7FF', Red: '#FF6B81', Orange: '#5ED8C6' };
  const activeHex = String(legacyColors[currentEditingColor] || currentEditingColor).toUpperCase();
  swatches.forEach(sw => {
    const hex = sw.getAttribute('data-hex');
    sw.classList.toggle('active', hex.toUpperCase() === activeHex);
    sw.onclick = () => {
      swatches.forEach(other => other.classList.remove('active'));
      sw.classList.add('active');
      currentEditingColor = hex;
      if (!currentEditingAvatar) updateAvatarPreview();
    };
  });

  // Delete button
  if (deleteBtn) {
    if (isEdit && profile.name !== 'Principal') {
      deleteBtn.style.display = 'inline-flex';
      deleteBtn.onclick = async () => {
        if (!confirm(`¿Eliminar el perfil "${profile.name}"? Esta acción no se puede deshacer.`)) return;
        const deletePin = profile.has_pin ? await askCurrentProfilePin(profile) : '';
        if (deletePin === null) return;
        deleteBtn.disabled = true;
        try {
          const token = AuthManager.getToken();
          const res = await fetch('/api/profiles/delete', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ id: profile.id, pin: deletePin })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            modal.style.display = 'none';
            showToast('Perfil eliminado', 'info');
            loadProfilesView();
          } else {
            if (errorDiv) {
              errorDiv.textContent = data.error || 'No se pudo eliminar el perfil';
              errorDiv.style.display = 'block';
            }
          }
        } catch {
          if (errorDiv) {
            errorDiv.textContent = 'Error de conexión';
            errorDiv.style.display = 'block';
          }
        } finally {
          deleteBtn.disabled = false;
        }
      };
    } else {
      deleteBtn.style.display = 'none';
    }
  }

  // Cancel button
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      modal.style.display = 'none';
    };
  }

  // Save button
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const name = nameInput ? nameInput.value.trim() : '';
      if (!name) {
        if (errorDiv) {
          errorDiv.textContent = 'El nombre del perfil es requerido';
          errorDiv.style.display = 'block';
        }
        return;
      }
      if (name.length > 25) {
        if (errorDiv) {
          errorDiv.textContent = 'El nombre no puede tener más de 25 caracteres';
          errorDiv.style.display = 'block';
        }
        return;
      }

      saveBtn.disabled = true;
      if (errorDiv) errorDiv.style.display = 'none';

      const payload = {
        name,
        color: currentEditingColor,
        avatar: currentEditingAvatar || null,
        is_kids: kidsInput && kidsInput.checked ? 1 : 0
      };

      if (isEdit && profile.id) {
        payload.id = profile.id;
      }

      const pinVal = pinInput ? pinInput.value.trim() : '';
      if (removePinInput && removePinInput.checked && !pinVal) {
        payload.remove_pin = 1;
      }
      if (pinVal) {
        if (!/^\d{4}$/.test(pinVal)) {
          if (errorDiv) {
            errorDiv.textContent = 'El PIN debe contener exactamente 4 dígitos';
            errorDiv.style.display = 'block';
          }
          saveBtn.disabled = false;
          return;
        }
        payload.pin = pinVal;
      }

      // The backend requires the current PIN to modify a PIN-protected profile.
      if (isEdit && profile.has_pin) {
        const currentPin = await askCurrentProfilePin(profile);
        if (currentPin === null) {
          saveBtn.disabled = false;
          return;
        }
        payload.current_pin = currentPin;
      }

      try {
        const token = AuthManager.getToken();
        const res = await fetch('/api/profiles', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (data.token) {
            // Edited the active profile: keep the session's profile name and kids flag in sync.
            AuthManager.setSession(data.token, AuthManager.getUser(), data.profile);
            renderAuthState();
          }
          modal.style.display = 'none';
          showToast(isEdit ? 'Perfil actualizado' : 'Perfil creado con éxito', 'success');
          loadProfilesView();
        } else {
          if (errorDiv) {
            errorDiv.textContent = data.error || 'Error al guardar el perfil';
            errorDiv.style.display = 'block';
          }
        }
      } catch {
        if (errorDiv) {
          errorDiv.textContent = 'Error de red al guardar el perfil';
          errorDiv.style.display = 'block';
        }
      } finally {
        saveBtn.disabled = false;
      }
    };
  }
}

export function openPinModal(profile) {
  const modal = document.getElementById('pin-entry-modal');
  const nameEl = document.getElementById('pin-entry-profile-name');
  const errorEl = document.getElementById('pin-entry-error');
  const cancelBtn = document.getElementById('btn-cancel-pin');
  const digit1 = document.getElementById('pin-digit-1');
  const digit2 = document.getElementById('pin-digit-2');
  const digit3 = document.getElementById('pin-digit-3');
  const digit4 = document.getElementById('pin-digit-4');
  const digits = [digit1, digit2, digit3, digit4].filter(Boolean);

  if (!modal) return;
  modal.style.display = 'flex';
  if (nameEl) nameEl.textContent = profile.name || '';
  if (errorEl) errorEl.style.display = 'none';

  digits.forEach(d => { d.value = ''; });
  if (digit1) digit1.focus();

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      modal.style.display = 'none';
    };
  }

  digits.forEach((d, idx) => {
    d.oninput = async () => {
      if (d.value.length >= 1) {
        d.value = d.value.slice(-1);
        if (idx < digits.length - 1) {
          digits[idx + 1].focus();
        } else {
          const pin = digits.map(input => input.value).join('');
          if (pin.length === 4) {
            try {
              await AuthManager.selectProfile(profile.id, pin);
              modal.style.display = 'none';
              showToast('Perfil seleccionado', 'success');
              window.location.hash = '#/';
              window.location.reload();
            } catch (err) {
              if (errorEl) {
                errorEl.textContent = err.message || 'PIN incorrecto';
                errorEl.style.display = 'block';
              }
              digits.forEach(inp => { inp.value = ''; });
              if (digits[0]) digits[0].focus();
            }
          }
        }
      }
    };

    d.onkeydown = (e) => {
      if (e.key === 'Backspace' && !d.value && idx > 0) {
        digits[idx - 1].focus();
      }
    };

    // Pasting "1234" (from a password manager or a message) fills every box.
    d.onpaste = (e) => {
      const pasted = ((e.clipboardData || window.clipboardData)?.getData('text') || '').replace(/\D/g, '').slice(0, digits.length);
      if (pasted.length < 2) return;
      e.preventDefault();
      pasted.split('').forEach((char, i) => { if (digits[i]) digits[i].value = char; });
      digits[Math.min(pasted.length, digits.length) - 1].focus();
      digits[Math.min(pasted.length, digits.length) - 1].dispatchEvent(new Event('input'));
    };
  });
}

export async function loadProfilesView() {
  const grid = document.getElementById('profile-grid');
  const btnManage = document.getElementById('btn-manage-profiles');
  if (!grid) return;
  grid.innerHTML = '<div class="state-box"><div class="spinner"></div>Cargando perfiles...</div>';

  if (btnManage) {
    btnManage.textContent = isProfileManageMode ? 'Listo' : 'Administrar perfiles';
    btnManage.onclick = () => {
      isProfileManageMode = !isProfileManageMode;
      loadProfilesView();
    };
  }

  const token = (typeof AuthManager !== 'undefined' && typeof AuthManager.getToken === 'function') ? AuthManager.getToken() : null;

  try {
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const res = await fetch('/api/profiles', { headers });
    if (!res.ok) {
      if (res.status === 401) {
        grid.innerHTML = `
          <div class="empty-state col-span-all text-center">
            <p>Debes iniciar sesión para administrar tus perfiles.</p>
            <button class="btn btn-primary mt-10" id="btn-profiles-login">Iniciar Sesión</button>
          </div>
        `;
        const btnLogin = document.getElementById('btn-profiles-login');
        if (btnLogin && typeof openAuthModal === 'function') {
          btnLogin.onclick = () => openAuthModal('login');
        }
        return;
      }
      throw new Error('Error al obtener perfiles');
    }
    const data = await res.json();
    const profiles = Array.isArray(data) ? data : (data.profiles || []);

    const cardsHtml = profiles.map(p => {
      const avatarAttrs = p.avatar
        ? `data-bg-image="${escapeHtmlAttribute(p.avatar)}"`
        : `data-bg-color="${escapeHtmlAttribute(p.color || '#818CF8')}"`;
      const initial = p.avatar ? '' : escapeHtml((p.name || 'P')[0].toUpperCase());
      const editBadgeHtml = isProfileManageMode ? `
        <div class="profile-edit-badge">
          <i data-lucide="pencil" style="width: 14px; height: 14px;"></i>
        </div>
      ` : '';

      return `
        <button type="button" class="profile-card ${isProfileManageMode ? 'profile-card-manage' : ''}" data-profile-id="${escapeHtmlAttribute(p.id)}" aria-label="${escapeHtmlAttribute(isProfileManageMode ? `Editar perfil ${p.name}` : `Entrar como ${p.name}`)}" style="position: relative; cursor: pointer;">
          <div class="profile-avatar ${p.avatar ? 'has-image' : ''}" ${avatarAttrs}>
            ${initial}
            ${p.is_kids ? '<span class="profile-badge-kids">KIDS</span>' : ''}
            ${editBadgeHtml}
          </div>
          <div class="profile-name">${escapeHtml(p.name)}</div>
        </button>
      `;
    }).join('');

    const addCardHtml = isProfileManageMode ? `
      <button type="button" class="profile-card profile-card-add" id="card-add-profile" style="cursor: pointer;">
        <div class="profile-avatar">
          <i data-lucide="plus" style="width: 32px; height: 32px;"></i>
        </div>
        <div class="profile-name">Agregar perfil</div>
      </button>
    ` : '';

    grid.innerHTML = cardsHtml + addCardHtml;
    applyDynamicBackgrounds(grid);

    // Attach click events to cards
    grid.querySelectorAll('.profile-card[data-profile-id]').forEach(card => {
      const pid = card.getAttribute('data-profile-id');
      const profile = profiles.find(p => String(p.id) === String(pid));
      if (!profile) return;

      card.onclick = () => {
        if (isProfileManageMode) {
          openProfileEditModal('edit', profile);
        } else {
          if (profile.has_pin || profile.pin) {
            openPinModal(profile);
          } else {
            AuthManager.selectProfile(profile.id).then(() => {
              showToast('Perfil seleccionado', 'success');
              window.location.hash = '#/';
              window.location.reload();
            }).catch(err => {
              showToast(err.message || 'Error al seleccionar perfil', 'error');
            });
          }
        }
      };
    });

    const addCard = document.getElementById('card-add-profile');
    if (addCard) {
      addCard.onclick = () => {
        openProfileEditModal('create');
      };
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch {
    grid.innerHTML = '<div class="state-box state-box-error">Error al cargar perfiles.</div>';
  }
}

// -------------------------------------------------------------
// Global Bridge & DOM Initialization
// -------------------------------------------------------------

if (typeof window !== 'undefined') {
  window.escapeHtml = escapeHtml;
  window.escapeHtmlAttribute = escapeHtmlAttribute;
  window.catalogueImageUrl = catalogueImageUrl;
  window.setupCatalogueActions = setupCatalogueActions;
  window.renderBillboardHero = renderBillboardHero;
  window.renderContinueWatching = renderContinueWatching;
  window.createShowCardHTML = createShowCardHTML;
  window.renderEpisodeList = renderEpisodeList;
  window.showEpisodeDetails = showEpisodeDetails;
  window.loadShowDetails = loadShowDetails;
  window.renderMyListView = renderMyListView;
  window.renderHistoryView = renderHistoryView;
  window.loadPopularSidebar = loadPopularSidebar;
  window.renderCalendarDay = renderCalendarDay;
  window.openRandomAnimeModal = openRandomAnimeModal;
  window.renderStatsView = renderStatsView;
  window.formatWatchTime = formatWatchTime;
  window.loadProfilesView = loadProfilesView;
  window.openProfileEditModal = openProfileEditModal;
  window.openPinModal = openPinModal;
  window.loadNotifications = loadNotifications;
  window.joinWatchPartyByCode = joinWatchPartyByCode;
  window.setupWatchPartyModal = setupWatchPartyModal;
  window.openWatchPartyModal = openWatchPartyModal;
  window.closeWatchPartyModal = closeWatchPartyModal;
  window.setupRouter = setupRouter;
  window.playEpisode = (epId) => {
    if (epId) window.location.hash = `#/player/${encodeURIComponent(epId)}`;
  };
  window.renderAuthState = renderAuthState;
  window.openAuthModal = openAuthModal;
  window.closeAuthModal = closeAuthModal;
  window.openLoginDialog = openAuthModal;

  window.KuraStream = {
    auth: AuthManager,
    state: appState,
    showToast,
    openAuthModal,
    closeAuthModal,
    openWatchPartyModal,
    closeWatchPartyModal,
    renderAuthState,
    selectProfile: async (id) => {
      await AuthManager.selectProfile(id);
      window.location.hash = '#/';
      window.location.reload();
    }
  };
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('[KuraStream] v2.0 Platform initialized successfully.');
  setupCatalogueActions();
  initDialogs();
  setupWatchPartyModal();
  initHeaderDropdowns();
  setupRouter();
  loadNotifications();
  renderAuthState();
  setupAuthModalListeners();

  // A reload keeps the Watch Party this tab was in (the room code is remembered for the tab's lifetime).
  partyManager.restoreSession().then(room => {
    if (room && room.episode_id && !window.location.hash.startsWith('#/player/')) {
      window.location.hash = `#/player/${encodeURIComponent(room.episode_id)}`;
    }
  }).catch(() => {});

  // Load user preferences globally into window.userPreferences
  try {
    const { activeUser, profileName, token, hasProfile } = getUserAndProfile();
    if (hasProfile) {
      fetch(`/api/user/preferences?username=${encodeURIComponent(activeUser)}&profile_name=${encodeURIComponent(profileName)}`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data && data.preferences) {
            window.userPreferences = Object.assign(window.userPreferences || {}, data.preferences);
          }
        })
        .catch(() => {});
    }
  } catch (err) {
    console.warn('Failed to load initial user preferences:', err);
  }

  // Notifications Mark Read Action
  const btnMarkNotificationsRead = document.getElementById('btn-mark-notifications-read');

  if (btnMarkNotificationsRead) {
    btnMarkNotificationsRead.onclick = async (e) => {
      e.stopPropagation();
      try {
        const { activeUser, profileName } = getUserAndProfile();
        const token = (typeof AuthManager !== 'undefined' && typeof AuthManager.getToken === 'function') ? AuthManager.getToken() : null;
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api/notifications/seen', {
          method: 'POST',
          headers,
          body: JSON.stringify({ username: activeUser, profile_name: profileName })
        });
        if (res.ok) {
          const badge = document.getElementById('notification-badge');
          if (badge) {
            badge.textContent = '0';
            badge.style.display = 'none';
          }
          const list = document.getElementById('notifications-list');
          if (list) {
            list.querySelectorAll('.notification-item').forEach(item => {
              item.classList.add('notification-item-read');
              item.style.opacity = '0.65';
            });
          }
        }
      } catch (err) {
        console.error('Error marking notifications seen:', err);
      }
    };
  }

  // PWA install button: only shown once the browser offers installation
  const pwaInstallBtn = document.getElementById('pwa-install-btn');
  if (pwaInstallBtn) {
    let deferredInstallPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      pwaInstallBtn.style.display = 'inline-flex';
    });
    pwaInstallBtn.onclick = async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      pwaInstallBtn.style.display = 'none';
    };
    window.addEventListener('appinstalled', () => {
      pwaInstallBtn.style.display = 'none';
    });
  }

  // Random Anime Button
  const btnRandom = document.getElementById('btn-random-anime');
  if (btnRandom) {
    btnRandom.onclick = (e) => {
      e.preventDefault();
      openRandomAnimeModal();
    };
  }

  // Search Bar: filters the catalogue grid, jumping to it from any other view
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      catalogSearchQuery = e.target.value.toLowerCase().trim();
      if (currentView !== 'dashboard' && catalogSearchQuery) {
        window.location.hash = '#/';
        return;
      }
      applyCatalogSearch();
    });
  }

  // Mobile: the header search is hidden below 900px; this toggle opens it as a full-width bar
  const mobileSearchBtn = document.getElementById('btn-mobile-search');
  if (mobileSearchBtn && searchInput) {
    const setMobileSearch = (open) => {
      document.body.classList.toggle('mobile-search-open', open);
      mobileSearchBtn.setAttribute('aria-expanded', String(open));
      if (open) searchInput.focus();
    };
    mobileSearchBtn.addEventListener('click', () => {
      setMobileSearch(!document.body.classList.contains('mobile-search-open'));
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setMobileSearch(false);
    });
    searchInput.addEventListener('blur', () => {
      if (!searchInput.value) setMobileSearch(false);
    });
  }

  // Logout
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.onclick = (e) => {
      e.preventDefault();
      AuthManager.logout();
    };
  }
});
