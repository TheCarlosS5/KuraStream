/**
 * KuraStream 2.0 - Season & Episode Batch Watch Tracker Module
 *
 * Netflix-style viewing progress tracker allowing users to mark entire seasons
 * as watched/unwatched with one click, track percentage progress per season,
 * and toggle individual episode watch states with high-contrast badges and strict 4px radius.
 */

const STYLE_ID = 'catalog-episode-tracker-styles';

/**
 * Escapes text for safe HTML rendering.
 * @param {string|number} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Injects module CSS rules into document head if not already present.
 */
function ensureTrackerStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .kura-season-tracker-wrapper {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 16px 0 24px 0;
      width: 100%;
      box-sizing: border-box;
      font-family: inherit;
    }

    .kura-season-header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      width: 100%;
    }

    .kura-season-progress-label {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 0.88rem;
      color: var(--text-muted, #94a3b8);
      font-weight: 500;
    }

    .kura-season-progress-text {
      color: var(--text-main, #f8fafc);
      font-weight: 700;
      letter-spacing: 0.2px;
    }

    .kura-season-complete-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--success-color, #2DD4BF) !important;
      color: #0b0f14 !important;
      font-weight: 800;
      font-size: 0.7rem;
      padding: 2px 7px;
      border-radius: 4px !important;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      box-shadow: 0 0 10px rgba(45, 212, 191, 0.4);
    }

    .kura-season-progress-track {
      width: 100%;
      height: 7px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 4px !important;
      overflow: hidden;
      position: relative;
      border: 1px solid rgba(255, 255, 255, 0.05);
      box-sizing: border-box;
    }

    .kura-season-progress-fill {
      height: 100%;
      background: var(--success-color, #2DD4BF) !important;
      border-radius: 4px !important;
      transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 0 8px rgba(45, 212, 191, 0.5);
    }

    .season-batch-actions {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      border-radius: 4px !important;
    }

    .season-batch-actions .btn {
      border-radius: 4px !important;
      padding: 6px 12px;
      font-size: 0.8rem;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      transition: all 0.18s ease;
      line-height: 1.2;
    }

    .btn-mark-season-watched:hover {
      background: rgba(45, 212, 191, 0.15) !important;
      border-color: var(--success-color, #2DD4BF) !important;
      color: var(--success-color, #2DD4BF) !important;
    }

    .btn-mark-season-unwatched:hover {
      background: rgba(255, 255, 255, 0.1) !important;
      border-color: rgba(255, 255, 255, 0.3) !important;
      color: #f8fafc !important;
    }

    .badge-visto-tracker {
      position: absolute;
      top: 8px;
      right: 8px;
      background: var(--success-color, #2DD4BF) !important;
      color: #0b0f14 !important;
      font-weight: 800;
      font-size: 0.68rem;
      padding: 2px 7px;
      border-radius: 4px !important;
      letter-spacing: 0.5px;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      z-index: 4;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.6), 0 0 8px rgba(45, 212, 191, 0.4);
      user-select: none;
    }

    .episode-watch-toggle-btn {
      position: absolute;
      top: 8px;
      left: 8px;
      z-index: 5;
      width: 26px;
      height: 26px;
      border-radius: 4px !important;
      border: 1px solid rgba(255, 255, 255, 0.28);
      background: rgba(15, 23, 42, 0.8);
      backdrop-filter: blur(4px);
      color: #cbd5e1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.18s ease;
      padding: 0;
    }

    .episode-watch-toggle-btn:hover {
      transform: scale(1.08);
      border-color: #ffffff;
      background: rgba(15, 23, 42, 0.95);
      color: #ffffff;
    }

    .episode-watch-toggle-btn.is-watched {
      background: var(--success-color, #2DD4BF) !important;
      border-color: var(--success-color, #2DD4BF) !important;
      color: #0b0f14 !important;
      box-shadow: 0 0 10px rgba(45, 212, 191, 0.4);
    }
  `;
  document.head.appendChild(style);
}

/**
 * Calculates season progress stats.
 *
 * @param {Array<Object>} episodes - Array of episode records
 * @param {string|number} seasonNumber - Target season number
 * @param {Map<string, Object>|Object} [progressLookup] - Optional progress lookup map
 * @returns {{ total: number, watched: number, percentage: number }}
 */
export function getSeasonProgress(episodes, seasonNumber, progressLookup = null) {
  const epList = Array.isArray(episodes) ? episodes : [];
  let seasonEps = epList;

  if (seasonNumber !== undefined && seasonNumber !== null && seasonNumber !== '') {
    const sStr = String(seasonNumber);
    const filtered = epList.filter(ep => {
      if (!ep) return false;
      const sNum = String(ep.season_number ?? ep.season ?? 1);
      return sNum === sStr;
    });

    if (filtered.length > 0 || epList.some(ep => ep && (ep.season_number !== undefined || ep.season !== undefined))) {
      seasonEps = filtered;
    }
  }

  const total = seasonEps.length;
  let watched = 0;

  seasonEps.forEach(ep => {
    if (!ep) return;
    const epId = String(ep.id ?? '');

    let isDone = Boolean(ep.completed);

    if (progressLookup) {
      const item = progressLookup instanceof Map
        ? progressLookup.get(epId)
        : progressLookup[epId];

      if (item) {
        if (typeof item.completed === 'boolean') {
          isDone = item.completed;
        } else if (item.completed === 1 || item.completed === '1') {
          isDone = true;
        } else {
          const pos = Number(item.progress_seconds ?? item.progress ?? 0);
          const dur = Number(item.duration ?? ep.duration ?? 0);
          if (dur > 0 && (pos / dur) >= 0.85) {
            isDone = true;
          }
        }
      }
    }

    if (isDone) {
      watched += 1;
    }
  });

  const percentage = total > 0 ? Math.round((watched / total) * 100) : 0;
  return { total, watched, percentage };
}

/**
 * Initializes the Season & Episode Batch Watch Tracker.
 *
 * @param {Object} [options={}] - Configuration options
 * @returns {Object} Tracker instance
 */
export function initEpisodeTracker(options = {}) {
  ensureTrackerStyles();

  // Active user, profile, and auth resolution
  let activeToken = options.token || '';
  let activeUsername = options.username || (options.user && options.user.username) || (typeof options.user === 'string' ? options.user : '');
  let activeProfile = options.profileName || options.profile || '';
  const apiBaseUrl = options.apiBaseUrl || '';
  const onUpdateCallback = typeof options.onUpdate === 'function' ? options.onUpdate : null;

  if (typeof window !== 'undefined' && window.localStorage) {
    if (!activeToken || !activeUsername) {
      try {
        const sessionStr = localStorage.getItem('kura_user_session');
        if (sessionStr) {
          const session = JSON.parse(sessionStr);
          if (!activeUsername && session.username) activeUsername = session.username;
          if (!activeToken && session.token) activeToken = session.token;
        }
      } catch {
        // Ignore session parse failure
      }
    }
    if (!activeToken) {
      activeToken = localStorage.getItem('kurastream_token') ||
                    localStorage.getItem('token') ||
                    localStorage.getItem('kura_admin_token') ||
                    localStorage.getItem('adminToken') || '';
    }
    if (!activeUsername) {
      try {
        const userStr = localStorage.getItem('kurastream_user');
        if (userStr) {
          const u = JSON.parse(userStr);
          if (u && u.username) activeUsername = u.username;
        }
      } catch {
        // Ignore user parse failure
      }
    }
    if (!activeProfile) {
      activeProfile = localStorage.getItem('kura_active_profile') || 'Principal';
    }
  }

  if (!activeUsername) activeUsername = 'guest';
  if (!activeProfile) activeProfile = 'Principal';

  // In-memory state tracking episode watch status
  const localProgressMap = new Map();
  const seedMap = options.progressMap || options.showProgressMap;

  if (seedMap && typeof seedMap === 'object') {
    Object.keys(seedMap).forEach(id => {
      const item = seedMap[id];
      if (item) {
        localProgressMap.set(String(id), {
          completed: Boolean(item.completed),
          progress_seconds: Number(item.progress_seconds ?? item.progress ?? 0),
          duration: Number(item.duration ?? 0)
        });
      }
    });
  }

  // Load guest progress from localStorage if available
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const guestProg = JSON.parse(localStorage.getItem('kura_guest_progress') || '{}');
      Object.keys(guestProg).forEach(id => {
        if (!localProgressMap.has(String(id))) {
          const item = guestProg[id];
          if (item) {
            localProgressMap.set(String(id), {
              completed: Boolean(item.completed),
              progress_seconds: Number(item.progress ?? 0),
              duration: Number(item.duration ?? 0)
            });
          }
        }
      });
    } catch {
      // Ignore localStorage failure
    }
  }

  // Seed with initial episodes array if completed flag is present
  if (Array.isArray(options.episodes)) {
    options.episodes.forEach(ep => {
      if (ep && ep.id && !localProgressMap.has(String(ep.id))) {
        localProgressMap.set(String(ep.id), {
          completed: Boolean(ep.completed),
          progress_seconds: ep.completed ? Number(ep.duration || 1440) : 0,
          duration: Number(ep.duration || 0)
        });
      }
    });
  }

  // Track rendered progress elements for dynamic refreshes
  const renderedBars = new Set();
  const cleanupListeners = [];

  /**
   * Helper to check if an episode is watched.
   * @param {string|number|Object} episodeOrId
   * @returns {boolean}
   */
  function isEpisodeWatched(episodeOrId) {
    let id = '';
    let epObj = null;

    if (typeof episodeOrId === 'object' && episodeOrId !== null) {
      id = String(episodeOrId.id ?? '');
      epObj = episodeOrId;
    } else {
      id = String(episodeOrId ?? '');
    }

    if (localProgressMap.has(id)) {
      const state = localProgressMap.get(id);
      if (typeof state.completed === 'boolean') {
        return state.completed;
      }
      if (state.duration > 0 && (state.progress_seconds / state.duration) >= 0.85) {
        return true;
      }
    }

    if (seedMap && seedMap[id]) {
      const item = seedMap[id];
      if (Boolean(item.completed)) return true;
      const dur = Number(item.duration || 0);
      const prog = Number(item.progress_seconds ?? item.progress ?? 0);
      if (dur > 0 && (prog / dur) >= 0.85) return true;
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const guestProg = JSON.parse(localStorage.getItem('kura_guest_progress') || '{}');
        if (guestProg[id] && Boolean(guestProg[id].completed)) {
          return true;
        }
      } catch {
        // Ignore failure
      }
    }

    if (epObj && (epObj.completed === true || epObj.completed === 1 || epObj.completed === '1')) {
      return true;
    }

    return false;
  }

  /**
   * Sends watch state to /api/history.
   *
   * @param {string|number} episodeId
   * @param {boolean} isWatched
   * @param {number} [duration=0]
   * @returns {Promise<boolean>}
   */
  async function syncEpisodeToHistory(episodeId, isWatched, duration = 0) {
    const epId = String(episodeId);
    const dur = Number(duration || 1440);
    const progSec = isWatched ? dur : 0;

    const headers = { 'Content-Type': 'application/json' };
    if (activeToken) {
      headers['Authorization'] = `Bearer ${activeToken}`;
    }

    const payload = {
      episode_id: epId,
      progress: progSec,
      progress_seconds: progSec,
      duration: dur,
      completed: Boolean(isWatched),
      username: activeUsername,
      profile_name: activeProfile
    };

    let endpoint = `${apiBaseUrl}/api/history`;
    if (!apiBaseUrl && typeof window === 'undefined') {
      endpoint = 'http://localhost/api/history';
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      return res.ok;
    } catch (err) {
      if (typeof window !== 'undefined') {
        console.warn('[EpisodeTracker] /api/history sync error:', err);
      }
      return false;
    }
  }

  /**
   * Updates visual badges and buttons for an episode card in the DOM.
   *
   * @param {string|number} episodeId
   * @param {boolean} isWatched
   */
  function updateEpisodeVisualBadge(episodeId, isWatched) {
    if (typeof document === 'undefined') return;
    const epIdStr = String(episodeId);

    // Update toggle checkmark buttons
    const toggleBtns = document.querySelectorAll(
      `.episode-watch-toggle-btn[data-episode-id="${epIdStr}"], [data-action="toggle-watched"][data-episode-id="${epIdStr}"]`
    );
    toggleBtns.forEach(btn => {
      btn.classList.toggle('is-watched', isWatched);
      btn.setAttribute('aria-pressed', isWatched ? 'true' : 'false');
      btn.setAttribute('title', isWatched ? 'Marcar como no visto' : 'Marcar como visto');
    });

    // Update episode cards
    const cards = document.querySelectorAll(
      `.episode-item[data-episode-id="${epIdStr}"], [data-episode-id="${epIdStr}"]`
    );

    cards.forEach(card => {
      const thumbWrapper = card.querySelector('.episode-thumb-wrapper') || card;
      let badge = thumbWrapper.querySelector('.badge-visto-tracker, .badge-visto');

      if (isWatched) {
        if (!badge) {
          badge = document.createElement('div');
          badge.className = 'badge-visto badge-visto-tracker';
          badge.setAttribute('data-tracker-injected', 'true');
          badge.style.borderRadius = '4px';
          badge.innerHTML = `
            <svg class="tracker-check-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <i data-lucide="check" style="width: 12px; height: 12px; stroke-width: 3;"></i>
            <span>VISTO</span>
          `;
          thumbWrapper.appendChild(badge);
          if (typeof window !== 'undefined' && window.lucide) {
            window.lucide.createIcons({ root: badge });
          }
        } else {
          badge.style.display = 'inline-flex';
          badge.style.borderRadius = '4px';
        }

        // Hide or clear in-progress bar when completed
        const progFill = card.querySelector('.episode-progress-fill');
        if (progFill) {
          progFill.style.width = '100%';
        }
      } else {
        if (badge) {
          if (badge.getAttribute('data-tracker-injected') === 'true') {
            badge.remove();
          } else {
            badge.style.display = 'none';
          }
        }
        const progFill = card.querySelector('.episode-progress-fill');
        if (progFill) {
          progFill.style.width = '0%';
        }
      }
    });
  }

  /**
   * Refreshes all active progress bar elements for a given season.
   *
   * @param {string|number} seasonNumber
   * @param {Array<Object>} episodes
   */
  function refreshSeasonProgressBars(seasonNumber, episodes) {
    const sStr = String(seasonNumber);
    renderedBars.forEach(entry => {
      if (entry.seasonNumber === sStr && entry.element && entry.element.isConnected) {
        const stats = getSeasonProgress(episodes || entry.episodes, seasonNumber, localProgressMap);
        const textEl = entry.element.querySelector('.kura-season-progress-text');
        const fillEl = entry.element.querySelector('.kura-season-progress-fill');
        const badgeEl = entry.element.querySelector('.kura-season-complete-badge');

        if (textEl) {
          textEl.textContent = `${stats.watched}/${stats.total} episodios vistos (${stats.percentage}%)`;
        }
        if (fillEl) {
          fillEl.style.width = `${stats.percentage}%`;
        }
        if (badgeEl) {
          badgeEl.style.display = (stats.total > 0 && stats.watched === stats.total) ? 'inline-flex' : 'none';
        }
      }
    });
  }

  /**
   * Returns current season progress.
   *
   * @param {Array<Object>} episodes
   * @param {string|number} seasonNumber
   * @returns {{ total: number, watched: number, percentage: number }}
   */
  function getSeasonProgressInstance(episodes, seasonNumber) {
    return getSeasonProgress(episodes || options.episodes || [], seasonNumber, localProgressMap);
  }

  /**
   * Injects an animated progress bar into targetContainer.
   *
   * @param {Array<Object>} episodes
   * @param {string|number} seasonNumber
   * @param {HTMLElement|string} targetContainer
   * @returns {HTMLElement|null}
   */
  function renderSeasonProgressBar(episodes, seasonNumber, targetContainer) {
    ensureTrackerStyles();

    let container = null;
    if (typeof targetContainer === 'string') {
      container = document.querySelector(targetContainer);
    } else if (targetContainer && targetContainer.nodeType === 1) {
      container = targetContainer;
    }

    const sStr = String(seasonNumber ?? 1);
    const stats = getSeasonProgressInstance(episodes, seasonNumber);

    const isComplete = stats.total > 0 && stats.watched === stats.total;
    const completeBadgeDisplay = isComplete ? 'inline-flex' : 'none';

    let wrapper = container ? container.querySelector(`.kura-season-tracker-wrapper[data-season="${escapeHtml(sStr)}"]`) : null;

    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'kura-season-tracker-wrapper';
      wrapper.setAttribute('data-season', sStr);
      wrapper.style.borderRadius = '4px';

      wrapper.innerHTML = `
        <div class="kura-season-header-row">
          <div class="kura-season-progress-label">
            <span class="kura-season-progress-text">${stats.watched}/${stats.total} episodios vistos (${stats.percentage}%)</span>
            <span class="kura-season-complete-badge" style="display: ${completeBadgeDisplay}; border-radius: 4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>TEMPORADA COMPLETA</span>
            </span>
          </div>
        </div>
        <div class="kura-season-progress-track" style="border-radius: 4px;">
          <div class="kura-season-progress-fill" style="width: ${stats.percentage}%; border-radius: 4px;"></div>
        </div>
      `;

      if (container) {
        container.innerHTML = '';
        container.appendChild(wrapper);
      }
    } else {
      const textEl = wrapper.querySelector('.kura-season-progress-text');
      const fillEl = wrapper.querySelector('.kura-season-progress-fill');
      const badgeEl = wrapper.querySelector('.kura-season-complete-badge');

      if (textEl) {
        textEl.textContent = `${stats.watched}/${stats.total} episodios vistos (${stats.percentage}%)`;
      }
      if (fillEl) {
        fillEl.style.width = `${stats.percentage}%`;
      }
      if (badgeEl) {
        badgeEl.style.display = completeBadgeDisplay;
      }
    }

    const entry = {
      seasonNumber: sStr,
      element: wrapper,
      episodes: episodes || options.episodes || []
    };
    renderedBars.add(entry);

    return wrapper;
  }

  /**
   * Injects "Marcar temporada como vista" and "Marcar como no vista" buttons.
   *
   * @param {string|number} seasonNumber
   * @param {Array<Object>} episodes
   * @param {Function|HTMLElement|string} [arg3] - Callback or container element/selector
   * @param {Function} [arg4] - Optional callback if arg3 is container
   * @returns {HTMLElement}
   */
  function renderSeasonBatchActions(seasonNumber, episodes, arg3, arg4) {
    ensureTrackerStyles();

    let targetContainer = null;
    let onBatchCallback = null;

    if (typeof arg3 === 'function') {
      onBatchCallback = arg3;
      if (typeof arg4 === 'string' || (arg4 && arg4.nodeType === 1)) {
        targetContainer = typeof arg4 === 'string' ? document.querySelector(arg4) : arg4;
      }
    } else if (typeof arg3 === 'string' || (arg3 && arg3.nodeType === 1)) {
      targetContainer = typeof arg3 === 'string' ? document.querySelector(arg3) : arg3;
      if (typeof arg4 === 'function') {
        onBatchCallback = arg4;
      }
    }

    const sStr = String(seasonNumber ?? 1);
    const actionsWrapper = document.createElement('div');
    actionsWrapper.className = 'season-batch-actions';
    actionsWrapper.setAttribute('data-season', sStr);
    actionsWrapper.style.borderRadius = '4px';

    actionsWrapper.innerHTML = `
      <button type="button" class="btn btn-sm btn-secondary btn-mark-season-watched" style="border-radius: 4px;" title="Marcar temporada como vista">
        <svg class="tracker-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <i data-lucide="check" style="width: 14px; height: 14px; stroke-width: 2.5;"></i>
        <span>Marcar temporada como vista</span>
      </button>
      <button type="button" class="btn btn-sm btn-secondary btn-mark-season-unwatched" style="border-radius: 4px;" title="Marcar como no vista">
        <svg class="tracker-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        <i data-lucide="check" style="width: 14px; height: 14px; stroke-width: 2.5;"></i>
        <span>Marcar como no vista</span>
      </button>
    `;

    if (typeof window !== 'undefined' && window.lucide) {
      window.lucide.createIcons({ root: actionsWrapper });
    }

    const handleActionsClick = async (e) => {
      const targetWatched = e.target && typeof e.target.closest === 'function' ? e.target.closest('.btn-mark-season-watched') : null;
      const targetUnwatched = e.target && typeof e.target.closest === 'function' ? e.target.closest('.btn-mark-season-unwatched') : null;

      if (targetWatched) {
        e.preventDefault();
        e.stopPropagation();
        targetWatched.disabled = true;
        try {
          const res = await markSeasonWatched(seasonNumber, episodes, true);
          if (typeof onBatchCallback === 'function') {
            onBatchCallback(res);
          }
        } finally {
          targetWatched.disabled = false;
        }
      } else if (targetUnwatched) {
        e.preventDefault();
        e.stopPropagation();
        targetUnwatched.disabled = true;
        try {
          const res = await markSeasonWatched(seasonNumber, episodes, false);
          if (typeof onBatchCallback === 'function') {
            onBatchCallback(res);
          }
        } finally {
          targetUnwatched.disabled = false;
        }
      }
    };

    actionsWrapper.addEventListener('click', handleActionsClick);

    cleanupListeners.push(() => {
      actionsWrapper.removeEventListener('click', handleActionsClick);
    });

    if (targetContainer) {
      targetContainer.innerHTML = '';
      targetContainer.appendChild(actionsWrapper);
    }

    return actionsWrapper;
  }

  /**
   * Marks all episodes belonging to seasonNumber as completed/unwatched.
   *
   * @param {string|number} seasonNumber
   * @param {Array<Object>} episodes
   * @param {boolean} isWatched
   * @returns {Promise<Object>}
   */
  async function markSeasonWatched(seasonNumber, episodes, isWatched) {
    const sStr = String(seasonNumber ?? 1);
    const epList = Array.isArray(episodes) ? episodes : (options.episodes || []);

    let seasonEps = epList.filter(ep => {
      if (!ep) return false;
      const sNum = String(ep.season_number ?? ep.season ?? 1);
      return sNum === sStr;
    });

    if (seasonEps.length === 0 && epList.length > 0 && epList.every(ep => ep.season_number === undefined && ep.season === undefined)) {
      seasonEps = epList;
    }

    const watchedBool = Boolean(isWatched);

    // 1. Update local memory and localStorage state
    let guestProg = null;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        guestProg = JSON.parse(localStorage.getItem('kura_guest_progress') || '{}');
      } catch {
        guestProg = {};
      }
    }

    seasonEps.forEach(ep => {
      if (!ep) return;
      const epId = String(ep.id ?? '');
      const dur = Number(ep.duration || 1440);

      localProgressMap.set(epId, {
        completed: watchedBool,
        progress_seconds: watchedBool ? dur : 0,
        duration: dur
      });

      if (seedMap && typeof seedMap === 'object') {
        seedMap[epId] = {
          completed: watchedBool,
          progress_seconds: watchedBool ? dur : 0,
          duration: dur
        };
      }

      if (guestProg) {
        guestProg[epId] = {
          progress: watchedBool ? dur : 0,
          duration: dur,
          completed: watchedBool,
          updated_at: Date.now()
        };
      }

      // Update DOM visual badges for episode cards
      updateEpisodeVisualBadge(epId, watchedBool);
    });

    if (guestProg && typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem('kura_guest_progress', JSON.stringify(guestProg));
      } catch {
        // Ignore failure
      }
    }

    // 2. Batch sync to /api/history
    const syncTasks = seasonEps.map(ep => syncEpisodeToHistory(ep.id, watchedBool, ep.duration));
    await Promise.allSettled(syncTasks);

    // 3. Update rendered progress bars
    refreshSeasonProgressBars(seasonNumber, epList);

    const progress = getSeasonProgressInstance(epList, seasonNumber);
    const result = {
      success: true,
      seasonNumber: sStr,
      isWatched: watchedBool,
      count: seasonEps.length,
      progress
    };

    if (onUpdateCallback) {
      try {
        onUpdateCallback(result);
      } catch (err) {
        console.warn('[EpisodeTracker] onUpdate callback error:', err);
      }
    }

    return result;
  }

  /**
   * Toggles individual episode watch state and updates visual badges.
   *
   * @param {string|number} episodeId
   * @param {boolean} [isWatched]
   * @returns {Promise<Object>}
   */
  async function toggleEpisodeWatched(episodeId, isWatched) {
    const epIdStr = String(episodeId);
    const currentWatched = isEpisodeWatched(epIdStr);
    const nextWatched = (typeof isWatched === 'boolean') ? isWatched : !currentWatched;

    // Lookup episode info if available
    const epList = options.episodes || [];
    const epObj = epList.find(ep => ep && String(ep.id) === epIdStr);
    const dur = Number((epObj && epObj.duration) || 1440);

    // 1. Update local state
    localProgressMap.set(epIdStr, {
      completed: nextWatched,
      progress_seconds: nextWatched ? dur : 0,
      duration: dur
    });

    if (seedMap && typeof seedMap === 'object') {
      seedMap[epIdStr] = {
        completed: nextWatched,
        progress_seconds: nextWatched ? dur : 0,
        duration: dur
      };
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const guestProg = JSON.parse(localStorage.getItem('kura_guest_progress') || '{}');
        guestProg[epIdStr] = {
          progress: nextWatched ? dur : 0,
          duration: dur,
          completed: nextWatched,
          updated_at: Date.now()
        };
        localStorage.setItem('kura_guest_progress', JSON.stringify(guestProg));
      } catch {
        // Ignore failure
      }
    }

    // 2. Update visual badge in DOM
    updateEpisodeVisualBadge(epIdStr, nextWatched);

    // 3. Sync to /api/history
    await syncEpisodeToHistory(epIdStr, nextWatched, dur);

    // 4. Update parent season progress bar if found
    const seasonNumber = epObj ? (epObj.season_number ?? epObj.season ?? 1) : 1;
    refreshSeasonProgressBars(seasonNumber, epList);

    const result = {
      success: true,
      episodeId: epIdStr,
      isWatched: nextWatched
    };

    if (onUpdateCallback) {
      try {
        onUpdateCallback(result);
      } catch (err) {
        console.warn('[EpisodeTracker] onUpdate callback error:', err);
      }
    }

    return result;
  }

  /**
   * Cleans up event listeners and references.
   */
  function destroy() {
    cleanupListeners.forEach(fn => {
      try {
        fn();
      } catch {
        // Ignore cleanup error
      }
    });
    cleanupListeners.length = 0;
    renderedBars.clear();
    localProgressMap.clear();

    if (typeof document !== 'undefined') {
      const styleEl = document.getElementById(STYLE_ID);
      if (styleEl && styleEl.parentNode) {
        styleEl.parentNode.removeChild(styleEl);
      }
    }
  }

  return {
    renderSeasonProgressBar,
    renderSeasonBatchActions,
    markSeasonWatched,
    toggleEpisodeWatched,
    getSeasonProgress: getSeasonProgressInstance,
    destroy,
    // Additional helpers
    isEpisodeWatched,
    updateEpisodeVisualBadge
  };
}

export default initEpisodeTracker;
