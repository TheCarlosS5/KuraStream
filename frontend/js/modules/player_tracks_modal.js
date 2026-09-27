/**
 * Netflix-Style 2-Column Audio & Subtitles Modal for KuraStream
 * Standalone ES6 module for audio and subtitle selection with frosted glass styling.
 */

const STYLE_ID = 'kura-tracks-modal-styles';

const LANGUAGE_NAMES = {
  spa: 'Español',
  es: 'Español',
  lat: 'Español (Latino)',
  eng: 'Inglés',
  en: 'Inglés',
  jpn: 'Japonés',
  ja: 'Japonés',
  fra: 'Francés',
  fr: 'Francés',
  deu: 'Alemán',
  ger: 'Alemán',
  de: 'Alemán',
  ita: 'Italiano',
  it: 'Italiano',
  por: 'Portugués',
  pt: 'Portugués',
  kor: 'Coreano',
  ko: 'Coreano',
  zho: 'Chino',
  chi: 'Chino',
  zh: 'Chino',
  rus: 'Ruso',
  ru: 'Ruso',
};

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getTrackId(track, index) {
  if (track && typeof track === 'object') {
    if (track.track_number !== undefined && track.track_number !== null) {
      return track.track_number;
    }
    if (track.index !== undefined && track.index !== null) {
      return track.index;
    }
    if (track.id !== undefined && track.id !== null) {
      return track.id;
    }
  }
  return index;
}

function formatTrackTitle(track, index, fallbackPrefix = 'Pista') {
  if (track === null || track === undefined) {
    return `${fallbackPrefix} ${index + 1}`;
  }
  if (typeof track === 'string') {
    return track;
  }
  if (track.label) return track.label;
  if (track.name) return track.name;

  const parts = [];
  if (track.title) {
    parts.push(track.title);
  }

  const langCode = (track.language || '').toLowerCase().trim();
  const langName = LANGUAGE_NAMES[langCode] || (langCode ? langCode.toUpperCase() : '');

  if (langName && (!track.title || !track.title.toLowerCase().includes(langName.toLowerCase()))) {
    parts.push(track.title ? `(${langName})` : langName);
  }

  if (track.codec) {
    parts.push(track.codec.toUpperCase());
  }
  if (track.channels === 2) {
    parts.push('Estéreo');
  } else if (track.channels) {
    parts.push(`${track.channels}ch`);
  }

  if (parts.length > 0) {
    return parts.join(' ');
  }

  return `${fallbackPrefix} ${index + 1}`;
}

function injectModalStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .tracks-modal-container {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 10000;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .tracks-modal-container.is-open {
      display: flex;
      opacity: 1;
    }
    .tracks-modal-dialog {
      position: relative;
      width: 90%;
      max-width: 640px;
      max-height: 85vh;
      background: #0b0f14;
      background: rgba(11, 15, 20, 0.95);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 4px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8);
      color: #ffffff;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transform: scale(0.95);
      transition: transform 0.2s ease;
    }
    .tracks-modal-container.is-open .tracks-modal-dialog {
      transform: scale(1);
    }
    .tracks-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    .tracks-modal-header h3 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
      color: #ffffff;
      letter-spacing: 0.02em;
    }
    .tracks-modal-close {
      background: transparent;
      border: none;
      color: #a0a0a0;
      font-size: 1.75rem;
      line-height: 1;
      cursor: pointer;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      transition: color 0.15s, background-color 0.15s;
    }
    .tracks-modal-close:hover,
    .tracks-modal-close:focus-visible {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.1);
      outline: none;
    }
    .tracks-modal-columns {
      display: flex;
      padding: 1.5rem;
      gap: 2rem;
      overflow-y: auto;
      max-height: calc(85vh - 75px);
    }
    @media (max-width: 600px) {
      .tracks-modal-columns {
        flex-direction: column;
        gap: 1.25rem;
      }
    }
    .tracks-modal-col {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .tracks-modal-col h4 {
      margin: 0 0 1rem 0;
      font-size: 0.95rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #8c9096;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 0.5rem;
    }
    .tracks-list {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      overflow-y: auto;
      max-height: 50vh;
      padding-right: 0.25rem;
    }
    .tracks-list::-webkit-scrollbar {
      width: 5px;
    }
    .tracks-list::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 4px;
    }
    .track-item {
      display: flex;
      align-items: center;
      width: 100%;
      padding: 0.65rem 0.85rem;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      color: #cfd4dc;
      font-size: 0.95rem;
      text-align: left;
      cursor: pointer;
      transition: background-color 0.15s, color 0.15s, border-color 0.15s;
    }
    .track-item:hover {
      background: rgba(255, 255, 255, 0.06);
      color: #ffffff;
    }
    .track-item:focus-visible {
      outline: 2px solid rgba(255, 255, 255, 0.5);
      outline-offset: 1px;
    }
    .track-item.is-active {
      background: rgba(255, 255, 255, 0.12);
      color: #ffffff;
      font-weight: 600;
      border-color: rgba(255, 255, 255, 0.15);
    }
    .track-check {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.25rem;
      margin-right: 0.75rem;
      font-size: 1.1rem;
      line-height: 1;
      color: #ffffff;
      flex-shrink: 0;
      visibility: hidden;
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .track-item.is-active .track-check {
      visibility: visible;
      opacity: 1;
    }
    .track-title {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Initializes the 2-column Netflix-style Audio & Subtitles Modal.
 * @param {Object} options Configuration options
 * @returns {Object} Controller instance with modal methods
 */
export function initTracksModal(options = {}) {
  injectModalStyles();

  const state = {
    audioTracks: Array.isArray(options.audioTracks) ? [...options.audioTracks] : [],
    subtitleTracks: Array.isArray(options.subtitleTracks) ? [...options.subtitleTracks] : [],
    currentAudioIndex: options.currentAudioIndex !== undefined ? options.currentAudioIndex : 0,
    currentSubtitleIndex: options.currentSubtitleIndex !== undefined ? options.currentSubtitleIndex : -1,
  };

  let isOpenState = false;

  // Resolve container
  let containerParent = options.container;
  if (!containerParent) {
    containerParent = document.querySelector('#player-container') || document.body;
  } else if (typeof containerParent === 'string') {
    containerParent = document.querySelector(containerParent) || document.body;
  }

  // Create Modal DOM Elements
  const containerEl = document.createElement('div');
  containerEl.className = 'tracks-modal-container';
  containerEl.setAttribute('role', 'dialog');
  containerEl.setAttribute('aria-modal', 'true');
  containerEl.setAttribute('aria-label', 'Audio y Subtítulos');
  containerEl.style.display = 'none';

  const dialogEl = document.createElement('div');
  dialogEl.className = 'tracks-modal-dialog';

  // Header
  const headerEl = document.createElement('div');
  headerEl.className = 'tracks-modal-header';

  const titleEl = document.createElement('h3');
  titleEl.className = 'tracks-modal-title';
  titleEl.textContent = 'Audio y Subtítulos';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'tracks-modal-close';
  closeBtn.setAttribute('aria-label', 'Cerrar');
  closeBtn.innerHTML = '&times;';

  headerEl.appendChild(titleEl);
  headerEl.appendChild(closeBtn);
  dialogEl.appendChild(headerEl);

  // Columns Wrapper
  const columnsEl = document.createElement('div');
  columnsEl.className = 'tracks-modal-columns';

  // Audio Column
  const audioCol = document.createElement('div');
  audioCol.className = 'tracks-modal-col tracks-modal-col-audio';
  const audioHeader = document.createElement('h4');
  audioHeader.textContent = 'Audio';
  const audioList = document.createElement('div');
  audioList.className = 'tracks-list';
  audioList.setAttribute('role', 'radiogroup');
  audioList.setAttribute('aria-label', 'Pistas de audio');
  audioCol.appendChild(audioHeader);
  audioCol.appendChild(audioList);

  // Subtitles Column
  const subCol = document.createElement('div');
  subCol.className = 'tracks-modal-col tracks-modal-col-subtitles';
  const subHeader = document.createElement('h4');
  subHeader.textContent = 'Subtítulos';
  const subList = document.createElement('div');
  subList.className = 'tracks-list';
  subList.setAttribute('role', 'radiogroup');
  subList.setAttribute('aria-label', 'Pistas de subtítulos');
  subCol.appendChild(subHeader);
  subCol.appendChild(subList);

  columnsEl.appendChild(audioCol);
  columnsEl.appendChild(subCol);
  dialogEl.appendChild(columnsEl);
  containerEl.appendChild(dialogEl);

  if (containerParent) {
    containerParent.appendChild(containerEl);
  }

  const CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

  // Render Audio List
  function renderAudioList() {
    if (state.audioTracks.length === 0) {
      audioList.innerHTML = `
        <button type="button" class="track-item is-active" data-type="audio" data-index="0" data-track-id="0" role="radio" aria-checked="true">
          <span class="track-check">${CHECK_SVG}</span>
          <span class="track-title">Audio por defecto</span>
        </button>
      `;
      return;
    }

    const itemsHtml = state.audioTracks.map((track, idx) => {
      const trackId = getTrackId(track, idx);
      const isActive = String(trackId) === String(state.currentAudioIndex) || String(idx) === String(state.currentAudioIndex);
      const title = formatTrackTitle(track, idx, 'Audio');
      return `
        <button type="button" class="track-item${isActive ? ' is-active' : ''}" data-type="audio" data-index="${idx}" data-track-id="${trackId}" role="radio" aria-checked="${isActive ? 'true' : 'false'}">
          <span class="track-check" style="${isActive ? '' : 'visibility: hidden; opacity: 0;'}">${CHECK_SVG}</span>
          <span class="track-title">${escapeHtml(title)}</span>
        </button>
      `;
    }).join('');

    audioList.innerHTML = itemsHtml;
  }

  // Render Subtitles List
  function renderSubtitlesList() {
    const isOff = state.currentSubtitleIndex === -1 ||
      state.currentSubtitleIndex === '-1' ||
      state.currentSubtitleIndex === 'off' ||
      state.currentSubtitleIndex === null ||
      state.currentSubtitleIndex === undefined;

    const offItemHtml = `
      <button type="button" class="track-item${isOff ? ' is-active' : ''}" data-type="subtitle" data-index="-1" data-track-id="-1" role="radio" aria-checked="${isOff ? 'true' : 'false'}">
        <span class="track-check" style="${isOff ? '' : 'visibility: hidden; opacity: 0;'}">${CHECK_SVG}</span>
        <span class="track-title">Desactivado</span>
      </button>
    `;

    const tracksHtml = state.subtitleTracks.map((track, idx) => {
      const trackId = getTrackId(track, idx);
      const isBitmap = Boolean(track.is_bitmap) || ['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle'].includes((track.codec || '').toLowerCase());
      const isActive = !isOff && !isBitmap && (String(trackId) === String(state.currentSubtitleIndex) || String(idx) === String(state.currentSubtitleIndex));
      const title = formatTrackTitle(track, idx, 'Subtítulo') + (isBitmap ? ' (No compatible)' : '');
      const disabledAttr = isBitmap ? 'disabled style="opacity: 0.45; cursor: not-allowed;" title="Subtítulo en formato bitmap/imagen incompatible con el reproductor de texto"' : '';
      return `
        <button type="button" class="track-item${isActive ? ' is-active' : ''}" data-type="subtitle" data-index="${idx}" data-track-id="${trackId}" ${disabledAttr} role="radio" aria-checked="${isActive ? 'true' : 'false'}">
          <span class="track-check" style="${isActive ? '' : 'visibility: hidden; opacity: 0;'}">${CHECK_SVG}</span>
          <span class="track-title">${escapeHtml(title)}</span>
        </button>
      `;
    }).join('');

    subList.innerHTML = offItemHtml + tracksHtml;
  }

  // Initial Render
  renderAudioList();
  renderSubtitlesList();

  // Selection Handlers
  function selectAudio(trackId, track) {
    state.currentAudioIndex = trackId;
    audioList.querySelectorAll('.track-item').forEach(btn => {
      const btnId = btn.getAttribute('data-track-id');
      const isActive = String(btnId) === String(trackId);
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
      const check = btn.querySelector('.track-check');
      if (check) {
        check.style.visibility = isActive ? 'visible' : 'hidden';
        check.style.opacity = isActive ? '1' : '0';
      }
    });

    if (typeof options.onSelectAudio === 'function') {
      options.onSelectAudio(trackId, track);
    } else if (typeof options.onAudioChange === 'function') {
      options.onAudioChange(trackId, track);
    }
  }

  function selectSubtitle(trackId, track) {
    state.currentSubtitleIndex = trackId;
    subList.querySelectorAll('.track-item').forEach(btn => {
      const btnId = btn.getAttribute('data-track-id');
      const isActive = String(btnId) === String(trackId);
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
      const check = btn.querySelector('.track-check');
      if (check) {
        check.style.visibility = isActive ? 'visible' : 'hidden';
        check.style.opacity = isActive ? '1' : '0';
      }
    });

    if (typeof options.onSelectSubtitle === 'function') {
      options.onSelectSubtitle(trackId, track);
    } else if (typeof options.onSubtitleChange === 'function') {
      options.onSubtitleChange(trackId, track);
    }
  }

  // Event Delegation for Track Items
  columnsEl.addEventListener('click', (e) => {
    const item = e.target.closest('.track-item');
    if (!item) return;

    const type = item.getAttribute('data-type');
    const trackIdAttr = item.getAttribute('data-track-id');
    const indexAttr = item.getAttribute('data-index');

    if (type === 'audio') {
      const idx = parseInt(indexAttr, 10);
      const track = state.audioTracks[idx] || null;
      const trackId = isNaN(parseInt(trackIdAttr, 10)) ? trackIdAttr : parseInt(trackIdAttr, 10);
      selectAudio(trackId, track);
    } else if (type === 'subtitle') {
      const idx = parseInt(indexAttr, 10);
      if (idx === -1) {
        selectSubtitle(-1, null);
      } else {
        const track = state.subtitleTracks[idx] || null;
        const isBitmap = track && (track.is_bitmap || ['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle'].includes((track.codec || '').toLowerCase()));
        if (isBitmap) return;
        const trackId = isNaN(parseInt(trackIdAttr, 10)) ? trackIdAttr : parseInt(trackIdAttr, 10);
        selectSubtitle(trackId, track);
      }
    }
  });

  function close() {
    if (!isOpenState) return;
    isOpenState = false;
    containerEl.classList.remove('is-open');
    containerEl.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', handleKeyDown);

    setTimeout(() => {
      if (!isOpenState && containerEl) {
        containerEl.style.display = 'none';
      }
    }, 200);

    if (typeof options.onClose === 'function') {
      options.onClose();
    }
  }

  // Keyboard navigation
  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const activeEl = document.activeElement;
      if (activeEl && activeEl.classList.contains('track-item')) {
        const list = activeEl.closest('.tracks-list');
        if (list) {
          const items = Array.from(list.querySelectorAll('.track-item'));
          const curIdx = items.indexOf(activeEl);
          if (curIdx !== -1) {
            e.preventDefault();
            const nextIdx = e.key === 'ArrowDown'
              ? (curIdx + 1) % items.length
              : (curIdx - 1 + items.length) % items.length;
            items[nextIdx].focus();
          }
        }
      }
    }
  }

  // Backdrop click
  function handleBackdropClick(e) {
    if (e.target === containerEl) {
      close();
    }
  }

  containerEl.addEventListener('click', handleBackdropClick);
  closeBtn.addEventListener('click', () => close());

  function open() {
    if (isOpenState) return;
    isOpenState = true;
    containerEl.style.display = 'flex';
    void containerEl.offsetWidth;
    containerEl.classList.add('is-open');
    containerEl.setAttribute('aria-hidden', 'false');

    document.addEventListener('keydown', handleKeyDown);

    const firstActive = containerEl.querySelector('.track-item.is-active') || closeBtn;
    if (firstActive && typeof firstActive.focus === 'function') {
      firstActive.focus();
    }
  }

  function toggle() {
    if (isOpenState) {
      close();
    } else {
      open();
    }
  }

  function isOpen() {
    return isOpenState;
  }

  function updateTracks(data = {}) {
    if (data.audioTracks !== undefined) {
      state.audioTracks = Array.isArray(data.audioTracks) ? [...data.audioTracks] : [];
    }
    if (data.subtitleTracks !== undefined) {
      state.subtitleTracks = Array.isArray(data.subtitleTracks) ? [...data.subtitleTracks] : [];
    }
    if (data.currentAudioIndex !== undefined) {
      state.currentAudioIndex = data.currentAudioIndex;
    }
    if (data.currentSubtitleIndex !== undefined) {
      state.currentSubtitleIndex = data.currentSubtitleIndex;
    }
    if (typeof data.onSelectAudio === 'function') {
      options.onSelectAudio = data.onSelectAudio;
    } else if (typeof data.onAudioChange === 'function') {
      options.onSelectAudio = data.onAudioChange;
    }
    if (typeof data.onSelectSubtitle === 'function') {
      options.onSelectSubtitle = data.onSelectSubtitle;
    } else if (typeof data.onSubtitleChange === 'function') {
      options.onSelectSubtitle = data.onSubtitleChange;
    }

    renderAudioList();
    renderSubtitlesList();
  }

  function destroy() {
    close();
    document.removeEventListener('keydown', handleKeyDown);
    containerEl.removeEventListener('click', handleBackdropClick);
    if (containerEl && containerEl.parentNode) {
      containerEl.parentNode.removeChild(containerEl);
    }
  }

  return {
    open,
    close,
    toggle,
    updateTracks,
    isOpen,
    destroy,
  };
}

let activeSingletonModal = null;

/**
 * Convenient helper to open or update the modal.
 * @param {Object} options
 * @returns {Object} Controller instance
 */
export function openTracksModal(options = {}) {
  if (!activeSingletonModal) {
    activeSingletonModal = initTracksModal(options);
  } else if (options.audioTracks || options.subtitleTracks || options.currentAudioIndex !== undefined || options.currentSubtitleIndex !== undefined) {
    activeSingletonModal.updateTracks(options);
  }
  activeSingletonModal.open();
  return activeSingletonModal;
}

export default initTracksModal;
