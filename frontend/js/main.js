/**
 * KuraStream v2.0 - Canonical Application Entry Point
 * Orchestrates modular architecture, client routing, catalog rendering, and player lifecycle.
 */

import { AuthManager } from './core/auth.js';
import { appState } from './core/state.js';
import { playerController } from './features/player/player_controller.js';
import { initPlayer, destroyPlayer, getShowIdFromEpisodeId } from '../player.js?v=2026.09.26-modern-streaming-rc2';
import { partyManager } from './modules/party.js';
import { updateActiveNavHighlight, initHeaderDropdowns, initAdminSidebar, stopAdminPolling } from './modules/navigation.js';
import { initCardPopovers } from './modules/card_popover_preview.js';

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
      if (userProfileName) userProfileName.textContent = user.username || 'admin';
      if (userAvatarInitial) userAvatarInitial.textContent = (user.username || 'A')[0].toUpperCase();
      if (btnAdminDirect) btnAdminDirect.style.display = 'flex';
      if (btnSwitchProfile) btnSwitchProfile.style.display = 'none';
      if (profilesList) profilesList.style.display = 'none';
    } else {
      if (btnAdminDirect) btnAdminDirect.style.display = 'none';
      if (btnSwitchProfile) btnSwitchProfile.style.display = 'flex';
      if (profilesList) profilesList.style.display = 'block';

      if (activeProfile && activeProfile.name) {
        if (userProfileName) userProfileName.textContent = activeProfile.name;
        if (userAvatarInitial) userAvatarInitial.textContent = (activeProfile.name[0] || 'U').toUpperCase();
      } else {
        if (userProfileName) userProfileName.textContent = user.username || 'Usuario';
        if (userAvatarInitial) userAvatarInitial.textContent = (user.username || 'U')[0].toUpperCase();
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

  if (submitBtn) {
    submitBtn.addEventListener('click', handleAuthSubmit);
  }

  const handleKeydown = (e) => {
    if (modal && modal.style.display !== 'none' && modal.style.display !== '') {
      if (e.key === 'Escape') {
        closeAuthModal();
      } else if (e.key === 'Enter') {
        if (document.activeElement === userInput || document.activeElement === passInput) {
          e.preventDefault();
          handleAuthSubmit();
        }
      }
    }
  };
  document.addEventListener('keydown', handleKeydown);
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

export function renderBillboardHero(featuredShow) {
  if (!featuredShow) return '';
  const rawBg = featuredShow.backdrop_path || featuredShow.poster_path || '';
  const bgUrl = catalogueImageUrl(rawBg) || '/assets/illustrations/backdrop_placeholder.svg';
  const rating = (featuredShow.rating && Number(featuredShow.rating) > 0) ? Number(featuredShow.rating).toFixed(1) : 'N/A';
  const year = featuredShow.year ? String(featuredShow.year) : 'N/A';
  const genres = featuredShow.genres
    ? String(featuredShow.genres).split(',').slice(0, 3).map(g => `<span class="billboard-genre-tag">${escapeHtml(g.trim())}</span>`).join('')
    : '<span class="billboard-genre-tag">Anime</span>';
  const synopsis = featuredShow.synopsis || 'Sin sinopsis disponible.';

  return `
    <div class="billboard-hero">
      <img class="billboard-hero-background" src="${escapeHtmlAttribute(bgUrl)}" alt="">
      <div class="billboard-hero-vignette"></div>
      <div class="billboard-hero-content">
        <div class="billboard-hero-badges">
          <span class="badge-hd">HD</span>
          <span class="badge-rating"><i data-lucide="star" style="width:14px;height:14px;fill:var(--rating-color);stroke:var(--rating-color);display:inline-block;vertical-align:-2px;margin-right:2px;"></i>${rating}</span>
          <span class="badge-year">${escapeHtml(year)}</span>
          <div class="billboard-genres">${genres}</div>
        </div>
        <h1 class="billboard-hero-title">${escapeHtml(featuredShow.title)}</h1>
        <p class="billboard-hero-synopsis">${escapeHtml(synopsis)}</p>
        <div class="billboard-hero-actions">
          <button class="btn-billboard-play" data-catalogue-route="${escapeHtmlAttribute('#/show/' + encodeURIComponent(featuredShow.id))}">
            <i data-lucide="play" style="width:20px;height:20px;fill:currentColor;stroke:currentColor;vertical-align:middle;margin-right:8px;"></i> Reproducir
          </button>
          <button class="btn-billboard-info" data-catalogue-route="${escapeHtmlAttribute('#/show/' + encodeURIComponent(featuredShow.id))}">
            <i data-lucide="info" style="width:20px;height:20px;vertical-align:middle;margin-right:8px;"></i> Más información
          </button>
        </div>
      </div>
    </div>
  `;
}

export function renderContinueWatching(historyItems) {
  if (!Array.isArray(historyItems) || historyItems.length === 0) return '';

  const inProgress = historyItems.filter(item => {
    const isCompleted = item.completed === 1 || item.completed === true || item.completed === '1';
    const hasProgress = (item.progress_seconds || 0) > 0;
    const dur = (item.duration > 0) ? item.duration : (item.ep_duration || 0);
    const notFinished = dur > 0 ? (item.progress_seconds < dur * 0.95) : true;
    return hasProgress && !isCompleted && notFinished;
  });

  if (inProgress.length === 0) return '';

  const cardsHTML = inProgress.map(item => {
    const dur = (item.duration > 0) ? item.duration : (item.ep_duration || 1);
    const progressPercent = Math.min(100, Math.max(0, ((item.progress_seconds || 0) / dur) * 100));
    const img = item.thumbnail_path || item.poster_path || '';
    const imgUrl = catalogueImageUrl(img) || '/assets/illustrations/backdrop_placeholder.svg';
    const epLabel = item.season_number ? `T${item.season_number}:E${item.episode_number}` : (item.episode_number ? `E${item.episode_number}` : 'Película');
    const remainingSec = Math.max(0, dur - (item.progress_seconds || 0));
    const remainingMin = Math.ceil(remainingSec / 60);
    const remainingText = remainingMin > 0 ? `${remainingMin} min restantes` : `${Math.round(progressPercent)}% visto`;
    const subtext = `${epLabel} • ${remainingText}`;

    return `
      <div class="continue-watching-card" role="link" tabindex="0" data-catalogue-route="${escapeHtmlAttribute('#/player/' + encodeURIComponent(item.episode_id))}" title="${escapeHtmlAttribute(`${item.show_title || ''} - ${item.episode_title || epLabel}`)}" style="cursor: pointer;">
        <div class="continue-watching-thumb-wrapper" style="overflow: hidden; border-radius: var(--radius-sm);">
          <img class="continue-watching-thumb" src="${escapeHtmlAttribute(imgUrl)}" alt="${escapeHtmlAttribute(item.show_title || '')}" loading="lazy" style="transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);">
          <div class="continue-watching-play-btn" aria-label="Reproducir">
            <i data-lucide="play" style="width: 20px; height: 20px; fill: #ffffff; stroke: #ffffff;"></i>
          </div>
          <div class="continue-watching-progress-bar">
            <div class="continue-watching-progress-fill" style="width: ${progressPercent}%;"></div>
          </div>
        </div>
        <div class="continue-watching-info">
          <h4 class="continue-watching-title">${escapeHtml(item.show_title || '')}</h4>
          <span class="continue-watching-subtext" style="font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-variant-numeric: tabular-nums;">${escapeHtml(subtext)}</span>
          <div class="continue-watching-action" style="margin-top: 4px; color: var(--accent-color); font-size: 0.8rem; font-weight: 700;">Continuar <i data-lucide="chevron-right" style="width: 12px; height: 12px; vertical-align: middle;"></i></div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <section class="dashboard-section continue-watching-section" style="margin-bottom: 30px;">
      <h2 class="section-title" style="font-family: var(--font-title); font-size: 1.3rem; margin-bottom: 16px; font-weight: 700;">Continuar Viendo</h2>
      <div class="continue-watching-rail" style="display: flex; gap: 16px; overflow-x: auto; padding-bottom: 8px;">
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
  if (historyItem && historyItem.duration) {
    const progressPercent = Math.min(100, Math.max(0, ((historyItem.progress_seconds || 0) / historyItem.duration) * 100));
    progressHTML = `
      <div class="card-progress-bar-container" style="position: absolute; bottom: 0; left: 0; right: 0; height: 5px; background: rgba(255,255,255,0.2); z-index: 2;">
        <div class="card-progress-bar" style="width: ${progressPercent}%; height: 100%; background: var(--accent-color);"></div>
      </div>
      <div class="card-continue-watching-indicator" style="position: absolute; top: 10px; left: 10px; background: rgba(var(--accent-rgb), 0.95); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 4px; padding: 2px 6px; font-size: 0.65rem; font-family: var(--font-title); font-weight: 700; color: white; display: flex; align-items: center; gap: 3px; z-index: 2; box-shadow: 0 2px 8px rgba(0,0,0,0.5);">
        <i data-lucide="play" style="width: 8px; height: 8px; fill: white; stroke: white;"></i>
        ${Math.round(progressPercent)}% visto
      </div>
    `;
  }

  const isAiring = show.status === 'airing';
  const airingBadgeHTML = isAiring ? `
    <div class="badge-airing-neon">
      <span class="airing-pulse-dot" style="width:6px;height:6px;background:var(--success-color);border-radius:50%;display:inline-block;animation:pulseGlow 1.8s infinite;"></span> EMISIÓN
    </div>
  ` : '';

  return `
    <div class="show-card" role="link" tabindex="0" data-catalogue-route="${escapeHtmlAttribute('#/show/' + encodeURIComponent(show.id))}" style="flex: 0 0 auto; width: 180px; height: 320px; transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1); will-change: transform; cursor: pointer;">
      <div class="card-img-wrapper" style="height: 250px; position: relative; background-color: var(--surface-muted); border-radius: var(--radius-sm); overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
        <img src="${escapeHtmlAttribute(posterSrc)}" alt="${escapeHtmlAttribute(show.title)}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 0.4s ease;" onload="this.style.opacity=1">
        <div class="card-rating-badge" style="position: absolute; top: 8px; right: 8px; background: rgba(9, 13, 14, 0.85); backdrop-filter: blur(4px); padding: 4px 6px; border-radius: var(--radius-xs); border: 1px solid rgba(255,255,255,0.08); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-variant-numeric: tabular-nums; font-size: 0.75rem; font-weight: 700; display: flex; align-items: center; gap: 4px;">
          <i data-lucide="star" style="width:12px;height:12px;fill:var(--rating-color);stroke:var(--rating-color);"></i>${rating}
        </div>
        ${airingBadgeHTML}
        ${progressHTML}
      </div>
      <div class="card-info" style="padding-top: 10px;">
        <h3 class="card-title" style="font-size: 0.9rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.01em;">${escapeHtml(show.title)}</h3>
        <div class="card-meta" style="font-size: 0.75rem; color: var(--text-muted); font-family: ui-monospace, SFMono-Regular, monospace; font-variant-numeric: tabular-nums; margin-top: 4px;">
          <span>${show.media_type === 'movie' ? 'PELÍCULA' : 'ANIME'}</span>
          <span style="margin: 0 4px; opacity: 0.5;">•</span>
          <span>${escapeHtml(show.year || '')}</span>
        </div>
      </div>
    </div>
  `;
}

export function renderEpisodeList(epList, targetContainer, fallbackPoster = '', showProgressMap = {}) {
  if (!targetContainer) return;
  if (!epList || epList.length === 0) {
    targetContainer.innerHTML = '<div class="empty-state" style="padding: 20px; color: var(--text-muted);">No hay capítulos importados en esta temporada.</div>';
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
        <i data-lucide="check" style="width: 12px; height: 12px; stroke-width: 3;"></i> VISTO
      </div>
    ` : '';

    const progressBarHTML = isInProgress ? `
      <div class="episode-progress-bar">
        <div class="episode-progress-fill" style="width: ${Math.round(progressPercent)}%;"></div>
      </div>
    ` : '';

    return `
      <div class="episode-item" role="button" tabindex="0" data-episode-id="${escapeHtmlAttribute(ep.id)}">
        <div class="episode-thumbnail-container" style="aspect-ratio: 16 / 9; width: 160px; background-color: var(--surface-muted); border-radius: var(--radius-sm); overflow: hidden; position: relative; flex-shrink: 0;">
          <img class="episode-thumb" src="${escapeHtmlAttribute(thumbSrc)}" alt="${escapeHtmlAttribute(ep.title || 'Episodio')}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;">
          <div style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.8); border-radius: 4px; padding: 2px 6px; font-size: 0.75rem; font-weight: 700; color: white; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-variant-numeric: tabular-nums;">
             ${durationMin > 0 ? `${durationMin}m` : ''}
          </div>
          ${completedBadgeHTML}
          ${progressBarHTML}
          <div class="episode-play-overlay">
            <span class="play-icon-small"><i data-lucide="play" style="width:20px;height:20px;fill:currentColor;"></i></span>
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
    if (audioTracks.length === 0) {
      audioEl.innerHTML = '<li>Información no disponible</li>';
    } else {
      audioEl.innerHTML = audioTracks.map(t => {
        const title = t.title || `Pista ${t.track_number || 1}`;
        const lang = t.language ? t.language.toUpperCase() : 'UND';
        return `<li>${escapeHtml(title)} [${escapeHtml(lang)}]</li>`;
      }).join('');
    }
  }

  if (subsEl) {
    let subtitleTracks = [];
    if (ep.subtitle_tracks) {
      try {
        subtitleTracks = typeof ep.subtitle_tracks === 'string' ? JSON.parse(ep.subtitle_tracks) : ep.subtitle_tracks;
      } catch {
        subtitleTracks = [];
      }
    }
    if (!Array.isArray(subtitleTracks)) subtitleTracks = [];
    if (subtitleTracks.length === 0) {
      subsEl.innerHTML = '<li>Sin subtítulos incrustados</li>';
    } else {
      subsEl.innerHTML = subtitleTracks.map(t => {
        const title = t.title || `Pista ${t.track_number || 1}`;
        const lang = t.language ? t.language.toUpperCase() : 'UND';
        return `<li>${escapeHtml(title)} [${escapeHtml(lang)}]</li>`;
      }).join('');
    }
  }

  if (playBtn) {
    playBtn.onclick = () => {
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
    modal.style.display = 'flex';
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

export async function loadShowDetails(id) {
  const detailTitle = document.getElementById('detail-title');
  const detailSynopsis = document.getElementById('detail-synopsis');
  const detailPoster = document.getElementById('detail-poster');
  const detailRating = document.getElementById('detail-rating');
  const detailYear = document.getElementById('detail-year');
  const detailCast = document.getElementById('detail-cast');
  const seasonTabs = document.getElementById('season-tabs');
  const episodesList = document.getElementById('episodes-list');

  if (detailTitle) detailTitle.textContent = 'Cargando...';
  if (detailSynopsis) detailSynopsis.textContent = '';
  if (detailCast) detailCast.innerHTML = '';

  try {
    const res = await fetch(`/api/shows/${encodeURIComponent(id)}`);
    if (res.ok !== undefined && !res.ok) {
      throw new Error(`Error ${res.status}: no se pudo cargar el show`);
    }
    const data = await res.json();
    const show = data.show || data;
    const episodes = Array.isArray(data.episodes) ? data.episodes : (show.episodes || []);
    currentShowEpisodes = episodes;

    if (detailTitle) detailTitle.textContent = show.title || 'Detalle del Anime';
    if (detailSynopsis) detailSynopsis.textContent = show.synopsis || 'Sin sinopsis disponible.';
    const detailPosterSrc = catalogueImageUrl(show.poster_path || '') || '/assets/illustrations/poster_placeholder.svg';
    if (detailPoster) {
      detailPoster.onerror = () => { detailPoster.src = '/assets/illustrations/poster_placeholder.svg'; };
      detailPoster.src = detailPosterSrc;
    }
    const ambientBg = document.querySelector('.detail-ambient-bg');
    if (ambientBg) {
      const backdropUrl = catalogueImageUrl(show.backdrop_path || show.poster_path || '') || '/assets/illustrations/backdrop_placeholder.svg';
      ambientBg.style.backgroundImage = `url("${backdropUrl}")`;
    }
    if (detailRating) detailRating.textContent = show.rating ? Number(show.rating).toFixed(1) : 'N/A';
    if (detailYear) detailYear.textContent = show.year || 'N/A';

    // Badges row
    let metaBadgesEl = document.getElementById('detail-meta-badges');
    if (!metaBadgesEl && detailTitle) {
      metaBadgesEl = document.createElement('div');
      metaBadgesEl.id = 'detail-meta-badges';
      metaBadgesEl.className = 'detail-meta-row';
      detailTitle.insertAdjacentElement('afterend', metaBadgesEl);
    }
    if (metaBadgesEl) {
      metaBadgesEl.innerHTML = `
        <span class="detail-badge-pill"><i data-lucide="star" style="width:13px;height:13px;fill:currentColor;"></i> ${show.rating ? Number(show.rating).toFixed(1) : 'N/A'}</span>
        <span class="detail-badge-pill">${escapeHtml(show.year || 'N/A')}</span>
        <span class="badge" style="background: rgba(255,255,255,0.08);">${show.status === 'airing' ? 'En Emisión' : 'Finalizado'}</span>
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
        detailCast.innerHTML = '<p style="color: var(--text-muted);">Sin información de reparto.</p>';
      } else {
        detailCast.innerHTML = cast.map(c => `
          <div class="cast-chip">
            <span class="cast-character">${escapeHtml(c.character || 'Personaje')}</span>
            <span class="cast-actor">(${escapeHtml(c.name || 'Actor')})</span>
          </div>
        `).join('');
      }
    }

    // Seasons and episodes
    if (seasonTabs && episodesList) {
      const seasons = {};
      episodes.forEach(ep => {
        const sNum = ep.season_number || 1;
        if (!seasons[sNum]) seasons[sNum] = [];
        seasons[sNum].push(ep);
      });

      const seasonNums = Object.keys(seasons).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
      seasonTabs.innerHTML = seasonNums.map((num, idx) => `
        <button class="season-tab ${idx === 0 ? 'active' : ''}" data-season="${escapeHtmlAttribute(num)}">Temporada ${escapeHtml(num)}</button>
      `).join('');

      const firstSeason = seasonNums[0] || 1;
      renderEpisodeList(seasons[firstSeason] || episodes, episodesList, show.poster_path);

      seasonTabs.querySelectorAll('.season-tab').forEach(tab => {
        tab.onclick = () => {
          seasonTabs.querySelectorAll('.season-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const sNum = tab.getAttribute('data-season');
          renderEpisodeList(seasons[sNum] || [], episodesList, show.poster_path);
        };
      });
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
    loadPopularSidebar(id).catch(() => {});
  } catch (err) {
    console.error('Error loading show details:', err);
    if (detailTitle) detailTitle.textContent = 'Error';
  }
}

export async function renderMyListView() {
  const container = document.getElementById('mylist-grid');
  if (!container) return;

  container.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-muted); grid-column: 1 / -1;">Cargando tu lista...</div>`;
  const { activeUser, profileName, token } = getUserAndProfile();
  let favorites = [];

  try {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`/api/favorites?username=${encodeURIComponent(activeUser)}&profile_name=${encodeURIComponent(profileName)}`, { headers });
    if (res.ok) {
      favorites = await res.json();
    }
  } catch (e) {
    console.warn('Error fetching favorites:', e);
  }

  if (!Array.isArray(favorites) || favorites.length === 0) {
    container.innerHTML = `
      <div class="empty-state-card" style="grid-column: 1 / -1;">
        <img src="/assets/illustrations/empty_watchlist.svg" alt="" class="empty-state-img">
        <h3>Tu lista está vacía</h3>
        <p>Guarda tus series y películas favoritas para encontrarlas fácilmente en cualquier momento.</p>
        <a href="#/" class="btn btn-primary"><i data-lucide="compass"></i> Explorar Catálogo</a>
      </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  container.innerHTML = favorites.map(s => createShowCardHTML(s)).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

export async function renderHistoryView() {
  const container = document.getElementById('history-list');
  if (!container) return;

  container.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-muted);"><div class="spinner" style="margin: 0 auto 12px auto;"></div>Cargando historial...</div>`;
  const { activeUser, profileName, token } = getUserAndProfile();
  let historyItems = [];

  try {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`/api/history?username=${encodeURIComponent(activeUser)}&profile_name=${encodeURIComponent(profileName)}`, { headers });
    if (res.ok) {
      historyItems = await res.json();
    }
  } catch (e) {
    console.warn('Error fetching history:', e);
  }

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

  container.innerHTML = historyItems.map(item => {
    const poster = item.thumbnail_path || item.poster_path || '';
    const progressPercent = item.duration > 0 ? Math.min(100, Math.round(((item.progress_seconds || 0) / item.duration) * 100)) : 0;
    const showTitle = item.show_title || item.title || '';
    const epTitle = item.episode_title || item.title || `Episodio ${item.episode_number || ''}`;
    const seasonEpStr = item.season_number && item.episode_number ? `T${item.season_number} E${item.episode_number}` : (item.episode_number ? `Ep. ${item.episode_number}` : '');

    return `
      <div class="history-item">
        <img src="${escapeHtmlAttribute(catalogueImageUrl(poster))}" alt="${escapeHtmlAttribute(showTitle)}">
        <div class="history-item-info">
          <h4>${escapeHtml(showTitle)}</h4>
          <span>${escapeHtml(seasonEpStr ? seasonEpStr + ' - ' : '')}${escapeHtml(epTitle)} • ${progressPercent}% visto</span>
        </div>
        <a href="${escapeHtmlAttribute('#/player/' + encodeURIComponent(item.episode_id))}" class="btn btn-secondary">Reproducir</a>
      </div>
    `;
  }).join('');

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

export async function loadPopularSidebar(currentShowId) {
  const popularSidebar = document.getElementById('detail-popular-sidebar');
  if (!popularSidebar) return;

  try {
    const res = await fetch('/api/shows');
    const allShows = await res.json();
    const popularShows = (Array.isArray(allShows) ? allShows : (allShows.shows || []))
      .filter(s => s.id !== currentShowId)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 5);

    if (popularShows.length === 0) {
      popularSidebar.style.display = 'none';
      return;
    }

    popularSidebar.innerHTML = `
      <h3 style="font-family: var(--font-title); font-size: 1.1rem; margin-bottom: 14px;">Populares</h3>
      ${popularShows.map(s => `
        <a class="popular-item" href="${escapeHtmlAttribute('#/show/' + encodeURIComponent(s.id))}" data-catalogue-route="${escapeHtmlAttribute('#/show/' + encodeURIComponent(s.id))}" style="display: flex; gap: 10px; margin-bottom: 10px; cursor: pointer; text-decoration: none; color: inherit;">
          <img src="${escapeHtmlAttribute(catalogueImageUrl(s.poster_path || ''))}" alt="${escapeHtmlAttribute(s.title)}" style="width: 50px; height: 70px; object-fit: cover; border-radius: 4px;">
          <div>
            <h4 style="font-size: 0.85rem; margin: 0 0 4px 0;">${escapeHtml(s.title)}</h4>
            <span style="font-size: 0.75rem; color: var(--accent-color); display: inline-flex; align-items: center; gap: 3px;">${(s.rating && Number(s.rating) > 0) ? `<i data-lucide="star" style="width: 12px; height: 12px;"></i> ${Number(s.rating).toFixed(1)}` : '<span style="color: var(--text-muted);">N/A</span>'}</span>
          </div>
        </a>
      `).join('')}
    `;
  } catch {
    popularSidebar.style.display = 'none';
  }
}

export function renderCalendarDay(dayName) {
  const gridContainer = document.getElementById('calendar-grid-content');
  if (!gridContainer || !calendarDataCache) return;

  const showsList = calendarDataCache[dayName] || [];

  if (showsList.length === 0) {
    gridContainer.innerHTML = `
      <div class="empty-state" style="text-align: center; padding: 60px; color: var(--text-muted);">
        <i data-lucide="calendar-off" style="width:48px;height:48px;margin-bottom:10px;display:inline-block;"></i>
        <h2>No hay estrenos programados para este día</h2>
      </div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  gridContainer.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px;">
      ${showsList.map(item => {
        const cover = item.cover_image || '';
        const inLibBadge = item.in_library ? `
          <div style="position: absolute; top: 10px; right: 10px; background: #2DD4BF; color: #000; font-family: var(--font-title); font-size: 0.7rem; font-weight: 800; padding: 4px 10px; border-radius: 4px; box-shadow: 0 0 10px rgba(45,212,191,0.5); z-index: 3; display: flex; align-items: center; gap: 4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> EN TU BIBLIOTECA
          </div>
        ` : '';

        return `
          <div class="calendar-show-card" style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 4px; overflow: hidden; position: relative;">
            <div style="height: 160px; position: relative; overflow: hidden;">
              <img src="${escapeHtmlAttribute(catalogueImageUrl(cover))}" alt="${escapeHtmlAttribute(item.title || '')}" style="width: 100%; height: 100%; object-fit: cover;">
              ${inLibBadge}
            </div>
            <div style="padding: 14px;">
              <h3 style="font-size: 0.95rem; margin: 0 0 6px 0;">${escapeHtml(item.title || '')}</h3>
              <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0;">${escapeHtml(item.studio || '')} • ${escapeHtml(item.episode || '')}</p>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

export async function openRandomAnimeModal() {
  const modal = document.getElementById('random-modal');
  const cardBody = document.getElementById('random-card-body');
  if (!modal || !cardBody) return;

  modal.style.display = 'flex';
  cardBody.className = 'random-card';
  cardBody.innerHTML = `<div style="padding: 40px; text-align: center;"><div class="spinner" style="margin: 0 auto 15px auto;"></div>Buscando anime aleatorio...</div>`;

  try {
    const res = await fetch('/api/shows/random');
    const data = await res.json();
    const show = data.show || data;

    cardBody.innerHTML = `
      <div style="padding: 24px; text-align: center;">
        <img src="${escapeHtmlAttribute(catalogueImageUrl(show.poster_path || ''))}" alt="${escapeHtmlAttribute(show.title)}" style="max-height: 250px; border-radius: 6px; margin-bottom: 16px;">
        <h3 style="margin-bottom: 8px;">${escapeHtml(show.title)}</h3>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 20px;">${escapeHtml(show.synopsis || '')}</p>
        <a class="btn btn-primary" id="random-card-watch-btn" href="${escapeHtmlAttribute('#/show/' + encodeURIComponent(show.id))}" style="text-decoration: none;">Ver Anime</a>
      </div>
    `;
    const watchBtn = document.getElementById('random-card-watch-btn');
    if (watchBtn) {
      watchBtn.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }
  } catch (err) {
    cardBody.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--danger-color);">Error al buscar anime aleatorio.</div>`;
  }
}

export async function renderStatsView() {
  const cardsGrid = document.getElementById('stats-cards-grid');
  const chartContainer = document.getElementById('stats-genre-chart');
  if (!cardsGrid || !chartContainer) return;

  cardsGrid.innerHTML = `<div style="grid-column: 1 / -1; padding: 30px; text-align: center; color: var(--text-muted);"><div class="spinner" style="margin: 0 auto 15px auto;"></div>Cargando estadísticas...</div>`;
  chartContainer.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-muted);">Cargando gráfico...</div>`;

  const { activeUser, profileName, token } = getUserAndProfile();
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
    const res = await fetch(`/api/user/stats?username=${encodeURIComponent(activeUser)}&profile_name=${encodeURIComponent(profileName)}`, { headers });
    if (res.ok) {
      const data = await res.json();
      stats = data.stats || data || stats;
    }
  } catch (e) {
    console.warn('Error fetching stats:', e);
  }

  const hours = Math.round((stats.total_time_seconds || 0) / 3600);
  cardsGrid.innerHTML = `
    <div class="stat-card">
      <span class="stat-card-label">Tiempo Total</span>
      <div class="stat-card-value" style="color: var(--info-color);">${hours} horas</div>
    </div>
    <div class="stat-card">
      <span class="stat-card-label">Capítulos Vistos</span>
      <div class="stat-card-value" style="color: var(--accent-color);">${stats.watched_episodes || 0}</div>
    </div>
    <div class="stat-card">
      <span class="stat-card-label">Series Completadas</span>
      <div class="stat-card-value" style="color: var(--success-color);">${stats.completed_shows || 0}</div>
    </div>
  `;

  chartContainer.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem;">Género favorito: <strong style="color: var(--info-color);">${escapeHtml(stats.top_genre || 'Anime')}</strong></p>`;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

export async function loadNotifications() {
  const badge = document.getElementById('notification-badge');
  const list = document.getElementById('notifications-list');

  const { activeUser, profileName } = getUserAndProfile();
  let notifications = [];
  let unreadCount = 0;

  try {
    const token = (typeof AuthManager !== 'undefined' && typeof AuthManager.getToken === 'function') ? AuthManager.getToken() : null;
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    const res = await fetch(`/api/notifications?username=${encodeURIComponent(activeUser)}&profile_name=${encodeURIComponent(profileName)}`, { headers });
    if (res.ok) {
      const data = await res.json();
      notifications = Array.isArray(data) ? data : (data.notifications || []);
      unreadCount = (typeof data.unread_count === 'number') ? data.unread_count : notifications.length;
    }
  } catch (err) {
    console.error("Error loading notifications:", err);
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
      list.innerHTML = `<div class="notification-empty" style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No hay notificaciones sin leer</div>`;
    } else {
      list.innerHTML = notifications.map(item => {
        const epNum = item.episode_number || item.episode || 1;
        const seasonNum = item.season_number || item.season || '';
        const title = item.show_title || item.title || 'Nuevo episodio';
        const poster = item.poster_path || `/api/placeholder-poster?title=${encodeURIComponent(title)}`;
        const targetHash = item.episode_id ? `#/player/${encodeURIComponent(item.episode_id)}` : `#/show/${encodeURIComponent(item.show_id)}`;

        const isUnread = !!item.is_unread;
        const readClass = isUnread ? '' : ' notification-item-read';
        const opacityStyle = isUnread ? '' : ' style="opacity: 0.65;"';

        return `
          <a href="${escapeHtmlAttribute(targetHash)}" class="notification-item${readClass}"${opacityStyle} data-show-id="${escapeHtmlAttribute(item.show_id || '')}" data-episode-id="${escapeHtmlAttribute(item.episode_id || '')}">
            <img src="${escapeHtmlAttribute(catalogueImageUrl(poster))}" alt="${escapeHtmlAttribute(title)}" class="notification-poster" onerror="this.onerror=null;this.src='/api/placeholder-poster?title=Show';">
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

export function setupWatchPartyModal() {
  const modal = document.getElementById('modal-watch-party');
  const navPartyBtn = document.getElementById('nav-party');
  if (!modal) return;

  if (navPartyBtn) {
    navPartyBtn.onclick = (e) => {
      e.preventDefault();
      modal.style.display = 'flex';
    };
  }

  const closeBtn = document.getElementById('party-modal-close');
  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.style.display = 'none';
    };
  }

  const joinBtn = document.getElementById('party-join-submit-btn');
  const codeInput = document.getElementById('party-join-code-input');
  const nameInput = document.getElementById('party-join-name-input');
  if (joinBtn) {
    joinBtn.onclick = async () => {
      const code = codeInput ? codeInput.value.trim() : '';
      const name = nameInput ? nameInput.value.trim() : '';
      if (!code) {
        showToast('Por favor introduce el código de la sala', 'warning');
        return;
      }
      modal.style.display = 'none';
      await joinWatchPartyByCode(code, name);
    };
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
    if (typeof updateMosaicBgVisibility === 'function') updateMosaicBgVisibility();
    if (typeof renderAuthState === 'function') renderAuthState();

    const rawHash = window.location.hash || '#/';
    const [routeWithPrefix] = rawHash.split('?');
    const path = routeWithPrefix.replace(/^#/, '') || '/';
    
    if (typeof updateActiveNavHighlight === 'function') updateActiveNavHighlight(rawHash);

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
      if (typeof resetChameleonTheme === 'function') resetChameleonTheme();
      const trailerModal = document.getElementById('trailer-modal');
      const trailerIframe = document.getElementById('trailer-iframe');
      if (trailerModal) trailerModal.style.display = 'none';
      if (trailerIframe) trailerIframe.src = '';
    }

    const partyModal = document.getElementById('modal-watch-party');
    if (partyModal) partyModal.style.display = 'none';

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
    } else if (path === '/airing' || path === '/calendar') {
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
      if (typeof initAdminSidebar === 'function') initAdminSidebar();
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
    } else if (path.startsWith('/party/')) {
      const roomId = decodeURIComponent(path.replace(/^\/party\//, '')).trim();
      if (roomId) {
        if (typeof joinWatchPartyByCode === 'function') await joinWatchPartyByCode(roomId);
      } else {
        if (typeof setupWatchPartyModal === 'function') setupWatchPartyModal();
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
  };

  window.addEventListener('hashchange', handleRoute);
  window.addEventListener('popstate', handleRoute);
  handleRoute();
}

async function initCatalogView(filterType = 'all') {
  const heroContainer = document.getElementById('hero-carousel-container');
  const heroWrapper = document.getElementById('hero-carousel-wrapper');
  const dashboardSections = document.getElementById('dashboard-sections');

  try {
    const res = await fetch('/api/shows');
    const data = await res.json();
    let shows = Array.isArray(data) ? data : (data.shows || []);
    if (filterType === 'movie') {
      shows = shows.filter(s => s.media_type === 'movie' || s.type === 'movie');
    }
    appState.set('catalog', shows);

    // Hero Billboard
    if (heroContainer && heroWrapper && shows.length > 0) {
      const featured = shows.find(s => s.is_featured) || shows[0];
      heroContainer.style.display = 'block';
      heroWrapper.innerHTML = renderBillboardHero(featured);
    }

    // Continue Watching
    const { activeUser, profileName, token } = getUserAndProfile();
    let history = [];
    try {
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const histRes = await fetch(`/api/history?username=${encodeURIComponent(activeUser)}&profile_name=${encodeURIComponent(profileName)}`, { headers });
      if (histRes.ok) history = await histRes.json();
    } catch {}

    if (dashboardSections) {
      const continueHtml = renderContinueWatching(history);
      const catalogHtml = `
        <section class="catalog-section" style="margin-top: 24px;">
          <h2 class="section-title" style="font-family: var(--font-title); font-size: 1.3rem; margin-bottom: 16px; font-weight: 700;">
            ${filterType === 'movie' ? 'Películas Disponibles' : 'Catálogo Completo'}
          </h2>
          <div class="shows-grid" style="display: flex; flex-wrap: wrap; gap: 20px;">
            ${shows.map(s => createShowCardHTML(s)).join('')}
          </div>
        </section>
      `;
      dashboardSections.innerHTML = continueHtml + catalogHtml;
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
    try { initCardPopovers(); } catch {}
  } catch (err) {
    console.error('Error initializing catalog view:', err);
  }
}

async function loadCalendarView() {
  const dayTabs = document.getElementById('day-picker-tabs');
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const todayDay = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  try {
    const res = await fetch('/api/calendar');
    if (res.ok) {
      calendarDataCache = await res.json();
    }
  } catch (e) {
    console.warn('Error loading calendar:', e);
  }

  if (dayTabs) {
    dayTabs.querySelectorAll('.day-tab').forEach(tab => {
      tab.onclick = () => {
        dayTabs.querySelectorAll('.day-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const day = tab.getAttribute('data-day');
        renderCalendarDay(day);
      };
    });
  }

  const initialDay = days.includes(todayDay) ? todayDay : 'Monday';
  renderCalendarDay(initialDay);
}

async function renderGenresView() {
  const genresGrid = document.getElementById('genres-grid');
  if (!genresGrid) return;
  const genres = ['Acción', 'Aventura', 'Comedia', 'Drama', 'Fantasía', 'Ciencia Ficción', 'Romance', 'Sobrenatural', 'Misterio'];

  genresGrid.innerHTML = genres.map(g => `
    <div class="genre-card" onclick="window.location.hash='#/genres?genre=${encodeURIComponent(g)}'">
      <h3>${escapeHtml(g)}</h3>
    </div>
  `).join('');
}

async function loadSettingsView() {
  const { activeUser, profileName, token } = getUserAndProfile();
  const skipIntroCheckbox = document.getElementById('pref-auto-skip-intro');
  const playNextCheckbox = document.getElementById('pref-auto-play-next');

  try {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`/api/user/preferences?username=${encodeURIComponent(activeUser)}&profile_name=${encodeURIComponent(profileName)}`, { headers });
    if (res.ok) {
      const data = await res.json();
      const prefs = data.preferences || data;
      if (skipIntroCheckbox) skipIntroCheckbox.checked = Boolean(prefs.auto_skip_intro);
      if (playNextCheckbox) playNextCheckbox.checked = Boolean(prefs.auto_play_next);
    }
  } catch (e) {
    console.warn('Error loading settings:', e);
  }
}

async function loadProfilesView() {
  const grid = document.getElementById('profile-grid');
  if (!grid) return;
  grid.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted);"><div class="spinner" style="margin: 0 auto 15px auto;"></div>Cargando perfiles...</div>';

  try {
    const res = await fetch('/api/profiles');
    const data = await res.json();
    const profiles = Array.isArray(data) ? data : (data.profiles || []);

    grid.innerHTML = profiles.map(p => `
      <div class="profile-card" onclick="window.KuraStream.selectProfile('${escapeHtmlAttribute(p.id)}')">
        <div class="profile-avatar" style="background: ${escapeHtmlAttribute(p.color || 'var(--accent-color)')};">
          ${escapeHtml((p.name || 'P')[0].toUpperCase())}
        </div>
        <div class="profile-name">${escapeHtml(p.name)}</div>
      </div>
    `).join('');
  } catch (e) {
    grid.innerHTML = '<div style="color: var(--danger-color); padding: 30px;">Error al cargar perfiles.</div>';
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
  window.loadNotifications = loadNotifications;
  window.joinWatchPartyByCode = joinWatchPartyByCode;
  window.setupWatchPartyModal = setupWatchPartyModal;
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
  setupWatchPartyModal();
  initHeaderDropdowns();
  setupRouter();
  loadNotifications();
  renderAuthState();
  setupAuthModalListeners();

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

  // Random Anime Button
  const btnRandom = document.getElementById('btn-random-anime');
  if (btnRandom) {
    btnRandom.onclick = (e) => {
      e.preventDefault();
      openRandomAnimeModal();
    };
  }

  // Search Bar
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      const cards = document.querySelectorAll('.show-card');
      cards.forEach(card => {
        const title = (card.querySelector('.card-title')?.textContent || '').toLowerCase();
        card.style.display = !query || title.includes(query) ? '' : 'none';
      });
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
