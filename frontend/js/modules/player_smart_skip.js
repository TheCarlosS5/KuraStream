/**
 * player_smart_skip.js - Smart Skip Intro & Auto-Next Transition Engine for KuraStream 2.0
 *
 * Netflix-grade intelligent intro skipping pill with animated countdown bar,
 * and seamless end-of-episode next episode transition card with 16:9 thumbnail preview.
 */

const STYLE_ID = 'kura-player-smart-skip-styles';

/**
 * Escapes HTML characters to prevent XSS.
 *
 * @param {string} str
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
 * Injects required styles into the document head if not already present.
 */
function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;

  const styleEl = document.createElement('style');
  styleEl.id = STYLE_ID;
  styleEl.textContent = `
    /* Floating Skip Intro Pill */
    .smart-skip-intro-pill {
      position: absolute;
      bottom: 84px;
      right: 32px;
      z-index: 60;
      display: none;
      align-items: center;
      gap: 10px;
      background: rgba(19, 26, 28, 0.95);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 4px;
      color: #ffffff;
      padding: 10px 18px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 0.92rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.65), 0 0 12px rgba(0, 224, 143, 0.12);
      opacity: 0;
      visibility: hidden;
      transform: translateY(12px) scale(0.96);
      transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1),
                  transform 0.22s cubic-bezier(0.16, 1, 0.3, 1),
                  visibility 0.22s,
                  background-color 0.15s,
                  border-color 0.15s,
                  box-shadow 0.15s;
      pointer-events: none;
      user-select: none;
      overflow: hidden;
    }

    .smart-skip-intro-pill.is-visible {
      opacity: 1;
      visibility: visible;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    .smart-skip-intro-pill:hover {
      background: rgba(26, 36, 39, 0.98);
      border-color: #00e08f;
      color: #ffffff;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.75), 0 0 16px rgba(0, 224, 143, 0.35);
      transform: translateY(-2px);
    }

    .smart-skip-intro-pill:focus-visible {
      outline: 2px solid #00e08f;
      outline-offset: 2px;
      border-radius: 4px;
    }

    .smart-skip-intro-pill:active {
      transform: translateY(0) scale(0.98);
    }

    .smart-skip-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      color: #00e08f;
      flex-shrink: 0;
    }

    .smart-skip-icon svg,
    .smart-skip-icon i {
      width: 18px;
      height: 18px;
      display: block;
    }

    .smart-skip-label {
      white-space: nowrap;
    }

    .smart-skip-countdown {
      font-size: 0.84rem;
      font-weight: 500;
      color: #94a3b8;
      margin-left: 2px;
    }

    .smart-skip-progress {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: rgba(255, 255, 255, 0.12);
      border-radius: 4px;
      overflow: hidden;
    }

    .smart-skip-progress-bar {
      display: block;
      height: 100%;
      width: 100%;
      background: #00e08f;
      border-radius: 4px;
      transform-origin: left center;
      transition: width 0.1s linear;
    }

    /* Auto-Advance Next Episode Card */
    .smart-next-ep-card {
      position: absolute;
      bottom: 84px;
      right: 32px;
      width: 360px;
      max-width: calc(100% - 40px);
      background: rgba(19, 26, 28, 0.95);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 4px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.8), 0 0 20px rgba(0, 224, 143, 0.12);
      color: #ffffff;
      padding: 16px;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      z-index: 65;
      display: none;
      opacity: 0;
      visibility: hidden;
      transform: translateY(16px) scale(0.96);
      transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1),
                  transform 0.25s cubic-bezier(0.16, 1, 0.3, 1),
                  visibility 0.25s;
      pointer-events: none;
      overflow: hidden;
    }

    .smart-next-ep-card.is-visible {
      opacity: 1;
      visibility: visible;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    .smart-next-ep-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .smart-next-ep-badge {
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #00e08f;
      background: rgba(0, 224, 143, 0.12);
      border: 1px solid rgba(0, 224, 143, 0.25);
      border-radius: 4px;
      padding: 3px 8px;
    }

    .smart-next-close-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      width: 26px;
      height: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.25rem;
      line-height: 1;
      cursor: pointer;
      border-radius: 4px;
      transition: color 0.15s, background-color 0.15s;
    }

    .smart-next-close-btn:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.1);
    }

    .smart-next-ep-body {
      display: flex;
      gap: 14px;
      align-items: flex-start;
      margin-bottom: 12px;
    }

    .smart-next-ep-thumb-wrap {
      width: 128px;
      aspect-ratio: 16 / 9;
      flex-shrink: 0;
      position: relative;
      background: #0b0f12;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      overflow: hidden;
    }

    .smart-next-ep-thumb {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      border-radius: 4px;
    }

    .smart-next-ep-thumb-fallback {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #182328 0%, #0d1518 100%);
      color: #00e08f;
      border-radius: 4px;
    }

    .smart-next-ep-details {
      flex: 1;
      min-width: 0;
    }

    .smart-next-ep-num {
      font-size: 0.78rem;
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .smart-next-ep-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 6px;
      line-height: 1.25;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .smart-next-ep-countdown-msg {
      font-size: 0.8rem;
      color: #cbd5e1;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .smart-next-ep-countdown-msg strong {
      color: #00e08f;
      font-weight: 700;
    }

    /* Linear Countdown Progress Bar */
    .smart-next-ep-progress-wrap {
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.12);
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 14px;
    }

    .smart-next-ep-progress-fill {
      height: 100%;
      width: 100%;
      background: linear-gradient(90deg, #00b4d8, #00e08f);
      border-radius: 4px;
      transform-origin: left center;
      transition: width 0.1s linear;
    }

    /* Actions */
    .smart-next-ep-actions {
      display: flex;
      gap: 10px;
    }

    .smart-next-btn {
      border-radius: 4px;
      font-family: inherit;
      font-size: 0.88rem;
      padding: 9px 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      cursor: pointer;
      transition: background-color 0.15s, transform 0.15s, box-shadow 0.15s, border-color 0.15s;
      box-sizing: border-box;
    }

    .smart-next-btn-play {
      flex: 1;
      background: #00e08f;
      border: 1px solid #00e08f;
      color: #0b0f12;
      font-weight: 700;
      box-shadow: 0 4px 14px rgba(0, 224, 143, 0.25);
    }

    .smart-next-btn-play:hover {
      background: #00ff9f;
      border-color: #00ff9f;
      box-shadow: 0 6px 18px rgba(0, 224, 143, 0.45);
      transform: translateY(-1px);
    }

    .smart-next-btn-play:active {
      transform: translateY(0);
    }

    .smart-next-btn-cancel {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.18);
      color: #e2e8f0;
      font-weight: 600;
    }

    .smart-next-btn-cancel:hover {
      background: rgba(255, 255, 255, 0.16);
      border-color: rgba(255, 255, 255, 0.28);
      color: #ffffff;
    }

    .smart-next-btn-cancel:active {
      transform: translateY(0);
    }

    @media (max-width: 520px) {
      .smart-skip-intro-pill {
        bottom: 74px;
        right: 16px;
        padding: 8px 14px;
        font-size: 0.85rem;
      }
      .smart-next-ep-card {
        bottom: 74px;
        right: 16px;
        width: calc(100% - 32px);
        padding: 12px;
      }
      .smart-next-ep-thumb-wrap {
        width: 104px;
      }
    }
  `;
  document.head.appendChild(styleEl);
}

