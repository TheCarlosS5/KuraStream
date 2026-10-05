/**
 * Audio & subtitles panel of the web player (two columns, like the big streaming apps).
 * Receives already-labelled tracks (see js/player/tracks.js#labelTracks); Escape and focus
 * handling belong to the player so this panel never steals its keyboard shortcuts.
 */
import { escapeHtml } from '../core/ui.js';
import { iconSvg } from '../core/icons.js';

let panel = null;
let state = null;

function itemHtml({ type, number, label, detail, active, disabled, title }) {
  return `
    <button type="button" class="track-item${active ? ' is-active' : ''}" data-type="${type}" data-track-id="${number}"
      role="radio" aria-checked="${active ? 'true' : 'false'}"${disabled ? ` disabled title="${escapeHtml(title || '')}"` : ''}>
      <span class="track-check">${iconSvg('check', { size: 18, strokeWidth: 2.5 })}</span>
      <span class="track-text">
        <span class="track-title">${escapeHtml(label)}</span>
        ${detail ? `<span class="track-detail">${escapeHtml(detail)}</span>` : ''}
      </span>
    </button>`;
}

function render() {
  const audioList = panel.querySelector('[data-list="audio"]');
  const subList = panel.querySelector('[data-list="subtitle"]');

  audioList.innerHTML = state.audioTracks.length
    ? state.audioTracks.map(track => itemHtml({
      type: 'audio',
      number: track.number,
      label: track.label,
      detail: track.detail,
      active: track.number === state.currentAudio
    })).join('')
    : itemHtml({ type: 'audio', number: 0, label: 'Predeterminado', active: true });

  subList.innerHTML = itemHtml({ type: 'subtitle', number: -1, label: 'Desactivado', active: state.currentSubtitle === -1 }) +
    state.subtitleTracks.map(track => itemHtml({
      type: 'subtitle',
      number: track.number,
      label: track.label,
      detail: track.bitmap ? 'Formato de imagen no compatible' : track.detail,
      active: !track.bitmap && track.number === state.currentSubtitle,
      disabled: track.bitmap,
      title: 'Subtítulos en imagen (PGS/VobSub): el reproductor web solo muestra subtítulos de texto'
    })).join('');
}

function build(container) {
  panel = document.createElement('div');
  panel.className = 'tracks-modal-container';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Audio y subtítulos');
  panel.hidden = true;
  panel.innerHTML = `
    <div class="tracks-modal-dialog">
      <div class="tracks-modal-header">
        <h3 class="tracks-modal-title">Audio y subtítulos</h3>
        <button type="button" class="tracks-modal-close" aria-label="Cerrar">${iconSvg('x', { size: 20 })}</button>
      </div>
      <div class="tracks-modal-columns">
        <section class="tracks-modal-col">
          <h4>${iconSvg('audio-lines', { size: 16 })} Audio</h4>
          <div class="tracks-list" role="radiogroup" aria-label="Pistas de audio" data-list="audio"></div>
        </section>
        <section class="tracks-modal-col">
          <h4>${iconSvg('captions', { size: 16 })} Subtítulos</h4>
          <div class="tracks-list" role="radiogroup" aria-label="Pistas de subtítulos" data-list="subtitle"></div>
        </section>
      </div>
    </div>`;
  container.appendChild(panel);

  panel.addEventListener('click', event => {
    event.stopPropagation();
    if (event.target === panel || event.target.closest('.tracks-modal-close')) {
      closeTracksModal();
      return;
    }
    const item = event.target.closest('.track-item');
    if (!item || item.disabled) return;
    const number = Number(item.dataset.trackId);
    if (item.dataset.type === 'audio') {
      if (number === state.currentAudio) return;
      state.currentAudio = number;
      render();
      state.onSelectAudio(number);
    } else {
      if (number === state.currentSubtitle) return;
      state.currentSubtitle = number;
      render();
      state.onSelectSubtitle(number);
    }
  });

  panel.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const list = event.target.closest('.tracks-list');
    if (!list) return;
    const items = [...list.querySelectorAll('.track-item:not([disabled])')];
    const index = items.indexOf(event.target.closest('.track-item'));
    if (index === -1) return;
    event.preventDefault();
    const next = items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    next.focus();
  });
}

export function openTracksModal(options) {
  const container = options.container || document.getElementById('player-container') || document.body;
  if (!panel || !container.contains(panel)) {
    if (panel) panel.remove();
    build(container);
  }
  state = {
    audioTracks: options.audioTracks || [],
    subtitleTracks: options.subtitleTracks || [],
    currentAudio: options.currentAudio ?? 0,
    currentSubtitle: options.currentSubtitle ?? -1,
    onSelectAudio: options.onSelectAudio || (() => {}),
    onSelectSubtitle: options.onSelectSubtitle || (() => {}),
    onClose: options.onClose || (() => {})
  };
  render();
  panel.hidden = false;
  requestAnimationFrame(() => {
    panel.classList.add('is-open');
    const active = panel.querySelector('.track-item.is-active') || panel.querySelector('.tracks-modal-close');
    if (active) active.focus({ preventScroll: true });
  });
}

export function closeTracksModal() {
  if (!panel || panel.hidden) return;
  panel.classList.remove('is-open');
  panel.hidden = true;
  if (state && typeof state.onClose === 'function') state.onClose();
}

export function isTracksModalOpen() {
  return Boolean(panel && !panel.hidden);
}
