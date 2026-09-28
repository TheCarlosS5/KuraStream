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
        if (userAvatarInitial) {
          if (activeProfile.avatar) {
            userAvatarInitial.textContent = '';
            userAvatarInitial.style.backgroundImage = `url('${activeProfile.avatar}')`;
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

  // Group by anime: keep at most one card per anime (the latest episode reached)
  const seenShows = new Set();
  const groupedInProgress = [];
  for (const item of inProgress) {
    const key = String(item.show_id || item.show_title || item.episode_id);
    if (!seenShows.has(key)) {
      seenShows.add(key);
      groupedInProgress.push(item);
    }
  }

  if (groupedInProgress.length === 0) return '';

  const cardsHTML = groupedInProgress.map(item => {
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
    if (detailAge) detailAge.textContent = show.age_rating || 'TV-14';
    if (detailStatusBadge) {
      const isAiring = show.status === 'airing';
      detailStatusBadge.textContent = isAiring ? 'En Emisión' : 'Finalizado';
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
    if (token) {
      try {
        const histRes = await fetch(`/api/history?username=${encodeURIComponent(activeUser)}&profile_name=${encodeURIComponent(profileName)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (histRes.ok) {
          const histItems = await histRes.json();
          if (Array.isArray(histItems)) {
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
        const sNum = ep.season_number || 1;
        if (!seasons[sNum]) seasons[sNum] = [];
        seasons[sNum].push(ep);
      });

      const seasonNums = Object.keys(seasons).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
      seasonTabs.innerHTML = seasonNums.map((num, idx) => `
        <button class="season-tab ${idx === 0 ? 'active' : ''}" data-season="${escapeHtmlAttribute(num)}">Temporada ${escapeHtml(num)}</button>
      `).join('');

      const firstSeason = seasonNums[0] || 1;
      renderEpisodeList(seasons[firstSeason] || episodes, episodesList, show.poster_path, showProgressMap);

      seasonTabs.querySelectorAll('.season-tab').forEach(tab => {
        tab.onclick = () => {
          seasonTabs.querySelectorAll('.season-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const sNum = tab.getAttribute('data-season');
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

      const formatTrackLang = (code) => {
        const c = String(code || 'und').toLowerCase();
        const map = {
          'jpn': 'Japonés',
          'ja': 'Japonés',
          'spa': 'Español',
          'es': 'Español',
          'es-la': 'Español (Latino)',
          'eng': 'Inglés',
          'en': 'Inglés',
          'por': 'Portugués',
          'pt': 'Portugués'
        };
        return map[c] || c.toUpperCase();
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
            const lang = (t.language || t.lang || 'und').toLowerCase();
            if (!audioTracksMap.has(lang)) {
              audioTracksMap.set(lang, t.title || formatTrackLang(lang));
            }
          });
        }
        if (Array.isArray(subs)) {
          subs.forEach(t => {
            const lang = (t.language || t.lang || 'und').toLowerCase();
            if (!subTracksMap.has(lang)) {
              subTracksMap.set(lang, t.title || formatTrackLang(lang));
            }
          });
        }
      });

      if (audioTracksMap.size > 0 || subTracksMap.size > 0) {
        trackPrefContainer.style.display = 'flex';

        let currentAudioPref = localStorage.getItem('kura_pref_audio_lang') || 'jpn';
        let currentSubPref = localStorage.getItem('kura_pref_sub_lang') || 'spa';

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

    if (token) {
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
          commentUserAvatar.style.backgroundImage = `url('${escapeHtmlAttribute(activeProfile.avatar)}')`;
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
        const cRes = await fetch(`/api/comments?show_id=${encodeURIComponent(id)}`);
        if (cRes.ok) {
          const cData = await cRes.json();
          const comments = Array.isArray(cData.comments) ? cData.comments : [];
          if (comments.length === 0) {
            commentsListContainer.innerHTML = '<div class="empty-state text-muted" style="padding: 24px 0; text-align: center;">No hay comentarios todavía. ¡Sé el primero en comentar!</div>';
            return;
          }
          commentsListContainer.innerHTML = comments.map(c => {
            const author = c.profile_name ? `${c.username} (${c.profile_name})` : (c.username || 'Usuario');
            const initial = (c.profile_name || c.username || 'U')[0].toUpperCase();
            const dateStr = c.created_at ? new Date(c.created_at).toLocaleDateString() : '';
            const avatarBg = c.avatar 
              ? `background-image: url('${escapeHtmlAttribute(c.avatar)}'); background-size: cover; background-position: center;`
              : `background: ${escapeHtmlAttribute(c.avatar_color || 'var(--accent-color)')};`;
            const avatarContent = c.avatar ? '' : escapeHtml(initial);
            return `
              <div class="comment-item" style="display: flex; gap: 12px; margin-bottom: 16px; padding: 12px; background: var(--surface-control); border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
                <div class="user-avatar-initial" style="width: 36px; height: 36px; font-size: 0.9rem; flex-shrink: 0; ${avatarBg}">${avatarContent}</div>
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
        }
      } catch {
        commentsListContainer.innerHTML = '<div class="text-danger" style="padding: 12px 0;">Error al cargar comentarios.</div>';
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

  if (!token) {
    container.innerHTML = `
      <div class="empty-state-card col-span-all">
        <img src="/assets/illustrations/empty_watchlist.svg" alt="" class="empty-state-img">
        <h3>Inicia sesión para ver tu lista</h3>
        <p>Guarda tus series y películas favoritas para encontrarlas fácilmente en cualquier momento.</p>
        <button class="btn btn-primary" id="btn-mylist-login"><i data-lucide="user"></i> Iniciar Sesión</button>
      </div>
    `;
    const btnLogin = document.getElementById('btn-mylist-login');
    if (btnLogin && typeof openAuthModal === 'function') {
      btnLogin.onclick = () => openAuthModal('login');
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
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
        const inLib = Boolean(item.in_library);
        const inLibBadge = inLib ? `
          <div class="calendar-airing-pill">
            <i data-lucide="check"></i> EN TU BIBLIOTECA
          </div>
        ` : '';

        const localId = item.local_show_id || item.library_show_id;
        const hasLocal = inLib && Boolean(localId);
        const cardTag = hasLocal ? 'a' : 'div';
        const cardAttrs = hasLocal 
          ? `href="${escapeHtmlAttribute('#/show/' + encodeURIComponent(localId))}" class="calendar-show-card calendar-show-card-linked"`
          : `class="calendar-show-card" data-premiere-title="${escapeHtmlAttribute(item.title || '')}" style="cursor: pointer;"`;

        return `
          <${cardTag} ${cardAttrs}>
            <div class="calendar-card-img-wrap">
              <img src="${escapeHtmlAttribute(catalogueImageUrl(cover))}" alt="${escapeHtmlAttribute(item.title || '')}">
              ${inLibBadge}
            </div>
            <div class="calendar-card-body">
              <h3 class="calendar-card-title">${escapeHtml(item.title || '')}</h3>
              <p class="calendar-card-meta">${escapeHtml(item.studio || '')} • ${escapeHtml(item.episode || '')}</p>
            </div>
          </${cardTag}>
        `;
      }).join('')}
    </div>
  `;

  gridContainer.querySelectorAll('.calendar-show-card[data-premiere-title]').forEach(card => {
    card.onclick = () => {
      const pTitle = card.getAttribute('data-premiere-title') || 'Este anime';
      showToast(`"${pTitle}" es un estreno en emisión (próximamente en biblioteca)`, 'info', 2500);
    };
  });

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
      const activeEpId = (typeof currentEpisodeId !== 'undefined' && currentEpisodeId) || null;

      // If we already have current show episodes loaded in detail view
      if (currentShowEpisodes && currentShowEpisodes.length > 0) {
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

      createSubmitBtn.disabled = true;
      try {
        const room = await partyManager.createRoom({
          episodeId: epId,
          name: partyName,
          isPublic,
          allowGuestControls
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
        if (typeof joinWatchPartyByCode === 'function') await joinWatchPartyByCode(roomId);
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
  const btnRefresh = document.getElementById('btn-refresh-calendar');
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const todayDay = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  const fetchCalendar = async (force = false) => {
    try {
      const url = force ? '/api/calendar?force=1' : '/api/calendar';
      const res = await fetch(url);
      if (res.ok) {
        calendarDataCache = await res.json();
      }
    } catch (e) {
      console.warn('Error loading calendar:', e);
    }
  };

  await fetchCalendar();

  if (btnRefresh) {
    btnRefresh.onclick = async () => {
      btnRefresh.disabled = true;
      try {
        await fetchCalendar(true);
        const activeTab = dayTabs ? dayTabs.querySelector('.day-tab.active') : null;
        const currentDay = activeTab ? activeTab.getAttribute('data-day') : 'Monday';
        renderCalendarDay(currentDay);
        showToast('Calendario de estrenos actualizado', 'success');
      } catch {
        showToast('Error al actualizar el calendario', 'error');
      } finally {
        btnRefresh.disabled = false;
      }
    };
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
  if (dayTabs) {
    dayTabs.querySelectorAll('.day-tab').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-day') === initialDay);
    });
  }
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

let isProfileManageMode = false;
let currentEditingAvatar = '';
let currentEditingColor = '#818CF8';

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

  const updateAvatarPreview = () => {
    if (!avatarDisplay) return;
    if (currentEditingAvatar) {
      avatarDisplay.textContent = '';
      avatarDisplay.style.backgroundImage = `url('${currentEditingAvatar}')`;
      avatarDisplay.style.backgroundSize = 'cover';
      avatarDisplay.style.backgroundPosition = 'center';
      avatarDisplay.style.backgroundRepeat = 'no-repeat';
    } else {
      avatarDisplay.style.backgroundImage = 'none';
      avatarDisplay.style.backgroundColor = currentEditingColor;
      const initial = nameInput && nameInput.value ? nameInput.value[0].toUpperCase() : '?';
      avatarDisplay.textContent = initial;
    }
  };

  updateAvatarPreview();

  if (nameInput) {
    nameInput.oninput = () => {
      if (!currentEditingAvatar) updateAvatarPreview();
    };
  }

  // Preset avatar clicks
  const presetOptions = modal.querySelectorAll('.preset-avatar-option');
  presetOptions.forEach(opt => {
    opt.classList.remove('selected');
    const presetPath = opt.getAttribute('data-preset');
    if (presetPath === currentEditingAvatar) opt.classList.add('selected');

    opt.onclick = () => {
      presetOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      currentEditingAvatar = presetPath;
      updateAvatarPreview();
    };
  });

  // Upload button
  if (uploadBtn && fileInput) {
    uploadBtn.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (re) => {
          currentEditingAvatar = re.target.result;
          presetOptions.forEach(o => o.classList.remove('selected'));
          updateAvatarPreview();
        };
        reader.readAsDataURL(file);
      }
    };
  }

  // Color swatches
  const colorMap = {
    'Purple': '#818CF8',
    'Green': '#4DD4A7',
    'Blue': '#5AA7FF',
    'Red': '#FF6B81',
    'Orange': '#5ED8C6'
  };
  const swatches = modal.querySelectorAll('.color-swatches-row .color-swatch');
  swatches.forEach(sw => {
    const colName = sw.getAttribute('data-color');
    const hex = colorMap[colName] || '#818CF8';
    sw.classList.toggle('active', currentEditingColor === hex || currentEditingColor === colName);

    sw.onclick = () => {
      swatches.forEach(s => s.classList.remove('active'));
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
        deleteBtn.disabled = true;
        try {
          const token = AuthManager.getToken();
          const res = await fetch('/api/profiles/delete', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ id: profile.id })
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
      const avatarStyle = p.avatar 
        ? `background-image: url('${escapeHtmlAttribute(p.avatar)}'); background-size: cover; background-position: center;`
        : `background: ${escapeHtmlAttribute(p.color || '#818CF8')};`;
      const initial = p.avatar ? '' : escapeHtml((p.name || 'P')[0].toUpperCase());
      const editBadgeHtml = isProfileManageMode ? `
        <div class="profile-edit-badge">
          <i data-lucide="pencil" style="width: 14px; height: 14px;"></i>
        </div>
      ` : '';

      return `
        <div class="profile-card ${isProfileManageMode ? 'profile-card-manage' : ''}" data-profile-id="${escapeHtmlAttribute(p.id)}" style="position: relative; cursor: pointer;">
          <div class="profile-avatar ${p.avatar ? 'has-image' : ''}" style="${avatarStyle}">
            ${initial}
            ${p.is_kids ? '<span class="profile-badge-kids">KIDS</span>' : ''}
            ${editBadgeHtml}
          </div>
          <div class="profile-name">${escapeHtml(p.name)}</div>
        </div>
      `;
    }).join('');

    const addCardHtml = isProfileManageMode ? `
      <div class="profile-card profile-card-add" id="card-add-profile" style="cursor: pointer;">
        <div class="profile-avatar">
          <i data-lucide="plus" style="width: 32px; height: 32px;"></i>
        </div>
        <div class="profile-name">Agregar perfil</div>
      </div>
    ` : '';

    grid.innerHTML = cardsHtml + addCardHtml;

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