/**
 * Refreshes Lucide icons inside a container if Lucide is available globally.
 *
 * @param {HTMLElement} rootEl
 */
function refreshLucideIcons(rootEl) {
  if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
    try {
      window.lucide.createIcons({ root: rootEl });
    } catch {
      // Fallback SVG content already in DOM
    }
  }
}

/**
 * Normalizes a time value into non-negative number or null.
 *
 * @param {*} val
 * @returns {number|null}
 */
function parseTime(val) {
  if (val === null || val === undefined) return null;
  const num = Number(val);
  return !isNaN(num) && num >= 0 ? num : null;
}

/**
 * Initializes the Smart Skip Intro & Auto-Next Transition module.
 *
 * @param {HTMLVideoElement|string} videoElement - Video element or selector
 * @param {HTMLElement|string} [containerElement] - Player container element or selector
 * @param {Object} [options={}] - Configuration options
 * @param {number|null} [options.introStart=null] - Intro start boundary in seconds
 * @param {number|null} [options.introEnd=null] - Intro end boundary in seconds
 * @param {number|null} [options.outroStart=null] - Outro start boundary in seconds
 * @param {Object|null} [options.nextEpisode=null] - Next episode metadata
 * @param {Function|null} [options.onSkip=null] - Callback invoked when intro is skipped
 * @param {Function|null} [options.onPlayNext=null] - Callback invoked when next episode is started
 * @param {Function|null} [options.onCancel=null] - Callback invoked when auto-advance is cancelled
 * @param {number} [options.skipCountdownSeconds=5] - Default countdown duration for intro pill
 * @param {number} [options.autoAdvanceCountdown=8] - Default countdown duration for next card
 * @param {string} [options.pillLabel='Saltar Intro'] - Text label for skip intro pill
 * @param {boolean} [options.autoSkip=false] - Whether to auto-skip intro without pill
 * @returns {{
 *   setTimingIntervals: (intervals: { introStart?: number, introEnd?: number, outroStart?: number }) => Object,
 *   showSkipPill: (labelText?: string, onSkip?: Function, countdownSeconds?: number) => void,
 *   hideSkipPill: () => void,
 *   showNextEpisodeCard: (params?: { nextEpisode?: Object, onPlayNext?: Function, onCancel?: Function, countdownSeconds?: number }) => void,
 *   cancelNextEpisodeCountdown: () => void,
 *   destroy: () => void,
 *   isPillVisible: () => boolean,
 *   isNextCardVisible: () => boolean,
 *   pillElement: HTMLElement|null,
 *   cardElement: HTMLElement|null
 * }}
 */
