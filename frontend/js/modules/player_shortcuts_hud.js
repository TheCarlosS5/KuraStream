/**
 * player_shortcuts_hud.js - Keyboard HUD OSD & Interactive Hotkeys Cheat Sheet
 *
 * Netflix/YouTube style On-Screen Display (HUD) feedback pill and interactive
 * hotkey cheat sheet modal for keyboard navigation during video playback.
 */

const STYLE_ID = 'kura-player-shortcuts-hud-styles';

/**
 * Default shortcut definitions grouped in a clean 2-column layout.
 */
export const DEFAULT_SHORTCUTS = [
  {
    category: 'Reproducción y Navegación',
    items: [
      { keys: ['Espacio', 'K'], description: 'Reproducir / Pausar' },
      { keys: ['J', '←'], description: 'Retroceder 10 segundos' },
      { keys: ['L', '→'], description: 'Avanzar 10 segundos' },
      { keys: ['S', '< / >'], description: 'Velocidad de reproducción (0.5x - 2x)' },
      { keys: ['F'], description: 'Alternar pantalla completa' }
    ]
  },
  {
    category: 'Audio y Opciones',
    items: [
      { keys: ['↑', '↓'], description: 'Subir / Bajar volumen (5%)' },
      { keys: ['M'], description: 'Silenciar / Activar sonido' },
      { keys: ['B'], description: 'Audio Boost (100% - 200%)' },
      { keys: ['C'], description: 'Alternar subtítulos' },
      { keys: ['?', 'H'], description: 'Abrir / Cerrar atajos de teclado' },
      { keys: ['Esc'], description: 'Cerrar atajos o modal activo' }
    ]
  }
];

const SPEED_RATES_DEFAULT = [0.5, 0.75, 1, 1.25, 1.5, 2];
const BOOST_LEVELS_DEFAULT = [100, 125, 150, 175, 200];

const ICON_SYMBOL_MAP = {
  play: 'PLAY',
  pause: 'PAUSE',
  rewind: 'REW',
  'fast-forward': 'FF',
  'volume-high': 'VOL',
  'volume-2': 'VOL',
  'volume-low': 'VOL',
  'volume-1': 'VOL',
  'volume-mute': 'MUTE',
  'volume-x': 'MUTE',
  volume: 'VOL',
  fullscreen: 'FS',
  maximize: 'FS',
  subtitles: 'SUB',
  speed: 'SPD',
  zap: 'SPD',
  boost: 'BST',
  rocket: 'BST',
  help: '?',
  info: 'i'
};

/**
 * Escape HTML characters to prevent XSS.
 *
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Injects required styles for HUD pill and cheat sheet modal into document head.
 */
