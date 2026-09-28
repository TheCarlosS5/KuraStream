/**
 * KuraStream v2.0 - Canonical Application Entry Point
 * Orchestrates modular architecture, client routing, catalog rendering, and player lifecycle.
 */

import { AuthManager } from './core/auth.js';
import { appState } from './core/state.js';
import { playerController } from './features/player/player_controller.js';
import { initPlayer, destroyPlayer } from '../player.js?v=2026.09.26-modern-streaming-rc2';
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
          <span class="badge-rating"><i data-lucide="star"></i>${rating}</span>
          <span class="badge-year">${escapeHtml(year)}</span>
          <div class="billboard-genres">${genres}</div>
        </div>
        <h1 class="billboard-hero-title">${escapeHtml(featuredShow.title)}</h1>
        <p class="billboard-hero-synopsis">${escapeHtml(synopsis)}</p>
        <div class="billboard-hero-actions">
          <button class="btn-billboard-play" data-catalogue-route="${escapeHtmlAttribute('#/show/' + encodeURIComponent(featuredShow.id))}">
            <i data-lucide="play"></i> Reproducir
          </button>
          <button class="btn-billboard-info" data-catalogue-route="${escapeHtmlAttribute('#/show/' + encodeURIComponent(featuredShow.id))}">
            <i data-lucide="info"></i> Más información
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
      <div class="continue-watching-card" role="link" tabindex="0" data-catalogue-route="${escapeHtmlAttribute('#/player/' + encodeURIComponent(item.episode_id))}" title="${escapeHtmlAttribute(`${item.show_title || ''} - ${item.episode_title || epLabel}`)}">
        <div class="continue-watching-thumb-wrapper">
          <img class="continue-watching-thumb" src="${escapeHtmlAttribute(imgUrl)}" alt="${escapeHtmlAttribute(item.show_title || '')}" loading="lazy">
          <div class="continue-watching-play-btn" aria-label="Reproducir">
            <i data-lucide="play"></i>
          </div>
          <div class="continue-watching-progress-bar">
            <div class="continue-watching-progress-fill" style="width: ${progressPercent}%;"></div>
          </div>
        </div>
        <div class="continue-watching-info">
          <h4 class="continue-watching-title">${escapeHtml(item.show_title || '')}</h4>
          <span class="continue-watching-subtext">${escapeHtml(subtext)}</span>
          <div class="continue-watching-action">Continuar <i data-lucide="chevron-right"></i></div>
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
  if (historyItem && historyItem.duration) {
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
    <div class="show-card" role="link" tabindex="0" data-catalogue-route="${escapeHtmlAttribute('#/show/' + encodeURIComponent(show.id))}">
      <div class="card-img-wrapper">
        <img src="${escapeHtmlAttribute(posterSrc)}" alt="${escapeHtmlAttribute(show.title)}" loading="lazy" onload="this.style.opacity=1">
        <div class="card-rating-badge">
          <i data-lucide="star"></i>${rating}
        </div>
        ${airingBadgeHTML}
        ${progressHTML}
      </div>
      <div class="card-info">
        <h3 class="card-title">${escapeHtml(show.title)}</h3>
        <div class="card-meta">
          <span>${show.media_type === 'movie' ? 'PELÍCULA' : 'ANIME'}</span>
          <span>•</span>
          <span>${escapeHtml(show.year || '')}</span>
        </div>
      </div>
    </div>
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
      <div class="episode-item" role="button" tabindex="0" data-episode-id="${escapeHtmlAttribute(ep.id)}">
        <div class="episode-thumbnail-container">
          <img class="episode-thumb" src="${escapeHtmlAttribute(thumbSrc)}" alt="${escapeHtmlAttribute(ep.title || 'Episodio')}" loading="lazy">
          ${durationMin > 0 ? `<div class="episode-duration-pill">${durationMin}m</div>` : ''}
          ${completedBadgeHTML}
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
      } else {
        if (ambientVideo) {
          ambientVideo.pause();
          ambientVideo.src = '';
          ambientVideo.remove();
        }
        const backdropUrl = catalogueImageUrl(show.backdrop_path || show.poster_path || '') || '/assets/illustrations/backdrop_placeholder.svg';
        ambientBg.style.backgroundImage = `url("${backdropUrl}")`;
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
        <span class="detail-badge-pill"><i data-lucide="star" class="icon-star-badge"></i> ${show.rating ? Number(show.rating).toFixed(1) : 'N/A'}</span>
        <span class="detail-badge-pill">${escapeHtml(show.year || 'N/A')}</span>
        <span class="badge badge-subtle">${show.status === 'airing' ? 'En Emisión' : 'Finalizado'}</span>
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

  container.innerHTML = `<div class="state-box-loading">Cargando tu lista...</div>`;
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

  container.innerHTML = favorites.map(s => createShowCardHTML(s)).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

export async function renderHistoryView() {
  const container = document.getElementById('history-list');
  if (!container) return;

  container.innerHTML = `<div class="state-box-loading"><div class="spinner spinner-centered"></div>Cargando historial...</div>`;
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

export function renderCalendarDay(dayName) {
  const gridContainer = document.getElementById('calendar-grid-content');
  if (!gridContainer || !calendarDataCache) return;

  const showsList = calendarDataCache[dayName] || [];

  if (showsList.length === 0) {
    gridContainer.innerHTML = `
      <div class="empty-state">
        <i data-lucide="calendar-off"></i>
        <h2>No hay estrenos programados para este día</h2>
      </div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  gridContainer.innerHTML = `
    <div class="calendar-grid">
      ${showsList.map(item => {
        const cover = item.cover_image || '';
        const inLibBadge = item.in_library ? `
          <div class="calendar-airing-pill">
            <i data-lucide="check"></i> EN TU BIBLIOTECA
          </div>
        ` : '';

        return `
          <div class="calendar-show-card">
            <div class="calendar-card-img-wrap">
              <img src="${escapeHtmlAttribute(catalogueImageUrl(cover))}" alt="${escapeHtmlAttribute(item.title || '')}">
              ${inLibBadge}
            </div>
            <div class="calendar-card-body">
              <h3 class="calendar-card-title">${escapeHtml(item.title || '')}</h3>
              <p class="calendar-card-meta">${escapeHtml(item.studio || '')} • ${escapeHtml(item.episode || '')}</p>
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
  cardBody.innerHTML = `<div class="state-box"><div class="spinner"></div>Buscando anime aleatorio...</div>`;

  try {
    const res = await fetch('/api/shows/random');
    const data = await res.json();
    const show = data.show || data;

    cardBody.innerHTML = `
      <div class="state-box">
        <img src="${escapeHtmlAttribute(catalogueImageUrl(show.poster_path || ''))}" alt="${escapeHtmlAttribute(show.title)}" class="random-poster-img">
        <h3 class="modal-title">${escapeHtml(show.title)}</h3>
        <p class="modal-subtitle">${escapeHtml(show.synopsis || '')}</p>
        <a class="btn btn-primary" id="random-card-watch-btn" href="${escapeHtmlAttribute('#/show/' + encodeURIComponent(show.id))}">Ver Anime</a>
      </div>
    `;
    const watchBtn = document.getElementById('random-card-watch-btn');
    if (watchBtn) {
      watchBtn.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }
  } catch (err) {
    cardBody.innerHTML = `<div class="state-box state-box-error">Error al buscar anime aleatorio.</div>`;
  }
}

export async function renderStatsView() {
  const cardsGrid = document.getElementById('stats-cards-grid');
  const chartContainer = document.getElementById('stats-genre-chart');
  if (!cardsGrid || !chartContainer) return;

  cardsGrid.innerHTML = '<div class="state-box col-span-all"><div class="spinner"></div>Cargando estadísticas...</div>';
  chartContainer.innerHTML = '<div class="state-box">Cargando gráfico...</div>';

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
      <div class="stat-card-value text-info">${hours} horas</div>
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

  chartContainer.innerHTML = `<p class="stat-genre-pill">Género favorito: <strong>${escapeHtml(stats.top_genre || 'Anime')}</strong></p>`;
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
        <section class="catalog-section">
          <h2 class="section-title">
            ${filterType === 'movie' ? 'Películas Disponibles' : 'Catálogo Completo'}
          </h2>
          <div class="shows-grid">
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
  const audioLangSelect = document.getElementById('pref-audio-lang');
  const subLangSelect = document.getElementById('pref-sub-lang');
  const boostSelect = document.getElementById('pref-audio-boost');
  const presetSelect = document.getElementById('pref-audio-preset');
  const skipIntroToggle = document.getElementById('autoSkipIntroToggle');
  const autoPlayNextToggle = document.getElementById('autoPlayNextToggle');
  const notifToggle = document.getElementById('notificationsToggle');
  const saveSuccessToast = document.getElementById('settings-save-success');

  try {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`/api/user/preferences?username=${encodeURIComponent(activeUser)}&profile_name=${encodeURIComponent(profileName)}`, { headers });
    if (res.ok) {
      const data = await res.json();
      const prefs = data.preferences || data;
      if (audioLangSelect) audioLangSelect.value = prefs.preferred_audio_language || 'default';
      if (subLangSelect) subLangSelect.value = prefs.preferred_subtitle_language || 'default';
      if (boostSelect) boostSelect.value = String(prefs.audio_boost || 100);
      if (presetSelect) presetSelect.value = prefs.audio_preset || 'flat';
      if (skipIntroToggle) skipIntroToggle.checked = Boolean(prefs.auto_skip_intro);
      if (autoPlayNextToggle) autoPlayNextToggle.checked = prefs.auto_play_next !== false && prefs.auto_play_next !== 0 && prefs.auto_play_next !== 'false';
      if (notifToggle) notifToggle.checked = Boolean(prefs.notifications_enabled);

      if (!window.userPreferences) window.userPreferences = {};
      Object.assign(window.userPreferences, prefs);
    }
  } catch (e) {
    console.warn('Error loading settings:', e);
  }

  const savePreferences = async () => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const payload = {
      username: activeUser,
      profile_name: profileName,
      preferred_audio_language: audioLangSelect ? audioLangSelect.value : 'default',
      preferred_subtitle_language: subLangSelect ? subLangSelect.value : 'default',
      audio_boost: boostSelect ? parseInt(boostSelect.value, 10) : 100,
      audio_preset: presetSelect ? presetSelect.value : 'flat',
      auto_skip_intro: skipIntroToggle && skipIntroToggle.checked ? 1 : 0,
      auto_play_next: autoPlayNextToggle && autoPlayNextToggle.checked ? 1 : 0,
      notifications_enabled: notifToggle && notifToggle.checked ? 1 : 0
    };

    try {
      const res = await fetch('/api/user/preferences', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        if (!window.userPreferences) window.userPreferences = {};
        Object.assign(window.userPreferences, payload);
        localStorage.setItem('kurastream_auto_skip_intro', String(skipIntroToggle ? skipIntroToggle.checked : false));
        localStorage.setItem('kurastream_auto_play_next', String(autoPlayNextToggle ? autoPlayNextToggle.checked : true));
        localStorage.setItem('kurastream_preferred_audio_language', audioLangSelect ? audioLangSelect.value : 'default');
        localStorage.setItem('kura_pref_audio_lang', audioLangSelect ? audioLangSelect.value : 'default');
        localStorage.setItem('kurastream_preferred_subtitle_language', subLangSelect ? subLangSelect.value : 'default');
        localStorage.setItem('kura_pref_sub_lang', subLangSelect ? subLangSelect.value : 'default');
        localStorage.setItem('kura_audio_boost', String(boostSelect ? boostSelect.value : 100));
        localStorage.setItem('kura_audio_preset', presetSelect ? presetSelect.value : 'flat');

        if (saveSuccessToast) {
          saveSuccessToast.style.display = 'block';
          setTimeout(() => { saveSuccessToast.style.display = 'none'; }, 2500);
        }
      }
    } catch (err) {
      console.warn('Error saving preferences:', err);
    }
  };

  if (audioLangSelect) audioLangSelect.onchange = savePreferences;
  if (subLangSelect) subLangSelect.onchange = savePreferences;
  if (boostSelect) boostSelect.onchange = savePreferences;
  if (presetSelect) presetSelect.onchange = savePreferences;
  if (skipIntroToggle) skipIntroToggle.onchange = savePreferences;
  if (autoPlayNextToggle) autoPlayNextToggle.onchange = savePreferences;
  if (notifToggle) notifToggle.onchange = savePreferences;
}

async function loadProfilesView() {
  const grid = document.getElementById('profile-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="state-box"><div class="spinner"></div>Cargando perfiles...</div>';

  try {
    const res = await fetch('/api/profiles');
    const data = await res.json();
    const profiles = Array.isArray(data) ? data : (data.profiles || []);

    grid.innerHTML = profiles.map(p => `
      <div class="profile-card" onclick="window.KuraStream.selectProfile('${escapeHtmlAttribute(p.id)}')">
        <div class="profile-avatar" style="background: ${escapeHtmlAttribute(p.color || 'var(--accent-color)')};">
          ${escapeHtml((p.name || 'P')[0].toUpperCase())}
          ${p.is_kids ? '<span class="profile-badge-kids">KIDS</span>' : ''}
        </div>
        <div class="profile-name">${escapeHtml(p.name)}</div>
      </div>
    `).join('');
  } catch (e) {
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

  // Load user preferences globally into window.userPreferences
  try {
    const { activeUser, profileName, token } = getUserAndProfile();
    const prefHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};
    fetch(`/api/user/preferences?username=${encodeURIComponent(activeUser)}&profile_name=${encodeURIComponent(profileName)}`, { headers: prefHeaders })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.preferences) {
          window.userPreferences = Object.assign(window.userPreferences || {}, data.preferences);
        }
      })
      .catch(() => {});
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