export function initSmartSkip(videoElement, containerElement, options = {}) {
  injectStyles();

  const video = typeof videoElement === 'string'
    ? (typeof document !== 'undefined' ? document.querySelector(videoElement) : null)
    : videoElement;

  const container = typeof containerElement === 'string'
    ? (typeof document !== 'undefined' ? document.querySelector(containerElement) : null)
    : (containerElement || (video ? video.parentElement : null) || (typeof document !== 'undefined' ? document.body : null));

  // If container has static position, set relative so absolute positioning works
  if (container && typeof window !== 'undefined' && window.getComputedStyle) {
    const comp = window.getComputedStyle(container);
    if (comp.position === 'static') {
      container.style.position = 'relative';
    }
  }

  // Internal Timing Intervals
  const intervals = {
    introStart: parseTime(options.introStart),
    introEnd: parseTime(options.introEnd),
    outroStart: parseTime(options.outroStart),
  };

  // State
  let isDestroyed = false;
  let isPillShowing = false;
  let isCardShowing = false;
  let hasSkippedIntro = false;
  let hasShownOutro = false;
  let hasCanceledOutro = false;

  let currentNextEpisode = options.nextEpisode || null;
  let currentOnSkip = options.onSkip || null;
  let currentOnPlayNext = options.onPlayNext || null;
  let currentOnCancel = options.onCancel || null;

  let pillCountdownTimer = null;
  let nextCountdownTimer = null;

  // DOM Elements
  let pillElement = null;
  let pillLabelEl = null;
  let pillCountdownEl = null;
  let pillProgressWrap = null;
  let pillProgressBar = null;

  let cardElement = null;
  let cardEpNum = null;
  let cardEpTitle = null;
  let cardCountdownMsg = null;
  let cardThumbImg = null;
  let cardThumbFallback = null;
  let cardProgressWrap = null;
  let cardProgressFill = null;
  let cardBtnPlay = null;
  let cardBtnCancel = null;
  let cardBtnClose = null;

  // 1. Build Skip Intro Pill
  if (container && typeof document !== 'undefined') {
    pillElement = document.createElement('button');
    pillElement.type = 'button';
    pillElement.className = 'smart-skip-intro-pill';
    pillElement.setAttribute('aria-label', options.pillLabel || 'Saltar Intro');
    pillElement.setAttribute('tabindex', '0');

    pillElement.innerHTML = `
      <span class="smart-skip-icon">
        <i data-lucide="fast-forward">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 19 22 12 13 5 13 19"></polygon>
            <polygon points="2 19 11 12 2 5 2 19"></polygon>
          </svg>
        </i>
      </span>
      <span class="smart-skip-label">${escapeHtml(options.pillLabel || 'Saltar Intro')}</span>
      <span class="smart-skip-countdown">(5s)</span>
      <span class="smart-skip-progress">
        <span class="smart-skip-progress-bar"></span>
      </span>
    `;

    pillLabelEl = pillElement.querySelector('.smart-skip-label');
    pillCountdownEl = pillElement.querySelector('.smart-skip-countdown');
    pillProgressWrap = pillElement.querySelector('.smart-skip-progress');
    pillProgressBar = pillElement.querySelector('.smart-skip-progress-bar');

    pillElement.addEventListener('click', (e) => {
      e.stopPropagation();
      performSkipIntro();
    });

    pillElement.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        performSkipIntro();
      }
    });

    container.appendChild(pillElement);
    refreshLucideIcons(pillElement);
  }

  // 2. Build Next Episode Card
  if (container && typeof document !== 'undefined') {
    cardElement = document.createElement('div');
    cardElement.className = 'smart-next-ep-card';
    cardElement.setAttribute('role', 'dialog');
    cardElement.setAttribute('aria-label', 'Siguiente Episodio');

    cardElement.innerHTML = `
      <div class="smart-next-ep-header">
        <span class="smart-next-ep-badge">Siguiente Episodio</span>
        <button type="button" class="smart-next-close-btn" aria-label="Cerrar">&times;</button>
      </div>
      <div class="smart-next-ep-body">
        <div class="smart-next-ep-thumb-wrap">
          <img class="smart-next-ep-thumb" src="" alt="Siguiente Episodio" style="display: none;" />
          <div class="smart-next-ep-thumb-fallback">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </div>
        </div>
        <div class="smart-next-ep-details">
          <div class="smart-next-ep-num"></div>
          <div class="smart-next-ep-title"></div>
          <div class="smart-next-ep-countdown-msg">
            Siguiente episodio en <strong>8s...</strong>
          </div>
        </div>
      </div>
      <div class="smart-next-ep-progress-wrap">
        <div class="smart-next-ep-progress-fill"></div>
      </div>
      <div class="smart-next-ep-actions">
        <button type="button" class="smart-next-btn smart-next-btn-play" aria-label="Ver Ahora">
          <i data-lucide="play">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </i>
          <span>Ver Ahora</span>
        </button>
        <button type="button" class="smart-next-btn smart-next-btn-cancel" aria-label="Cancelar">
          <i data-lucide="x">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </i>
          <span>Cancelar</span>
        </button>
      </div>
    `;

    cardEpNum = cardElement.querySelector('.smart-next-ep-num');
    cardEpTitle = cardElement.querySelector('.smart-next-ep-title');
    cardCountdownMsg = cardElement.querySelector('.smart-next-ep-countdown-msg');
    cardThumbImg = cardElement.querySelector('.smart-next-ep-thumb');
    cardThumbFallback = cardElement.querySelector('.smart-next-ep-thumb-fallback');
    cardProgressWrap = cardElement.querySelector('.smart-next-ep-progress-wrap');
    cardProgressFill = cardElement.querySelector('.smart-next-ep-progress-fill');
    cardBtnPlay = cardElement.querySelector('.smart-next-btn-play');
    cardBtnCancel = cardElement.querySelector('.smart-next-btn-cancel');
    cardBtnClose = cardElement.querySelector('.smart-next-close-btn');

    cardThumbImg.addEventListener('error', () => {
      cardThumbImg.style.display = 'none';
      if (cardThumbFallback) cardThumbFallback.style.display = 'flex';
    });

    cardBtnPlay.addEventListener('click', (e) => {
      e.stopPropagation();
      performPlayNext();
    });

    cardBtnCancel.addEventListener('click', (e) => {
      e.stopPropagation();
      performCancelNext();
    });

    cardBtnClose.addEventListener('click', (e) => {
      e.stopPropagation();
      performCancelNext();
    });

    container.appendChild(cardElement);
    refreshLucideIcons(cardElement);
  }

  /**
   * Seeks to introEnd and invokes skip callbacks.
   */
  function performSkipIntro() {
    if (isDestroyed) return;
    const targetTime = intervals.introEnd;
    hideSkipPill();
    hasSkippedIntro = true;

    if (typeof targetTime === 'number' && targetTime > 0 && video) {
      try {
        video.currentTime = targetTime;
      } catch (err) {
        console.warn('[SmartSkip] Error seeking to introEnd:', err);
      }
    }

    if (typeof currentOnSkip === 'function') {
      try {
        currentOnSkip(targetTime);
      } catch (err) {
        console.warn('[SmartSkip] Error in onSkip callback:', err);
      }
    }
  }

  /**
   * Advances to next episode.
   */
  function performPlayNext() {
    if (isDestroyed) return;
    cancelNextEpisodeCountdown();
    hideNextEpisodeCard();
    hasShownOutro = true;

    const ep = currentNextEpisode || options.nextEpisode || null;
    if (typeof currentOnPlayNext === 'function') {
      try {
        currentOnPlayNext(ep);
      } catch (err) {
        console.warn('[SmartSkip] Error in onPlayNext callback:', err);
      }
    }
  }

  /**
   * Cancels next episode countdown and dismisses card.
   */
  function performCancelNext() {
    if (isDestroyed) return;
    cancelNextEpisodeCountdown();
    hideNextEpisodeCard();
    hasCanceledOutro = true;

    if (typeof currentOnCancel === 'function') {
      try {
        currentOnCancel();
      } catch (err) {
        console.warn('[SmartSkip] Error in onCancel callback:', err);
      }
    }
  }

  /**
   * Displays the floating skip intro pill with optional countdown.
   *
   * @param {string} [labelText='Saltar Intro']
   * @param {Function} [onSkip=null]
   * @param {number} [countdownSeconds=5]
   */
  function showSkipPill(labelText, onSkip, countdownSeconds) {
    if (isDestroyed || !pillElement) return;

    if (typeof labelText === 'string' && labelText.trim()) {
      if (pillLabelEl) pillLabelEl.textContent = labelText;
      pillElement.setAttribute('aria-label', labelText);
    }

    if (typeof onSkip === 'function') {
      currentOnSkip = onSkip;
    }

    const duration = typeof countdownSeconds === 'number'
      ? countdownSeconds
      : (typeof options.skipCountdownSeconds === 'number' ? options.skipCountdownSeconds : 5);

    if (pillCountdownTimer) {
      clearInterval(pillCountdownTimer);
      pillCountdownTimer = null;
    }

    if (duration > 0) {
      if (pillCountdownEl) {
        pillCountdownEl.style.display = 'inline';
        pillCountdownEl.textContent = `(${Math.ceil(duration)}s)`;
      }
      if (pillProgressWrap) {
        pillProgressWrap.style.display = 'block';
      }
      if (pillProgressBar) {
        pillProgressBar.style.width = '100%';
      }

      const totalMs = duration * 1000;
      const startMs = Date.now();

      pillCountdownTimer = setInterval(() => {
        const elapsed = Date.now() - startMs;
        const remainingSeconds = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
        const progressRatio = Math.max(0, Math.min(1, 1 - (elapsed / totalMs)));

        if (pillCountdownEl) {
          pillCountdownEl.textContent = `(${remainingSeconds}s)`;
        }
        if (pillProgressBar) {
          pillProgressBar.style.width = `${progressRatio * 100}%`;
        }

        if (elapsed >= totalMs) {
          clearInterval(pillCountdownTimer);
          pillCountdownTimer = null;
          hideSkipPill();
        }
      }, 100);
    } else {
      if (pillCountdownEl) pillCountdownEl.style.display = 'none';
      if (pillProgressWrap) pillProgressWrap.style.display = 'none';
    }

    pillElement.style.display = 'inline-flex';
    void pillElement.offsetWidth;
    pillElement.classList.add('is-visible');
    pillElement.setAttribute('aria-hidden', 'false');
    isPillShowing = true;
    refreshLucideIcons(pillElement);
  }

  /**
   * Hides the skip intro pill.
   */
  function hideSkipPill() {
    if (pillCountdownTimer) {
      clearInterval(pillCountdownTimer);
      pillCountdownTimer = null;
    }

    if (pillElement) {
      pillElement.classList.remove('is-visible');
      pillElement.setAttribute('aria-hidden', 'true');
      setTimeout(() => {
        if (!isPillShowing && pillElement) {
          pillElement.style.display = 'none';
        }
      }, 220);
    }

    isPillShowing = false;
  }

  /**
   * Displays the next episode card with countdown timer.
   *
   * @param {Object} [params={}]
   * @param {Object} [params.nextEpisode]
   * @param {Function} [params.onPlayNext]
   * @param {Function} [params.onCancel]
   * @param {number} [params.countdownSeconds]
   */
  function showNextEpisodeCard(params = {}) {
    if (isDestroyed || !cardElement) return;

    if (params.nextEpisode !== undefined) {
      currentNextEpisode = params.nextEpisode;
    } else if (!currentNextEpisode && options.nextEpisode) {
      currentNextEpisode = options.nextEpisode;
    }

    if (typeof params.onPlayNext === 'function') {
      currentOnPlayNext = params.onPlayNext;
    }
    if (typeof params.onCancel === 'function') {
      currentOnCancel = params.onCancel;
    }

    const duration = typeof params.countdownSeconds === 'number'
      ? params.countdownSeconds
      : (typeof options.autoAdvanceCountdown === 'number' ? options.autoAdvanceCountdown : 8);

    // Populate episode metadata
    const ep = currentNextEpisode;
    let epNumText = '';
    let epTitleText = 'Siguiente Episodio';

    if (ep) {
      const s = ep.season_number ?? ep.season;
      const e = ep.episode_number ?? ep.episode;
      if (s !== undefined && e !== undefined) {
        epNumText = `Temporada ${s} • Episodio ${e}`;
      } else if (e !== undefined) {
        epNumText = `Episodio ${e}`;
      }
      if (ep.title || ep.name) {
        epTitleText = ep.title || ep.name;
      }
    }

    if (cardEpNum) {
      cardEpNum.textContent = epNumText;
      cardEpNum.style.display = epNumText ? 'block' : 'none';
    }

    if (cardEpTitle) {
      cardEpTitle.textContent = epTitleText;
    }

    const thumbUrl = ep?.thumbnail || ep?.thumbnail_url || ep?.still_path || ep?.poster || ep?.image || '';
    if (thumbUrl && cardThumbImg) {
      cardThumbImg.src = thumbUrl;
      cardThumbImg.alt = epTitleText;
      cardThumbImg.style.display = 'block';
      if (cardThumbFallback) cardThumbFallback.style.display = 'none';
    } else {
      if (cardThumbImg) {
        cardThumbImg.removeAttribute('src');
        cardThumbImg.style.display = 'none';
      }
      if (cardThumbFallback) cardThumbFallback.style.display = 'flex';
    }

    // Show card element
    cardElement.style.display = 'block';
    void cardElement.offsetWidth;
    cardElement.classList.add('is-visible');
    cardElement.setAttribute('aria-hidden', 'false');
    isCardShowing = true;
    refreshLucideIcons(cardElement);

    // Handle Countdown Timer
    cancelNextEpisodeCountdown();

    if (duration > 0) {
      if (cardCountdownMsg) {
        cardCountdownMsg.innerHTML = `Siguiente episodio en <strong>${Math.ceil(duration)}s...</strong>`;
      }
      if (cardProgressWrap) {
        cardProgressWrap.style.display = 'block';
      }
      if (cardProgressFill) {
        cardProgressFill.style.width = '100%';
      }

      const totalMs = duration * 1000;
      const startMs = Date.now();

      nextCountdownTimer = setInterval(() => {
        const elapsed = Date.now() - startMs;
        const remainingSeconds = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
        const progressRatio = Math.max(0, Math.min(1, 1 - (elapsed / totalMs)));

        if (cardCountdownMsg) {
          cardCountdownMsg.innerHTML = `Siguiente episodio en <strong>${remainingSeconds}s...</strong>`;
        }
        if (cardProgressFill) {
          cardProgressFill.style.width = `${progressRatio * 100}%`;
        }

        if (elapsed >= totalMs) {
          cancelNextEpisodeCountdown();
          hideNextEpisodeCard();
          if (typeof currentOnPlayNext === 'function') {
            currentOnPlayNext(currentNextEpisode);
          }
        }
      }, 50);
    } else {
      if (cardCountdownMsg) {
        cardCountdownMsg.innerHTML = 'Siguiente episodio disponible';
      }
      if (cardProgressWrap) {
        cardProgressWrap.style.display = 'none';
      }
    }
  }

  /**
   * Hides the next episode card.
   */
  function hideNextEpisodeCard() {
    cancelNextEpisodeCountdown();
    if (cardElement) {
      cardElement.classList.remove('is-visible');
      cardElement.setAttribute('aria-hidden', 'true');
      setTimeout(() => {
        if (!isCardShowing && cardElement) {
          cardElement.style.display = 'none';
        }
      }, 250);
    }
    isCardShowing = false;
  }

  /**
   * Cancels the next episode auto-advance countdown timer.
   */
  function cancelNextEpisodeCountdown() {
    if (nextCountdownTimer) {
      clearInterval(nextCountdownTimer);
      nextCountdownTimer = null;
    }
    if (cardProgressWrap) {
      cardProgressWrap.style.display = 'none';
    }
    if (cardCountdownMsg && isCardShowing) {
      cardCountdownMsg.innerHTML = 'Reproducción automática pausada';
    }
  }

  /**
   * Updates skip and outro timing boundaries for the current media.
   *
   * @param {Object} newIntervals
   * @param {number|null} [newIntervals.introStart]
   * @param {number|null} [newIntervals.introEnd]
   * @param {number|null} [newIntervals.outroStart]
   * @returns {{ introStart: number|null, introEnd: number|null, outroStart: number|null }}
   */
  function setTimingIntervals(newIntervals = {}) {
    const oldIntroStart = intervals.introStart;
    const oldIntroEnd = intervals.introEnd;
    const oldOutroStart = intervals.outroStart;

    if (newIntervals.introStart !== undefined) {
      intervals.introStart = parseTime(newIntervals.introStart);
    }
    if (newIntervals.introEnd !== undefined) {
      intervals.introEnd = parseTime(newIntervals.introEnd);
    }
    if (newIntervals.outroStart !== undefined) {
      intervals.outroStart = parseTime(newIntervals.outroStart);
    }

    if (
      oldIntroStart !== intervals.introStart ||
      oldIntroEnd !== intervals.introEnd ||
      oldOutroStart !== intervals.outroStart
    ) {
      hasSkippedIntro = false;
      hasShownOutro = false;
      hasCanceledOutro = false;
    }

    return { ...intervals };
  }

  /**
   * Checks video playback time against boundaries.
   */
  function handleTimeUpdate() {
    if (isDestroyed || !video) return;
    const currentTime = video.currentTime;
    if (typeof currentTime !== 'number' || isNaN(currentTime)) return;

    // 1. Skip Intro Boundary Checks
    const { introStart, introEnd, outroStart } = intervals;
    const hasIntro = typeof introStart === 'number' && typeof introEnd === 'number' && introEnd > introStart;

    if (hasIntro) {
      if (currentTime >= introStart && currentTime < introEnd) {
        const isAutoSkip = options.autoSkip === true ||
          (typeof window !== 'undefined' && (
            window.userPreferences?.auto_skip_intro === true ||
            window.userPreferences?.auto_skip_intro === 'true'
          )) ||
          (typeof localStorage !== 'undefined' && localStorage.getItem('kurastream_auto_skip_intro') === 'true');

        if (isAutoSkip && !hasSkippedIntro) {
          hasSkippedIntro = true;
          video.currentTime = introEnd;
          if (typeof currentOnSkip === 'function') {
            currentOnSkip(introEnd);
          }
          return;
        }

        if (!isPillShowing && !hasSkippedIntro) {
          showSkipPill(options.pillLabel || 'Saltar Intro', currentOnSkip, options.skipCountdownSeconds ?? 5);
        }
      } else {
        if (isPillShowing) {
          hideSkipPill();
        }
        if (currentTime < introStart) {
          // Rewound before intro
          hasSkippedIntro = false;
        } else if (currentTime >= introEnd) {
          hasSkippedIntro = true;
        }
      }
    }

    // 2. Outro & Next Episode Transition Boundary Checks
    const hasOutro = typeof outroStart === 'number' && outroStart > 0;
    if (hasOutro) {
      if (currentTime >= outroStart) {
        if (!isCardShowing && !hasShownOutro && !hasCanceledOutro) {
          hasShownOutro = true;
          showNextEpisodeCard({
            nextEpisode: currentNextEpisode || options.nextEpisode,
            onPlayNext: currentOnPlayNext,
            onCancel: currentOnCancel,
            countdownSeconds: options.autoAdvanceCountdown ?? 8,
          });
        }
      } else if (currentTime < outroStart - 2) {
        // Rewound well before outro
        hasShownOutro = false;
        hasCanceledOutro = false;
      }
    }
  }

  /**
   * Triggers next episode card when video naturally finishes.
   */
  function handleEnded() {
    if (isDestroyed) return;
    if (!isCardShowing && !hasShownOutro && !hasCanceledOutro) {
      hasShownOutro = true;
      showNextEpisodeCard({
        nextEpisode: currentNextEpisode || options.nextEpisode,
        onPlayNext: currentOnPlayNext,
        onCancel: currentOnCancel,
        countdownSeconds: options.autoAdvanceCountdown ?? 8,
      });
    }
  }

  /**
   * Resets boundaries on seeking if appropriate.
   */
  function handleSeeking() {
    if (isDestroyed || !video) return;
    const currentTime = video.currentTime;
    const { introStart, introEnd, outroStart } = intervals;

    if (typeof introStart === 'number' && typeof introEnd === 'number') {
      if (currentTime < introStart || currentTime >= introEnd) {
        if (isPillShowing) hideSkipPill();
      }
      if (currentTime < introStart) {
        hasSkippedIntro = false;
      }
    }

    if (typeof outroStart === 'number' && outroStart > 0) {
      if (currentTime < outroStart - 2) {
        hasShownOutro = false;
        hasCanceledOutro = false;
        if (isCardShowing) hideNextEpisodeCard();
      }
    }
  }

  /**
   * Global keydown listener for Space/Enter intro skipping when pill is active.
   *
   * @param {KeyboardEvent} e
   */
  function handleKeyDown(e) {
    if (isDestroyed || !isPillShowing) return;

    const tag = e.target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;

    if (e.key === 'Enter' || e.key === ' ' || e.key.toLowerCase() === 's') {
      const isTargetingPlayer = e.target === pillElement ||
        e.target === video ||
        (container && container.contains(e.target)) ||
        e.target === document.body;

      if (isTargetingPlayer) {
        e.preventDefault();
        e.stopPropagation();
        performSkipIntro();
      }
    }
  }

  // Attach Event Listeners
  if (video) {
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('seeking', handleSeeking);
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', handleKeyDown);
  }

  /**
   * Tears down all DOM elements, intervals, and event listeners.
   */
  function destroy() {
    if (isDestroyed) return;
    isDestroyed = true;

    hideSkipPill();
    hideNextEpisodeCard();
    cancelNextEpisodeCountdown();

    if (pillCountdownTimer) {
      clearInterval(pillCountdownTimer);
      pillCountdownTimer = null;
    }
    if (nextCountdownTimer) {
      clearInterval(nextCountdownTimer);
      nextCountdownTimer = null;
    }

    if (video) {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('seeking', handleSeeking);
    }

    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', handleKeyDown);
    }

    if (pillElement && pillElement.parentNode) {
      pillElement.parentNode.removeChild(pillElement);
    }
    if (cardElement && cardElement.parentNode) {
      cardElement.parentNode.removeChild(cardElement);
    }

    pillElement = null;
    cardElement = null;
  }

  return {
    setTimingIntervals,
    showSkipPill,
    hideSkipPill,
    showNextEpisodeCard,
    cancelNextEpisodeCountdown,
    destroy,
    isPillVisible: () => isPillShowing,
    isNextCardVisible: () => isCardShowing,
    pillElement,
    cardElement,
  };
}

export default initSmartSkip;