function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .player-hud-pill {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.92);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 14px 26px;
      min-width: 140px;
      max-width: 85%;
      box-sizing: border-box;
      background: rgba(11, 15, 20, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 4px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.75);
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 1.15rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      text-align: center;
      pointer-events: none;
      z-index: 9999;
      opacity: 0;
      visibility: hidden;
      transition: opacity 600ms cubic-bezier(0.16, 1, 0.3, 1),
                  transform 600ms cubic-bezier(0.16, 1, 0.3, 1),
                  visibility 600ms cubic-bezier(0.16, 1, 0.3, 1);
      user-select: none;
    }

    .player-hud-pill.is-visible {
      opacity: 1;
      visibility: visible;
      transform: translate(-50%, -50%) scale(1);
    }

    .player-hud-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 1.35rem;
      line-height: 1;
      flex-shrink: 0;
      color: #ffffff;
    }

    .player-hud-label {
      display: inline-block;
      white-space: nowrap;
      color: #ffffff;
      line-height: 1.2;
    }

    .shortcuts-modal-container {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 10001;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      opacity: 0;
      transition: opacity 200ms ease;
      box-sizing: border-box;
      padding: 1rem;
    }

    .shortcuts-modal-container.is-open {
      display: flex;
      opacity: 1;
    }

    .shortcuts-modal-dialog {
      position: relative;
      width: 92%;
      max-width: 680px;
      max-height: 85vh;
      background: #0b0f14;
      background: rgba(11, 15, 20, 0.95);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 4px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.85);
      color: #ffffff;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transform: scale(0.95);
      transition: transform 200ms ease;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      box-sizing: border-box;
    }

    .shortcuts-modal-container.is-open .shortcuts-modal-dialog {
      transform: scale(1);
    }

    .shortcuts-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.15rem 1.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      flex-shrink: 0;
    }

    .shortcuts-modal-title {
      margin: 0;
      font-size: 1.2rem;
      font-weight: 600;
      color: #ffffff;
      letter-spacing: 0.02em;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .shortcuts-modal-close {
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      color: rgba(255, 255, 255, 0.7);
      font-size: 1.5rem;
      line-height: 1;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
    }

    .shortcuts-modal-close:hover,
    .shortcuts-modal-close:focus-visible {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
      outline: none;
    }

    .shortcuts-modal-body {
      padding: 1.25rem 1.5rem;
      overflow-y: auto;
      flex: 1;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.25) transparent;
    }

    .shortcuts-modal-body::-webkit-scrollbar {
      width: 6px;
    }

    .shortcuts-modal-body::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.25);
      border-radius: 4px;
    }

    .shortcuts-modal-columns {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
    }

    @media (max-width: 640px) {
      .shortcuts-modal-columns {
        grid-template-columns: 1fr;
        gap: 1rem;
      }
    }

    .shortcuts-modal-col {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }

    .shortcuts-col-title {
      margin: 0 0 0.25rem 0;
      font-size: 0.85rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: rgba(255, 255, 255, 0.55);
    }

    .shortcuts-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }

    .shortcut-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.4rem 0.6rem;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 4px;
      transition: background 0.15s ease;
    }

    .shortcut-row:hover {
      background: rgba(255, 255, 255, 0.07);
    }

    .shortcut-desc {
      font-size: 0.88rem;
      color: rgba(255, 255, 255, 0.9);
      line-height: 1.3;
    }

    .shortcut-keys {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .shortcut-key {
      display: inline-block;
      padding: 2px 7px;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 4px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
      color: #ffffff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 0.8rem;
      font-weight: 600;
      line-height: 1.4;
      white-space: nowrap;
    }

    .shortcuts-modal-footer {
      padding: 0.85rem 1.5rem;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(0, 0, 0, 0.2);
      font-size: 0.82rem;
      color: rgba(255, 255, 255, 0.6);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }

    .shortcuts-modal-footer kbd {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 0.78rem;
      color: #ffffff;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Checks whether the active keyboard event target is an interactive input,
 * textarea, select, or editable element that should block hotkeys.
 *
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function isFocusInInput(event) {
  if (!event) return false;
  const target = event.target || (typeof document !== 'undefined' ? document.activeElement : null);
  if (!target) return false;

  const tagName = target.tagName ? target.tagName.toUpperCase() : '';
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }
  if (target.isContentEditable || target.getAttribute?.('contenteditable') === 'true' || target.getAttribute?.('contenteditable') === '') {
    return true;
  }
  if (typeof target.closest === 'function') {
    if (target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) {
      return true;
    }
  }
  return false;
}

/**
 * Formats a key combo string into an array of individual key labels.
 *
 * @param {string} keyString
 * @returns {string[]}
 */
export function formatKey(keyString) {
  if (typeof keyString !== 'string') return [];
  return keyString.split('+').map(k => k.trim());
}

/**
 * Initializes the Keyboard HUD OSD and Interactive Hotkeys Cheat Sheet.
 *
 * @param {HTMLVideoElement} videoElement - The player's HTML5 video element
 * @param {HTMLElement} containerElement - The parent container element (e.g. #player-container)
 * @param {Object} [options={}] - Additional configuration options
 * @param {number} [options.hudDuration=600] - Duration in ms before HUD pill begins fade-out
 * @param {Array<Object>} [options.shortcuts] - Custom shortcuts list override
 * @param {Array<number>} [options.speedRates] - Custom playback speed steps
 * @param {Array<number>} [options.boostLevels] - Custom audio boost percentage steps
 * @param {Object} [options.audioEnhancer] - Audio enhancer instance with setGain/getGain
 * @param {EventTarget} [options.eventTarget=window] - Event target for keydown listeners
 * @param {Function} [options.onToggleSubtitles] - Custom callback for toggling subtitles
 * @param {Function} [options.onToggleFullscreen] - Custom callback for toggling fullscreen
 * @param {Function} [options.onPlaybackRateChange] - Custom callback for playback speed changes
 * @param {Function} [options.onAudioBoostChange] - Custom callback for audio boost changes
 * @param {Function} [options.onVolumeChange] - Custom callback for volume changes
 * @param {Function} [options.onMuteToggle] - Custom callback for mute toggle
 * @param {Function} [options.onCheatSheetOpen] - Callback when cheat sheet opens
 * @param {Function} [options.onCheatSheetClose] - Callback when cheat sheet closes
 * @param {Function} [options.onEscape] - Custom callback when Escape key is pressed
 * @returns {{
 *   showHud: (iconName: string, labelText?: string) => void,
 *   openCheatSheet: () => void,
 *   closeCheatSheet: () => void,
 *   toggleCheatSheet: () => void,
 *   isOpen: () => boolean,
 *   destroy: () => void,
 *   hudElement: HTMLElement,
 *   modalElement: HTMLElement
 * }}
 */
export function initShortcutsHud(videoElement, containerElement, options = {}) {
  if (typeof document === 'undefined') {
    return {
      showHud: () => {},
      openCheatSheet: () => {},
      closeCheatSheet: () => {},
      toggleCheatSheet: () => {},
      isOpen: () => false,
      destroy: () => {},
      hudElement: null,
      modalElement: null
    };
  }

  injectStyles();

  const container = containerElement || (videoElement ? videoElement.parentElement : null) || document.body;

  if (container && container !== document.body && typeof window !== 'undefined' && window.getComputedStyle) {
    const compStyle = window.getComputedStyle(container);
    if (compStyle && compStyle.position === 'static') {
      container.style.position = 'relative';
    }
  }

  // --- 1. HUD Pill Element ---
  const hudPill = document.createElement('div');
  hudPill.className = 'player-hud-pill';
  hudPill.setAttribute('role', 'status');
  hudPill.setAttribute('aria-live', 'polite');
  hudPill.innerHTML = `
    <span class="player-hud-icon"></span>
    <span class="player-hud-label"></span>
  `;
  container.appendChild(hudPill);

  const iconEl = hudPill.querySelector('.player-hud-icon');
  const labelEl = hudPill.querySelector('.player-hud-label');

  let hudTimeout = null;
  const hudDuration = typeof options.hudDuration === 'number' ? options.hudDuration : 600;

  function showHud(iconName, labelText) {
    if (!hudPill) return;

    if (hudTimeout) {
      clearTimeout(hudTimeout);
      hudTimeout = null;
    }

    let iconText = iconName;
    let label = labelText;

    if (label === undefined || label === null) {
      if (typeof iconText === 'string') {
        label = iconText;
        iconText = '';
      } else {
        label = '';
      }
    }

    if (typeof iconText === 'string' && ICON_SYMBOL_MAP[iconText.toLowerCase()]) {
      iconText = ICON_SYMBOL_MAP[iconText.toLowerCase()];
    }

    if (iconEl) {
      iconEl.textContent = iconText || '';
      iconEl.style.display = iconText ? 'inline-flex' : 'none';
    }
    if (labelEl) {
      labelEl.textContent = label || '';
    }

    hudPill.classList.remove('is-visible');
    // Force DOM reflow to retrigger transition smoothly if already active
    void hudPill.offsetWidth;
    hudPill.classList.add('is-visible');

    hudTimeout = setTimeout(() => {
      hudPill.classList.remove('is-visible');
      hudTimeout = null;
    }, hudDuration);
  }

  // --- 2. Cheat Sheet Modal Element ---
  const modalContainer = document.createElement('div');
  modalContainer.className = 'shortcuts-modal-container';
  modalContainer.setAttribute('role', 'dialog');
  modalContainer.setAttribute('aria-modal', 'true');
  modalContainer.setAttribute('aria-labelledby', 'kura-shortcuts-title');

  const shortcutsList = Array.isArray(options.shortcuts) ? options.shortcuts : DEFAULT_SHORTCUTS;

  function renderShortcutsColumns(list) {
    return list.map(col => `
      <div class="shortcuts-modal-col">
        <h4 class="shortcuts-col-title">${escapeHtml(col.category)}</h4>
        <ul class="shortcuts-list">
          ${col.items.map(item => `
            <li class="shortcut-row">
              <span class="shortcut-desc">${escapeHtml(item.description)}</span>
              <span class="shortcut-keys">
                ${item.keys.map(k => `<kbd class="shortcut-key">${escapeHtml(k)}</kbd>`).join('')}
              </span>
            </li>
          `).join('')}
        </ul>
      </div>
    `).join('');
  }

  modalContainer.innerHTML = `
    <div class="shortcuts-modal-dialog">
      <div class="shortcuts-modal-header">
        <h3 class="shortcuts-modal-title" id="kura-shortcuts-title">
          <i data-lucide="keyboard"></i> Atajos de Teclado
        </h3>
        <button type="button" class="shortcuts-modal-close" aria-label="Cerrar">&times;</button>
      </div>
      <div class="shortcuts-modal-body">
        <div class="shortcuts-modal-columns">
          ${renderShortcutsColumns(shortcutsList)}
        </div>
      </div>
      <div class="shortcuts-modal-footer">
        <span>KuraStream Player Navigation</span>
        <span>Pulsa <kbd>?</kbd> o <kbd>Esc</kbd> para salir</span>
      </div>
    </div>
  `;

  container.appendChild(modalContainer);

  const closeBtn = modalContainer.querySelector('.shortcuts-modal-close');
  let previouslyFocusedEl = null;

  function isOpen() {
    return modalContainer.classList.contains('is-open');
  }

  function openCheatSheet() {
    if (typeof document !== 'undefined') {
      previouslyFocusedEl = document.activeElement;
    }
    modalContainer.classList.add('is-open');
    if (closeBtn) {
      closeBtn.focus();
    }
    if (typeof options.onCheatSheetOpen === 'function') {
      options.onCheatSheetOpen();
    }
  }

  function closeCheatSheet() {
    if (!isOpen()) return;
    modalContainer.classList.remove('is-open');
    if (previouslyFocusedEl && typeof previouslyFocusedEl.focus === 'function') {
      try {
        previouslyFocusedEl.focus();
      } catch {
        // Ignore focus restoration errors
      }
    }
    if (typeof options.onCheatSheetClose === 'function') {
      options.onCheatSheetClose();
    }
  }

  function toggleCheatSheet() {
    if (isOpen()) {
      closeCheatSheet();
    } else {
      openCheatSheet();
    }
  }

  closeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeCheatSheet();
  });

  modalContainer.addEventListener('click', (e) => {
    if (e.target === modalContainer) {
      closeCheatSheet();
    }
  });

  // --- 3. Hotkeys Setup & Listener ---
  const speedRates = Array.isArray(options.speedRates) && options.speedRates.length > 0
    ? options.speedRates
    : SPEED_RATES_DEFAULT;

  const boostLevels = Array.isArray(options.boostLevels) && options.boostLevels.length > 0
    ? options.boostLevels
    : BOOST_LEVELS_DEFAULT;

  let currentBoostIndex = 0;
  if (options.audioEnhancer && typeof options.audioEnhancer.getGain === 'function') {
    try {
      const curMultiplier = options.audioEnhancer.getGain();
      const curLevel = Math.round(curMultiplier * 100);
      const foundIdx = boostLevels.indexOf(curLevel);
      if (foundIdx !== -1) {
        currentBoostIndex = foundIdx;
      }
    } catch {
      // Ignore audioEnhancer sync errors
    }
  }

  function handleKeyDown(event) {
    if (!event) return;

    // Escape closes cheat sheet or triggers onEscape
    if (event.key === 'Escape') {
      if (isOpen()) {
        event.preventDefault();
        closeCheatSheet();
        return;
      }
      if (typeof options.onEscape === 'function') {
        options.onEscape(event);
      }
      return;
    }

    // Ignore hotkeys when active focus is inside input, textarea, select, or contentEditable
    if (isFocusInInput(event)) {
      return;
    }

    // Guard modifier combinations (Ctrl, Alt, Meta)
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }

    const key = event.key;
    const code = event.code;

    // 1. Play / Pause: Space or 'k' / 'K'
    if (key === ' ' || code === 'Space' || key === 'k' || key === 'K') {
      event.preventDefault();
      if (videoElement) {
        if (videoElement.paused || videoElement.ended) {
          const playPromise = videoElement.play();
          if (playPromise !== undefined && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
          }
          showHud('PLAY', 'Reproducir');
        } else {
          videoElement.pause();
          showHud('PAUSE', 'Pausa');
        }
      } else {
        showHud('PLAY', 'Reproducir');
      }
      return;
    }

    // 2. Seek -10s: 'j' / 'J' or ArrowLeft
    if (key === 'j' || key === 'J' || key === 'ArrowLeft') {
      event.preventDefault();
      if (videoElement) {
        const cur = Number(videoElement.currentTime) || 0;
        videoElement.currentTime = Math.max(0, cur - 10);
      }
      showHud('⏪', '-10s');
      return;
    }

    // 3. Seek +10s: 'l' / 'L' or ArrowRight
    if (key === 'l' || key === 'L' || key === 'ArrowRight') {
      event.preventDefault();
      if (videoElement) {
        const cur = Number(videoElement.currentTime) || 0;
        const dur = Number(videoElement.duration);
        const max = !isNaN(dur) && dur > 0 ? dur : Infinity;
        videoElement.currentTime = Math.min(max, cur + 10);
      }
      showHud('⏩', '+10s');
      return;
    }

    // 4. Volume Up: ArrowUp
    if (key === 'ArrowUp') {
      event.preventDefault();
      if (videoElement) {
        if (videoElement.muted) {
          videoElement.muted = false;
        }
        const cur = Number(videoElement.volume) || 0;
        const next = Math.min(1, Math.round((cur + 0.05) * 100) / 100);
        videoElement.volume = next;
        const pct = Math.round(next * 100);
        showHud(pct > 0 ? 'volume-high' : 'volume-mute', `${pct}%`);
        if (typeof options.onVolumeChange === 'function') {
          options.onVolumeChange(next, false);
        }
      }
      return;
    }

    // 5. Volume Down: ArrowDown
    if (key === 'ArrowDown') {
      event.preventDefault();
      if (videoElement) {
        const cur = Number(videoElement.volume) || 0;
        const next = Math.max(0, Math.round((cur - 0.05) * 100) / 100);
        videoElement.volume = next;
        const pct = Math.round(next * 100);
        if (pct === 0) {
          videoElement.muted = true;
          showHud('volume-mute', '0%');
        } else {
          showHud(pct < 50 ? 'volume-low' : 'volume-high', `${pct}%`);
        }
        if (typeof options.onVolumeChange === 'function') {
          options.onVolumeChange(next, videoElement.muted);
        }
      }
      return;
    }

    // 6. Mute Toggle: 'm' / 'M'
    if (key === 'm' || key === 'M') {
      event.preventDefault();
      if (videoElement) {
        videoElement.muted = !videoElement.muted;
        const isMuted = videoElement.muted || videoElement.volume === 0;
        showHud(isMuted ? 'volume-mute' : 'volume-high', isMuted ? 'Silenciado' : 'Audio activo');
        if (typeof options.onMuteToggle === 'function') {
          options.onMuteToggle(videoElement.muted);
        }
      }
      return;
    }

    // 7. Fullscreen Toggle: 'f' / 'F'
    if (key === 'f' || key === 'F') {
      event.preventDefault();
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
      if (fsEl) {
        const exitFn = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
        if (exitFn) exitFn.call(document);
      } else {
        const target = container || videoElement;
        const reqFn = target.requestFullscreen || target.webkitRequestFullscreen || target.mozRequestFullScreen || target.msRequestFullscreen;
        if (reqFn) reqFn.call(target);
      }
      showHud('fullscreen', 'Pantalla completa');
      if (typeof options.onToggleFullscreen === 'function') {
        options.onToggleFullscreen();
      }
      return;
    }

    // 8. Subtitles Toggle: 'c' / 'C'
    if (key === 'c' || key === 'C') {
      event.preventDefault();
      if (typeof options.onToggleSubtitles === 'function') {
        options.onToggleSubtitles();
      } else if (videoElement && videoElement.textTracks && videoElement.textTracks.length > 0) {
        let hasActive = false;
        for (let i = 0; i < videoElement.textTracks.length; i++) {
          if (videoElement.textTracks[i].mode === 'showing') {
            hasActive = true;
            videoElement.textTracks[i].mode = 'disabled';
          }
        }
        if (!hasActive && videoElement.textTracks[0]) {
          videoElement.textTracks[0].mode = 'showing';
        }
      }
      showHud('subtitles', 'Subtítulos');
      return;
    }

    // 9. Speed Cycle: 's' / 'S' or '>' / '<'
    const isSpeedForward = key === 's' || key === 'S' || key === '>' || (event.shiftKey && (key === '.' || code === 'Period'));
    const isSpeedBackward = key === '<' || (event.shiftKey && (key === ',' || code === 'Comma'));

    if (isSpeedForward || isSpeedBackward) {
      event.preventDefault();
      const curRate = (videoElement && videoElement.playbackRate) ? videoElement.playbackRate : 1;
      let closestIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < speedRates.length; i++) {
        const diff = Math.abs(speedRates[i] - curRate);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }

      let nextIdx;
      if (key === 's' || key === 'S') {
        nextIdx = (closestIdx + 1) % speedRates.length;
      } else if (isSpeedForward) {
        nextIdx = Math.min(speedRates.length - 1, closestIdx + 1);
      } else {
        nextIdx = Math.max(0, closestIdx - 1);
      }

      const newRate = speedRates[nextIdx];
      if (videoElement) {
        videoElement.playbackRate = newRate;
      }
      if (typeof options.onPlaybackRateChange === 'function') {
        options.onPlaybackRateChange(newRate);
      }
      showHud('speed', `${newRate}x`);
      return;
    }

    // 10. Audio Boost Cycle: 'b' / 'B'
    if (key === 'b' || key === 'B') {
      event.preventDefault();
      currentBoostIndex = (currentBoostIndex + 1) % boostLevels.length;
      const boostVal = boostLevels[currentBoostIndex];
      const multiplier = boostVal / 100;

      if (options.audioEnhancer && typeof options.audioEnhancer.setGain === 'function') {
        options.audioEnhancer.setGain(multiplier);
      }
      if (typeof options.onAudioBoostChange === 'function') {
        options.onAudioBoostChange(boostVal, multiplier);
      }
      showHud('boost', `Boost ${boostVal}%`);
      return;
    }

    // 11. Cheat Sheet Modal Toggle: '?' or 'h' / 'H'
    if (key === '?' || (event.shiftKey && (key === '/' || code === 'Slash')) || key === 'h' || key === 'H') {
      event.preventDefault();
      toggleCheatSheet();
      return;
    }
  }

  const eventTarget = options.eventTarget || window;
  eventTarget.addEventListener('keydown', handleKeyDown);

  // --- 4. Destroy & Teardown ---
  function destroy() {
    eventTarget.removeEventListener('keydown', handleKeyDown);
    if (hudTimeout) {
      clearTimeout(hudTimeout);
      hudTimeout = null;
    }
    if (hudPill && hudPill.parentElement) {
      hudPill.parentElement.removeChild(hudPill);
    }
    if (modalContainer && modalContainer.parentElement) {
      modalContainer.parentElement.removeChild(modalContainer);
    }
  }

  return {
    showHud,
    openCheatSheet,
    closeCheatSheet,
    toggleCheatSheet,
    isOpen,
    destroy,
    hudElement: hudPill,
    modalElement: modalContainer
  };
}

export default initShortcutsHud;
