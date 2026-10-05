/**
 * KuraStream web player.
 *
 * One playback session at a time (initPlayer / destroyPlayer). Two stream modes:
 *  - direct: MP4/WebM with H.264 and the default audio track, served with HTTP ranges, so the
 *    <video> element seeks natively and its currentTime is the episode time;
 *  - remux: everything else goes through ffmpeg (/api/stream/:id?audio=&start=). That stream starts
 *    at `start` and cannot be range-seeked, so the episode time is offset + video.currentTime and a
 *    seek outside the buffered window restarts the stream at the new position.
 */
import { partyManager } from './js/modules/party.js';
import { initScrubPreview } from './js/modules/player_scrub_preview.js';
import { openTracksModal, closeTracksModal, isTracksModalOpen } from './js/modules/player_tracks_modal.js';
import { initAudioEnhancer } from './js/modules/player_audio_enhancer.js';
import { renderQRCodeToElement } from './js/features/player/qr_generator.js';
import { AuthManager } from './js/core/auth.js';
import { escapeHtml } from './js/core/ui.js';
import { iconSvg, setIcon, hydrateIcons } from './js/core/icons.js';
import {
  parseTrackList, trackNumber, detectTrackLang, matchesLanguage, labelTracks,
  chooseAudioTrack, chooseSubtitleTrack, isBitmapSubtitle,
  readLanguagePrefs
} from './js/player/tracks.js';

export { detectTrackLang, matchesLanguage };

const SEEK_STEP = 10;
const CONTROLS_HIDE_MS = 3000;
const PROGRESS_SAVE_MS = 10000;
const REMUX_SEEK_DEBOUNCE_MS = 350;
const STALL_RELOAD_MS = 20000;
const MAX_STREAM_RETRIES = 3;
const UP_NEXT_COUNTDOWN = 10;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const BOOSTS = [100, 125, 150, 175, 200];
const DIRECT_CONTAINERS = ['mp4', 'webm', 'm4v'];
// The stream endpoint only serves H.264 without ffmpeg; anything else is remuxed/transcoded.
const DIRECT_CODECS = ['', 'h264', 'avc1', 'avc'];

// -------------------------------------------------------------------------------------------
// Pure helpers (exported for the router, the watch-party modal and tests)
// -------------------------------------------------------------------------------------------

/** Show id of an episode id ("Show_S1_E2" -> "Show", "Film_movie" -> "Film"). */
export function getShowIdFromEpisodeId(epId) {
  if (!epId) return '';
  return String(epId).replace(/_movie$/i, '').replace(/_S\d+_E\d+$/i, '');
}

export function showApiUrl(showId) {
  return `/api/shows/${encodeURIComponent(showId)}`;
}

function playerHash(episodeId) {
  return `#/player/${encodeURIComponent(episodeId)}`;
}

function showHash(episodeId) {
  const showId = getShowIdFromEpisodeId(episodeId);
  return showId ? `#/show/${encodeURIComponent(showId)}` : '#/';
}

/** Whether the server will answer this episode/audio pick with a plain ranged file. */
export function isDirectPlayable(ep, audioTrackNum = 0) {
  if (!ep) return false;
  const path = String(ep.filepath || ep.filename || '');
  const ext = String(ep.container || (path.includes('.') ? path.split('.').pop() : '')).toLowerCase();
  if (!DIRECT_CONTAINERS.includes(ext)) return false;
  if (!DIRECT_CODECS.includes(String(ep.video_codec || '').toLowerCase())) return false;
  const audioTracks = parseTrackList(ep.audio_tracks);
  return Number(audioTrackNum) <= 0 || audioTracks.length <= 1;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatChapterTime(seconds) {
  if (!Number.isFinite(Number(seconds))) return '00:00';
  const total = Math.floor(Number(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Playback order of a show: regular seasons first (S1E1, S1E2 ... S2E1), specials (season 0)
 * after them. "Next episode" never rolls from the last regular episode into the specials.
 */
export function orderEpisodes(episodes) {
  const num = (v, fallback) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : fallback);
  return [...(episodes || [])].sort((a, b) => {
    const sa = num(a.season_number, 1);
    const sb = num(b.season_number, 1);
    if ((sa === 0) !== (sb === 0)) return sa === 0 ? 1 : -1;
    if (sa !== sb) return sa - sb;
    return num(a.episode_number, 0) - num(b.episode_number, 0);
  });
}

export function findAdjacentEpisodes(episodes, episodeId) {
  const ordered = orderEpisodes(episodes);
  const index = ordered.findIndex(ep => ep.id === episodeId);
  if (index === -1) return { previous: null, next: null };
  const current = ordered[index];
  const isSpecial = parseInt(current.season_number, 10) === 0;
  const sameGroup = ep => ep && (parseInt(ep.season_number, 10) === 0) === isSpecial;
  const next = sameGroup(ordered[index + 1]) ? ordered[index + 1] : null;
  const previous = sameGroup(ordered[index - 1]) ? ordered[index - 1] : null;
  return { previous, next };
}

function episodeLabel(ep) {
  if (!ep) return '';
  const season = parseInt(ep.season_number, 10);
  const number = ep.episode_number;
  if (season === 0) return `Especial ${number}`;
  return season ? `T${season} · E${number}` : `Episodio ${number}`;
}

function readPref(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* storage blocked */ }
}

function prefersAutoSkipIntro() {
  const pref = window.userPreferences && window.userPreferences.auto_skip_intro;
  if (pref !== undefined && pref !== null) return pref === true || pref === 1 || pref === '1' || pref === 'true';
  return readPref('kurastream_auto_skip_intro') === 'true';
}

function prefersAutoPlayNext() {
  const pref = window.userPreferences && window.userPreferences.auto_play_next;
  if (pref !== undefined && pref !== null) return !(pref === false || pref === 0 || pref === '0' || pref === 'false');
  return readPref('kurastream_auto_play_next') !== 'false';
}

function isPerfLite() {
  return document.documentElement.classList.contains('perf-lite');
}

// -------------------------------------------------------------------------------------------
// Session state
// -------------------------------------------------------------------------------------------

let currentEpisodeId = null;
let playerInitGeneration = 0;

const S = {
  active: false,
  abort: null,
  episode: null,
  show: null,
  episodes: [],
  next: null,
  previous: null,
  duration: 0,
  audioTrack: 0,
  subtitleTrack: -1,
  lastSubtitleTrack: -1,
  direct: true,
  streamSession: Math.random().toString(36).slice(2, 12).padEnd(10, '0'),
  streamLoad: 0,
  offset: 0,
  pendingSeek: null,
  seekTimer: null,
  retries: 0,
  stallTimer: null,
  retryTimer: null,
  internalReloadUntil: 0,
  hideTimer: null,
  saveTimer: null,
  lastSavedAt: -1,
  introSkipped: false,
  creditsSkipped: false,
  upNext: { shown: false, dismissed: false, navigating: false, seconds: 0, timer: null },
  endedShown: false,
  hold: { timer: null, active: false, previousRate: 1 },
  tap: { lastTime: 0, lastX: 0, streakUntil: 0, streakSide: null, streakTotal: 0, downAt: 0, downX: 0, downY: 0, pointerType: '' },
  hudTimer: null,
  feedbackTimers: {},
  toastTimer: null,
  resumeTimer: null,
  octopus: null,
  subtitleRequest: 0,
  audioEnhancer: null,
  scrubPreview: null,
  ambilightTimer: null,
  dragging: false,
  lastKnownTime: 0,
  partyHandlers: null,
  seenMessageIds: new Set(),
  heartbeatTimer: null
};

const els = {};

function $(id) {
  return document.getElementById(id);
}

function cacheElements() {
  [
    'player-container', 'video-element', 'subtitles-container', 'player-controls-overlay', 'player-loader', 'player-loader-text',
    'player-back-btn', 'player-show-title', 'player-episode-title', 'center-play-pause-btn', 'center-play-icon',
    'center-rewind-btn', 'center-forward-btn', 'player-progress-bar', 'player-progress-buffered', 'player-progress-hover',
    'player-progress-current', 'player-progress-handle', 'player-progress-tooltip', 'player-time-current',
    'player-time-duration', 'play-pause-btn', 'play-icon', 'rewind-btn', 'forward-btn', 'mute-btn', 'volume-icon',
    'volume-slider', 'next-ep-btn', 'episodes-btn', 'player-tracks-btn', 'more-options-btn', 'more-options-menu',
    'more-options-dropdown', 'player-party-btn', 'player-pip-btn', 'fullscreen-btn', 'fullscreen-icon', 'player-hud',
    'player-seek-feedback-left', 'player-seek-feedback-right', 'skip-intro-btn', 'skip-intro-label', 'up-next-card', 'up-next-thumb',
    'up-next-title', 'up-next-meta', 'up-next-count', 'up-next-ring', 'up-next-play', 'up-next-dismiss',
    'player-end-screen', 'player-end-title', 'player-end-next', 'player-end-replay', 'player-end-back',
    'player-resume-toast', 'player-resume-text', 'player-resume-restart', 'player-error-overlay', 'player-error-title',
    'player-error-message', 'player-error-retry-btn', 'player-error-back-btn', 'player-episodes-panel',
    'player-episodes-seasons', 'player-episodes-list', 'player-episodes-close', 'file-info-modal', 'file-info-body',
    'file-info-close', 'qr-share-modal', 'qr-share-close', 'qr-image', 'qr-url-text', 'player-shortcuts-modal',
    'player-shortcuts-close', 'player-ambilight-canvas', 'menu-pip-btn', 'menu-ambilight-btn', 'menu-qr-btn',
    'menu-file-info-btn', 'menu-shortcuts-btn', 'player-party-sidebar', 'party-messages-container', 'party-chat-input',
    'party-input-form', 'party-btn-close-sidebar', 'party-sound-toggle', 'party-sound-icon', 'party-btn-copy-code',
    'party-btn-copy-cta', 'party-room-code-display', 'party-btn-leave', 'party-header-title', 'party-host-badge',
    'player-toast'
  ].forEach(id => { els[id] = $(id); });
  els.container = els['player-container'];
  els.video = els['video-element'];
}

/** Episode currently loaded in the player, or null when the player view is not active. */
export function getActiveEpisodeId() {
  return S.active ? currentEpisodeId : null;
}

function listen(target, type, handler, options = {}) {
  if (!target) return;
  target.addEventListener(type, handler, { ...options, signal: S.abort.signal });
}

// -------------------------------------------------------------------------------------------
// Time & stream helpers
// -------------------------------------------------------------------------------------------

function absoluteTime() {
  const video = els.video;
  if (!video) return 0;
  return S.offset + (video.currentTime || 0);
}

function displayTime() {
  return S.pendingSeek !== null ? S.pendingSeek : absoluteTime();
}

function episodeDuration() {
  const fromMeta = Number(S.episode && S.episode.duration) || 0;
  if (fromMeta > 0) return fromMeta;
  const video = els.video;
  return video && Number.isFinite(video.duration) ? S.offset + video.duration : 0;
}

function formatStart(seconds) {
  return String(Math.round(seconds * 1000) / 1000);
}

function buildStreamUrl(startAt) {
  const params = new URLSearchParams();
  if (!S.direct) {
    params.set('audio', String(S.audioTrack));
    if (startAt > 0) params.set('start', formatStart(startAt));
    // Identifies this player instance: a seek replaces its own previous ffmpeg instead of waiting for a free slot.
    params.set('session', S.streamSession);
  }
  if (partyManager.streamCapabilityToken) params.set('ticket', partyManager.streamCapabilityToken);
  // No account token in the URL: a <video> request is authorised by the HttpOnly session cookie, and a token in the
  // query string would be written to access logs (shown in the admin console) and proxy logs.
  const query = params.toString();
  return `/api/stream/${encodeURIComponent(currentEpisodeId)}${query ? `?${query}` : ''}`;
}

function canControlPlayback(showNotice = true) {
  if (partyManager.isInRoom() && !partyManager.canControlPlayback()) {
    if (showNotice) showHud('crown', 'Solo el anfitrión controla la reproducción');
    return false;
  }
  return true;
}

function sendPartySync(action) {
  if (!partyManager.isInRoom() || Date.now() < S.internalReloadUntil) return;
  partyManager.sendPlaybackSync(!els.video.paused, displayTime(), currentEpisodeId, action);
}

/**
 * A <video> element cannot read an HTTP 503, so a busy transcoder would just look like a broken video. Ask first
 * (GET /api/stream/:id/availability) and, while every transcode slot is taken, say so and retry.
 * Resolves true when the stream may start (also when the probe itself fails: the stream request decides then).
 */
async function waitForTranscodeSlot(token) {
  const query = new URLSearchParams({ audio: String(S.audioTrack), session: S.streamSession });
  for (let attempt = 0; attempt < 24; attempt++) {
    if (token !== S.streamLoad) return false;
    let info = null;
    try {
      const res = await fetch(`/api/stream/${encodeURIComponent(currentEpisodeId)}/availability?${query}`, { headers: authHeaders() });
      if (res.ok) info = await res.json();
    } catch {
      return true;
    }
    if (!info || !info.busy) return true;
    setLoading(true, `Servidor ocupado (${info.active_transcodes}/${info.max_transcodes}), reintentando…`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return token === S.streamLoad;
}

/**
 * (Re)starts the stream at an episode position. Direct streams seek in place when the file is
 * already loaded; remuxed streams restart ffmpeg at `startAt`.
 */
function loadStream(startAt = 0, { autoplay = null } = {}) {
  const video = els.video;
  if (!video || !S.episode) return;
  const shouldPlay = autoplay === null ? !video.paused : autoplay;
  const duration = episodeDuration();
  startAt = Math.max(0, duration > 0 ? Math.min(startAt, Math.max(0, duration - 1)) : startAt);

  S.direct = isDirectPlayable(S.episode, S.audioTrack);
  const currentSrc = video.getAttribute('src') || '';
  const directLoaded = S.direct && currentSrc && !currentSrc.includes('start=') && !currentSrc.includes('audio=') && video.readyState >= 1;

  hideError();
  if (directLoaded) {
    video.currentTime = startAt;
  } else {
    S.offset = S.direct ? 0 : startAt;
    S.internalReloadUntil = Date.now() + 1500;
    setLoading(true);
    const token = ++S.streamLoad;
    const begin = () => {
      if (token !== S.streamLoad) return;   // a newer load (another seek, episode or audio change) replaced this one
      video.src = buildStreamUrl(startAt);
      video.load();
      if (S.direct && startAt > 0) {
        listen(video, 'loadedmetadata', () => { video.currentTime = startAt; }, { once: true });
      }
      if (S.scrubPreview && S.direct) S.scrubPreview.updateSource(buildStreamUrl(0));
    };
    if (S.direct) {
      begin();
    } else {
      waitForTranscodeSlot(token).then((ok) => { if (ok) begin(); });
    }
  }
  video.playbackRate = currentBaseRate();
  syncSubtitleClock();
  if (shouldPlay) {
    const attempt = video.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch((error) => {
        // Browsers refuse autoplay with sound on a page opened from a link: show the big play button and keep it.
        if (error && error.name === 'NotAllowedError' && els.container) {
          els.container.classList.add('autoplay-blocked');
          setLoading(false);
        }
        updatePlayState();
      });
    }
  }
  S.lastKnownTime = startAt;
  renderProgress(startAt);
}

/** Seeks to an absolute episode time, coalescing rapid remux seeks into one stream restart. */
function seekTo(target, { notify = true } = {}) {
  const video = els.video;
  if (!video || !S.episode) return;
  const duration = episodeDuration();
  target = Math.max(0, duration > 0 ? Math.min(target, duration - 0.5) : target);
  hideEndScreen();
  if (target < upNextTriggerTime() - 1) {
    if (S.upNext.shown) hideUpNext();
    S.upNext.dismissed = false;
  }
  S.lastKnownTime = target;

  if (S.direct) {
    video.currentTime = target;
    renderProgress(target);
    if (notify) sendPartySync('seek');
    return;
  }

  // Remux: a target inside what is already downloaded can be reached without restarting ffmpeg.
  const relative = target - S.offset;
  if (relative >= 0 && isBufferedAndSeekable(relative)) {
    video.currentTime = relative;
    renderProgress(target);
    if (notify) sendPartySync('seek');
    return;
  }

  S.pendingSeek = target;
  renderProgress(target);
  clearTimeout(S.seekTimer);
  S.seekTimer = setTimeout(() => {
    const finalTarget = S.pendingSeek;
    S.pendingSeek = null;
    if (finalTarget === null || !S.active) return;
    loadStream(finalTarget);
    if (notify) {
      S.internalReloadUntil = 0;
      sendPartySync('seek');
      S.internalReloadUntil = Date.now() + 1500;
    }
  }, REMUX_SEEK_DEBOUNCE_MS);
}

function seekBy(delta) {
  seekTo(displayTime() + delta);
}

function isBufferedAndSeekable(time) {
  const video = els.video;
  const inRanges = ranges => {
    for (let i = 0; i < ranges.length; i++) {
      if (time >= ranges.start(i) && time <= ranges.end(i) - 0.5) return true;
    }
    return false;
  };
  try {
    return inRanges(video.buffered) && inRanges(video.seekable);
  } catch {
    return false;
  }
}

function currentBaseRate() {
  if (partyManager.isInRoom()) return 1;
  const rate = parseFloat(readPref('kura_playback_speed', '1'));
  return SPEEDS.includes(rate) ? rate : 1;
}

function setPlaybackRate(rate) {
  if (partyManager.isInRoom()) {
    showHud('users', 'La velocidad es fija durante un Watch Party');
    return;
  }
  writePref('kura_playback_speed', rate);
  els.video.playbackRate = rate;
  syncSettingsMenu();
  showHud('gauge', `${rate}x`);
}

// -------------------------------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------------------------------

function setLoading(on, text = '') {
  const loader = els['player-loader'];
  if (!loader) return;
  loader.hidden = !on;
  if (els['player-loader-text']) els['player-loader-text'].textContent = text;
  els.container.classList.toggle('is-loading', on);
}

function updatePlayState() {
  const video = els.video;
  if (!video) return;
  const playing = !video.paused && !video.ended;
  if (playing && els.container) els.container.classList.remove('autoplay-blocked');
  setIcon(els['play-icon'], playing ? 'pause' : 'play');
  setIcon(els['center-play-icon'], playing ? 'pause' : 'play');
  const label = playing ? 'Pausar' : 'Reproducir';
  els['play-pause-btn']?.setAttribute('aria-label', label);
  els['play-pause-btn']?.setAttribute('data-tip', `${label} (K)`);
  els['center-play-pause-btn']?.setAttribute('aria-label', label);
  els.container.classList.toggle('is-paused', !playing);
  if ('mediaSession' in navigator) {
    try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch { /* unsupported */ }
  }
}

function renderProgress(time = displayTime()) {
  const duration = episodeDuration();
  const pct = duration > 0 ? Math.min(100, Math.max(0, (time / duration) * 100)) : 0;
  if (!S.dragging) {
    if (els['player-progress-current']) els['player-progress-current'].style.width = `${pct}%`;
    if (els['player-progress-handle']) els['player-progress-handle'].style.left = `${pct}%`;
    if (els['player-time-current']) els['player-time-current'].textContent = formatTime(time);
  }
  if (els['player-time-duration']) els['player-time-duration'].textContent = formatTime(duration);
  const bar = els['player-progress-bar'];
  if (bar) {
    bar.setAttribute('aria-valuemax', String(Math.round(duration)));
    bar.setAttribute('aria-valuenow', String(Math.round(time)));
    bar.setAttribute('aria-valuetext', `${formatTime(time)} de ${formatTime(duration)}`);
  }
}

function renderBuffered() {
  const video = els.video;
  const fill = els['player-progress-buffered'];
  if (!video || !fill) return;
  const duration = episodeDuration();
  if (duration <= 0) return;
  let end = 0;
  try {
    const ranges = video.buffered;
    for (let i = 0; i < ranges.length; i++) {
      if (ranges.start(i) <= video.currentTime + 0.5 && video.currentTime <= ranges.end(i)) {
        end = ranges.end(i);
        break;
      }
    }
  } catch { /* no buffer yet */ }
  fill.style.width = `${Math.min(100, ((S.offset + end) / duration) * 100)}%`;
}

function renderVolume() {
  const video = els.video;
  const slider = els['volume-slider'];
  const level = video.muted ? 0 : video.volume;
  if (slider) {
    slider.value = String(level);
    slider.style.setProperty('--fill', `${Math.round(level * 100)}%`);
  }
  setIcon(els['volume-icon'], level === 0 ? 'volume-x' : (level < 0.5 ? 'volume-1' : 'volume-2'));
  els['mute-btn']?.setAttribute('aria-label', level === 0 ? 'Activar sonido' : 'Silenciar');
}

function setVolume(level, { muted = level <= 0 } = {}) {
  const video = els.video;
  level = Math.max(0, Math.min(1, Math.round(level * 100) / 100));
  if (level > 0) video.volume = level;
  video.muted = muted;
  if (level > 0) writePref('playerVolume', level);
  writePref('kura_player_muted', video.muted ? '1' : '0');
  renderVolume();
}

function renderTitles() {
  const ep = S.episode;
  const show = S.show || {};
  if (els['player-show-title']) els['player-show-title'].textContent = show.title || '';
  if (els['player-episode-title']) {
    const parts = [];
    if (show.media_type !== 'movie') parts.push(episodeLabel(ep));
    if (ep.title) parts.push(ep.title);
    els['player-episode-title'].textContent = parts.join(' · ');
  }
  document.title = `${show.title || 'KuraStream'}${ep.title ? ` - ${ep.title}` : ''} | KuraStream`;
}

function renderChapterTicks() {
  const bar = els['player-progress-bar'];
  if (!bar || !S.episode) return;
  bar.querySelectorAll('.seekbar-chapter-tick').forEach(tick => tick.remove());
  const duration = episodeDuration();
  if (duration <= 0) return;
  const track = bar.querySelector('.player-progress-track') || bar;
  chapterMarks().forEach(mark => {
    const tick = document.createElement('div');
    tick.className = 'seekbar-chapter-tick';
    tick.style.left = `${(mark.time / duration) * 100}%`;
    tick.title = `${formatChapterTime(mark.time)} · ${mark.title}`;
    track.appendChild(tick);
  });
}

function chapterMarks() {
  const ep = S.episode;
  const duration = episodeDuration();
  let chapters = ep.chapters;
  if (typeof chapters === 'string') {
    try { chapters = JSON.parse(chapters); } catch { chapters = []; }
  }
  const marks = [];
  if (Array.isArray(chapters) && chapters.length) {
    chapters.forEach(ch => {
      const start = Number(ch.start);
      if (Number.isFinite(start) && start > 0 && start < duration) marks.push({ time: start, title: ch.title || 'Capítulo' });
    });
    return marks;
  }
  const intro = introWindow();
  if (intro) {
    if (intro.start > 0) marks.push({ time: intro.start, title: 'Intro' });
    marks.push({ time: intro.end, title: 'Episodio' });
  }
  const outro = Number(ep.outro_start);
  if (Number.isFinite(outro) && outro > 0 && outro < duration) marks.push({ time: outro, title: 'Créditos' });
  return marks;
}

function introWindow() {
  const ep = S.episode;
  if (!ep) return null;
  const start = Number(ep.intro_start);
  if (ep.intro_start === null || ep.intro_start === undefined || !Number.isFinite(start)) return null;
  const endRaw = Number(ep.intro_end);
  const end = ep.intro_end !== null && ep.intro_end !== undefined && Number.isFinite(endRaw) && endRaw > start ? endRaw : start + 90;
  return { start, end };
}

// -------------------------------------------------------------------------------------------
// HUD, toasts, seek feedback
// -------------------------------------------------------------------------------------------

function showHud(icon, label) {
  const hud = els['player-hud'];
  if (!hud) return;
  hud.querySelector('.player-hud-icon').innerHTML = icon ? iconSvg(icon, { size: 22 }) : '';
  hud.querySelector('.player-hud-label').textContent = label || '';
  hud.classList.remove('is-visible');
  void hud.offsetWidth;
  hud.classList.add('is-visible');
  clearTimeout(S.hudTimer);
  S.hudTimer = setTimeout(() => hud.classList.remove('is-visible'), 900);
}

function showToast(message, duration = 3000) {
  const toast = els['player-toast'];
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(S.toastTimer);
  S.toastTimer = setTimeout(() => toast.classList.remove('is-visible'), duration);
}

function showSeekFeedback(side, label) {
  const el = els[`player-seek-feedback-${side}`];
  if (!el) return;
  el.querySelector('.player-seek-feedback-icon').innerHTML = iconSvg(side === 'left' ? 'rewind' : 'fast-forward', { size: 28 });
  el.querySelector('.player-seek-feedback-label').textContent = label;
  el.classList.remove('is-visible');
  void el.offsetWidth;
  el.classList.add('is-visible');
  clearTimeout(S.feedbackTimers[side]);
  S.feedbackTimers[side] = setTimeout(() => el.classList.remove('is-visible'), 650);
}

// -------------------------------------------------------------------------------------------
// Controls visibility
// -------------------------------------------------------------------------------------------

function overlayOpen() {
  return Boolean(
    els['more-options-menu']?.classList.contains('show') ||
    isTracksModalOpen() ||
    (els['player-episodes-panel'] && !els['player-episodes-panel'].hidden) ||
    (els['file-info-modal'] && !els['file-info-modal'].hidden) ||
    (els['qr-share-modal'] && !els['qr-share-modal'].hidden) ||
    (els['player-shortcuts-modal'] && !els['player-shortcuts-modal'].hidden)
  );
}

function showControls() {
  if (!els.container) return;
  els.container.classList.remove('controls-hidden');
  scheduleHideControls();
}

function scheduleHideControls() {
  clearTimeout(S.hideTimer);
  const video = els.video;
  if (!video || video.paused || S.dragging) return;
  S.hideTimer = setTimeout(() => {
    // A control that has keyboard focus keeps the bar visible: a person tabbing through it must not lose it.
    if (!S.active || els.video.paused || overlayOpen() || S.dragging || els.container.matches('.is-pointer-on-controls') || els.container.querySelector(':focus-visible')) {
      scheduleHideControls();
      return;
    }
    els.container.classList.add('controls-hidden');
  }, CONTROLS_HIDE_MS);
}

function hideControlsNow() {
  if (els.video.paused || overlayOpen()) return;
  clearTimeout(S.hideTimer);
  els.container.classList.add('controls-hidden');
}

// -------------------------------------------------------------------------------------------
// Playback actions
// -------------------------------------------------------------------------------------------

function togglePlay() {
  const video = els.video;
  if (!video || !canControlPlayback()) return;
  hideEndScreen();
  if (video.paused || video.ended) {
    const attempt = video.play();
    if (attempt && typeof attempt.catch === 'function') attempt.catch(() => updatePlayState());
  } else {
    video.pause();
  }
  showControls();
}

function toggleMute() {
  const video = els.video;
  if (video.muted || video.volume === 0) {
    const restored = parseFloat(readPref('playerVolume', '1')) || 1;
    setVolume(restored, { muted: false });
    showHud('volume-2', `${Math.round(restored * 100)}%`);
  } else {
    setVolume(video.volume, { muted: true });
    showHud('volume-x', 'Silenciado');
  }
}

function changeVolume(delta) {
  const video = els.video;
  const base = video.muted ? 0 : video.volume;
  const next = Math.max(0, Math.min(1, base + delta));
  setVolume(next);
  showHud(next === 0 ? 'volume-x' : (next < 0.5 ? 'volume-1' : 'volume-2'), `${Math.round(next * 100)}%`);
}

function isFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

function toggleFullscreen() {
  const container = els.container;
  if (!isFullscreen()) {
    const request = container.requestFullscreen || container.webkitRequestFullscreen;
    if (!request) {
      // iPhone Safari only allows the native <video> player to go fullscreen.
      if (typeof els.video.webkitEnterFullscreen === 'function') els.video.webkitEnterFullscreen();
      return;
    }
    Promise.resolve(request.call(container)).then(() => {
      if (screen.orientation && screen.orientation.lock && window.matchMedia('(pointer: coarse)').matches) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    }).catch(() => {});
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) Promise.resolve(exit.call(document)).catch(() => {});
    if (screen.orientation && screen.orientation.unlock) {
      try { screen.orientation.unlock(); } catch { /* not locked */ }
    }
  }
}

function renderFullscreenState() {
  const on = isFullscreen();
  setIcon(els['fullscreen-icon'], on ? 'minimize' : 'maximize');
  els['fullscreen-btn']?.setAttribute('aria-label', on ? 'Salir de pantalla completa' : 'Pantalla completa');
  els['fullscreen-btn']?.setAttribute('data-tip', on ? 'Salir de pantalla completa (F)' : 'Pantalla completa (F)');
}

async function togglePictureInPicture() {
  const video = els.video;
  closeSettingsMenu();
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else if (document.pictureInPictureEnabled && !video.disablePictureInPicture) {
      await video.requestPictureInPicture();
    } else if (typeof video.webkitSetPresentationMode === 'function') {
      video.webkitSetPresentationMode(video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
    }
  } catch {
    showToast('Tu navegador no permitió abrir la ventana flotante.');
  }
}

function goToEpisode(episode) {
  if (!episode) return;
  S.upNext.navigating = true;
  location.hash = playerHash(episode.id);
}

function playNextEpisode() {
  if (!S.next) {
    showHud('list-video', 'No hay más episodios');
    return;
  }
  if (partyManager.isInRoom() && !partyManager.isHost()) {
    showHud('crown', 'El anfitrión elige el episodio');
    return;
  }
  goToEpisode(S.next);
}

function leavePlayer() {
  location.hash = showHash(currentEpisodeId);
}

// -------------------------------------------------------------------------------------------
// Subtitles (SubtitlesOctopus / libass in a worker)
// -------------------------------------------------------------------------------------------

function loadOctopusScript() {
  if (typeof window.SubtitlesOctopus !== 'undefined') return Promise.resolve();
  if (loadOctopusScript.promise) return loadOctopusScript.promise;
  loadOctopusScript.promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/subtitles-octopus/subtitles-octopus.js';
    script.onload = () => resolve();
    script.onerror = () => {
      loadOctopusScript.promise = null;
      reject(new Error('No se pudo cargar el motor de subtítulos'));
    };
    document.body.appendChild(script);
  });
  return loadOctopusScript.promise;
}

const subtitleCache = new Map();
const fontCache = new Map();

function authHeaders() {
  const token = AuthManager.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchSubtitle(episodeId, track) {
  const key = `${episodeId}|${track}`;
  if (subtitleCache.has(key)) return subtitleCache.get(key);
  const params = new URLSearchParams();
  if (partyManager.streamCapabilityToken) params.set('ticket', partyManager.streamCapabilityToken);
  const res = await fetch(`/api/subtitles/${encodeURIComponent(episodeId)}/${track}?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  subtitleCache.set(key, text);
  return text;
}

async function fetchFonts(episodeId) {
  if (fontCache.has(episodeId)) return fontCache.get(episodeId);
  let fonts = [];
  try {
    const res = await fetch(`/api/episodes/${encodeURIComponent(episodeId)}/fonts`, { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      fonts = (Array.isArray(data.fonts) ? data.fonts : []).map(font => (typeof font === 'string'
        ? `/api/episodes/${encodeURIComponent(episodeId)}/fonts/${encodeURIComponent(font)}`
        : font.url || `/api/episodes/${encodeURIComponent(episodeId)}/fonts/${encodeURIComponent(font.name)}`));
    }
  } catch { /* fall back to the default font */ }
  fontCache.set(episodeId, fonts);
  return fonts;
}

function syncSubtitleClock() {
  if (!S.octopus) return;
  S.octopus.timeOffset = S.offset;
  if (typeof S.octopus.setCurrentTime === 'function' && els.video) {
    try { S.octopus.setCurrentTime((els.video.currentTime || 0) + S.offset); } catch { /* worker not ready */ }
  }
}

function hideSubtitles() {
  if (!S.octopus) return;
  try { S.octopus.freeTrack(); } catch { /* nothing loaded */ }
  if (S.octopus.canvasParent) S.octopus.canvasParent.style.display = 'none';
}

async function applySubtitleTrack(track) {
  const request = ++S.subtitleRequest;
  if (track === -1) {
    hideSubtitles();
    return;
  }
  const episodeId = currentEpisodeId;
  try {
    const [content] = await Promise.all([fetchSubtitle(episodeId, track), loadOctopusScript()]);
    if (request !== S.subtitleRequest || !S.active || episodeId !== currentEpisodeId) return;
    if (S.octopus) {
      if (S.octopus.canvasParent) S.octopus.canvasParent.style.display = '';
      S.octopus.setTrack(content);
      syncSubtitleClock();
      return;
    }
    const video = els.video;
    if (!video.videoWidth) {
      await new Promise(resolve => listen(video, 'loadedmetadata', resolve, { once: true }));
      if (request !== S.subtitleRequest || !S.active) return;
    }
    const fonts = await fetchFonts(episodeId);
    if (request !== S.subtitleRequest || !S.active) return;
    const container = els['subtitles-container'];
    container.innerHTML = '';
    S.octopus = new window.SubtitlesOctopus({
      video,
      subContent: content,
      workerUrl: '/vendor/subtitles-octopus/subtitles-octopus-worker.js',
      legacyWorkerUrl: '/vendor/subtitles-octopus/subtitles-octopus-worker-legacy.js',
      fallbackFont: '/vendor/subtitles-octopus/default.ttf',
      fonts,
      timeOffset: S.offset,
      targetFps: isPerfLite() ? 24 : 30,
      renderMode: 'wasm-blend',
      container,
      onError: err => console.warn('[Player] Subtítulos:', err)
    });
  } catch (err) {
    if (request === S.subtitleRequest) showToast('No se pudieron cargar los subtítulos.');
    console.warn('[Player] Subtitle load failed:', err);
  }
}

function destroySubtitles() {
  S.subtitleRequest++;
  if (S.octopus) {
    try { S.octopus.dispose(); } catch { /* already gone */ }
    S.octopus = null;
  }
  if (els['subtitles-container']) els['subtitles-container'].innerHTML = '';
}

function selectSubtitle(track, { remember = true } = {}) {
  S.subtitleTrack = track;
  if (track !== -1) S.lastSubtitleTrack = track;
  if (remember) {
    if (track === -1) {
      writePref('kura_pref_sub_lang', 'off');
    } else {
      const info = parseTrackList(S.episode.subtitle_tracks).find((t, i) => trackNumber(t, i) === track);
      const lang = detectTrackLang(info);
      if (lang && lang !== 'und') writePref('kura_pref_sub_lang', lang);
    }
  }
  applySubtitleTrack(track);
}

function cycleSubtitles() {
  const tracks = labelTracks(parseTrackList(S.episode.subtitle_tracks), 'subtitle').filter(t => !t.bitmap);
  if (!tracks.length) {
    showHud('captions-off', 'Este episodio no tiene subtítulos');
    return;
  }
  if (S.subtitleTrack === -1) {
    const target = tracks.find(t => t.number === S.lastSubtitleTrack) || tracks[0];
    selectSubtitle(target.number);
    showHud('captions', target.label);
  } else {
    selectSubtitle(-1);
    showHud('captions-off', 'Subtítulos desactivados');
  }
}

function selectAudio(track) {
  if (track === S.audioTrack) return;
  S.audioTrack = track;
  const info = parseTrackList(S.episode.audio_tracks).find((t, i) => trackNumber(t, i) === track);
  const lang = detectTrackLang(info);
  if (lang && lang !== 'und') writePref('kura_pref_audio_lang', lang);
  loadStream(displayTime(), { autoplay: !els.video.paused });
}

function openTracks() {
  if (!S.episode) return;
  hideResumeToast();
  closeSettingsMenu();
  closeEpisodesPanel();
  openTracksModal({
    container: els.container,
    audioTracks: labelTracks(parseTrackList(S.episode.audio_tracks), 'audio'),
    subtitleTracks: labelTracks(parseTrackList(S.episode.subtitle_tracks), 'subtitle'),
    currentAudio: S.audioTrack,
    currentSubtitle: S.subtitleTrack,
    onSelectAudio: selectAudio,
    onSelectSubtitle: track => selectSubtitle(track),
    onClose: () => { els['player-tracks-btn']?.focus({ preventScroll: true }); showControls(); }
  });
}

// -------------------------------------------------------------------------------------------
// Settings menu (speed, audio boost, EQ, PiP, ambient light, QR, file info, shortcuts)
// -------------------------------------------------------------------------------------------

function openSettingsMenu() {
  closeTracksModal();
  closeEpisodesPanel();
  hideResumeToast();
  syncSettingsMenu();
  els.container.classList.add('is-menu-open');
  els['more-options-menu']?.classList.add('show');
  els['more-options-dropdown']?.classList.add('active');
  els['more-options-btn']?.setAttribute('aria-expanded', 'true');
  showControls();
}

function closeSettingsMenu() {
  els.container?.classList.remove('is-menu-open');
  els['more-options-menu']?.classList.remove('show');
  els['more-options-dropdown']?.classList.remove('active');
  els['more-options-btn']?.setAttribute('aria-expanded', 'false');
}

function syncSettingsMenu() {
  const menu = els['more-options-menu'];
  if (!menu) return;
  const rate = els.video ? els.video.playbackRate : 1;
  menu.querySelectorAll('.speed-opt').forEach(opt => opt.classList.toggle('active', Number(opt.dataset.speed) === currentBaseRateShown(rate)));
  const boost = Math.round((S.audioEnhancer ? S.audioEnhancer.getGain() : Number(readPref('kura_audio_boost', '100')) / 100) * 100);
  menu.querySelectorAll('.boost-opt').forEach(opt => opt.classList.toggle('active', Number(opt.dataset.boost) === boost));
  const preset = S.audioEnhancer ? S.audioEnhancer.getCurrentPreset() : readPref('kura_audio_preset', 'flat');
  menu.querySelectorAll('.preset-opt').forEach(opt => opt.classList.toggle('active', opt.dataset.preset === preset));
  els['menu-ambilight-btn']?.classList.toggle('is-on', readPref('kura_ambilight') === 'true');
  els['menu-ambilight-btn']?.setAttribute('aria-checked', String(readPref('kura_ambilight') === 'true'));
  const speedGroup = menu.querySelector('#speed-options-group');
  if (speedGroup) speedGroup.classList.toggle('is-disabled', partyManager.isInRoom());
}

function currentBaseRateShown(rate) {
  return SPEEDS.reduce((best, value) => (Math.abs(value - rate) < Math.abs(best - rate) ? value : best), 1);
}

/** Web Audio graph is created only when a boost/EQ is actually used (it costs CPU on every frame). */
function ensureAudioEnhancer() {
  if (!S.audioEnhancer) {
    S.audioEnhancer = initAudioEnhancer(els.video, {
      gain: Number(readPref('kura_audio_boost', '100')) / 100,
      preset: readPref('kura_audio_preset', 'flat')
    });
  }
  return S.audioEnhancer;
}

function setAudioBoost(percent) {
  const enhancer = ensureAudioEnhancer();
  enhancer.setGain(percent / 100);
  writePref('kura_audio_boost', percent);
  syncSettingsMenu();
  showHud('volume-2', `Volumen ${percent}%`);
  if (!enhancer.isSupported() && percent > 100) showToast('Tu navegador no permite subir el volumen por encima del 100%.');
}

function setAudioPreset(preset, label) {
  ensureAudioEnhancer().setPreset(preset);
  writePref('kura_audio_preset', preset);
  syncSettingsMenu();
  showHud('audio-lines', `Ecualizador: ${label}`);
}

function toggleAmbilight() {
  const on = readPref('kura_ambilight') !== 'true';
  writePref('kura_ambilight', on);
  syncSettingsMenu();
  applyAmbilight();
  showHud('sparkles', on ? 'Luz ambiental activada' : 'Luz ambiental desactivada');
}

function applyAmbilight() {
  const canvas = els['player-ambilight-canvas'];
  const on = readPref('kura_ambilight') === 'true' && !isPerfLite();
  clearInterval(S.ambilightTimer);
  S.ambilightTimer = null;
  if (!canvas) return;
  canvas.classList.toggle('active', on);
  if (!on) return;
  canvas.width = 32;
  canvas.height = 18;
  const ctx = canvas.getContext('2d', { alpha: false });
  S.ambilightTimer = setInterval(() => {
    const video = els.video;
    if (!video || video.paused || document.hidden || video.readyState < 2) return;
    try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); } catch { /* frame not ready */ }
  }, 300);
}

function showFileInfo() {
  closeSettingsMenu();
  const ep = S.episode;
  const audio = labelTracks(parseTrackList(ep.audio_tracks), 'audio').map(t => t.label).join(', ') || 'Predeterminado';
  const subs = labelTracks(parseTrackList(ep.subtitle_tracks), 'subtitle').map(t => t.label).join(', ') || 'Ninguno';
  const size = Number(ep.size) > 0 ? `${(Number(ep.size) / (1024 ** 3)).toFixed(2)} GB` : 'N/D';
  const rows = [
    ['Resolución', ep.resolution || 'N/D'],
    ['Video', String(ep.video_codec || 'N/D').toUpperCase()],
    ['Cuadros por segundo', Number(ep.fps) > 0 ? Number(ep.fps).toFixed(3) : 'N/D'],
    ['Contenedor', String(ep.container || 'N/D').toUpperCase()],
    ['Modo de reproducción', S.direct ? 'Directa (sin conversión)' : 'Remux en el servidor'],
    ['Tamaño', size],
    ['Duración', formatTime(episodeDuration())],
    ['Audio', audio],
    ['Subtítulos', subs]
  ];
  els['file-info-body'].innerHTML = rows.map(([label, value]) => `
    <div class="info-item"><span class="info-label">${escapeHtml(label)}</span><span class="info-val">${escapeHtml(value)}</span></div>
  `).join('');
  els['file-info-modal'].hidden = false;
}

function showQrShare() {
  closeSettingsMenu();
  const url = `${window.location.origin}/${playerHash(currentEpisodeId)}?t=${Math.floor(displayTime())}`;
  if (els['qr-url-text']) els['qr-url-text'].textContent = url;
  if (els['qr-image']) renderQRCodeToElement(els['qr-image'], url, 200);
  els['qr-share-modal'].hidden = false;
}

function toggleShortcuts(force) {
  const modal = els['player-shortcuts-modal'];
  if (!modal) return;
  const open = force !== undefined ? force : modal.hidden;
  closeSettingsMenu();
  modal.hidden = !open;
  if (open) {
    if (els.video && !els.video.paused) els.video.pause();
    els['player-shortcuts-close']?.focus({ preventScroll: true });
  }
}

// -------------------------------------------------------------------------------------------
// Episodes panel
// -------------------------------------------------------------------------------------------

function openEpisodesPanel() {
  const panel = els['player-episodes-panel'];
  if (!panel || !S.episodes.length) return;
  hideResumeToast();
  closeSettingsMenu();
  closeTracksModal();
  const currentSeason = parseInt(S.episode.season_number, 10) || 0;
  renderEpisodesPanel(currentSeason);
  panel.hidden = false;
  requestAnimationFrame(() => {
    panel.classList.add('is-open');
    const current = panel.querySelector('.player-episode-item.is-current');
    if (current) current.scrollIntoView({ block: 'center' });
  });
}

function closeEpisodesPanel() {
  const panel = els['player-episodes-panel'];
  if (!panel || panel.hidden) return;
  panel.classList.remove('is-open');
  panel.hidden = true;
}

function renderEpisodesPanel(season) {
  const seasons = [...new Set(orderEpisodes(S.episodes).map(ep => parseInt(ep.season_number, 10) || 0))];
  const tabs = els['player-episodes-seasons'];
  if (tabs) {
    tabs.innerHTML = seasons.length > 1 ? seasons.map(num => `
      <button type="button" class="player-season-tab${num === season ? ' active' : ''}" data-season="${num}">${num === 0 ? 'Especiales' : `Temporada ${num}`}</button>
    `).join('') : '';
    tabs.hidden = seasons.length <= 1;
  }
  const list = els['player-episodes-list'];
  const items = orderEpisodes(S.episodes).filter(ep => (parseInt(ep.season_number, 10) || 0) === season);
  list.innerHTML = items.map(ep => {
    const thumb = ep.thumbnail_path ? escapeHtml(ep.thumbnail_path) : '/assets/illustrations/backdrop_placeholder.svg';
    const isCurrent = ep.id === currentEpisodeId;
    const minutes = Math.round((Number(ep.duration) || 0) / 60);
    return `
      <button type="button" class="player-episode-item${isCurrent ? ' is-current' : ''}" data-episode-id="${escapeHtml(ep.id)}">
        <span class="player-episode-thumb"><img src="${thumb}" alt="" loading="lazy" data-fallback-src="/assets/illustrations/backdrop_placeholder.svg">${isCurrent ? `<span class="player-episode-now">${iconSvg('audio-lines', { size: 14 })} Viendo</span>` : ''}</span>
        <span class="player-episode-info">
          <span class="player-episode-number">${escapeHtml(episodeLabel(ep))}${minutes ? ` · ${minutes} min` : ''}</span>
          <span class="player-episode-name">${escapeHtml(ep.title || `Episodio ${ep.episode_number}`)}</span>
        </span>
      </button>`;
  }).join('');
}

// -------------------------------------------------------------------------------------------
// Skip intro, up next, end screen
// -------------------------------------------------------------------------------------------

/**
 * Ending credits with a scene after them (common in anime): {start, end} or null. Without one the
 * credits run to the end and the up-next card covers them.
 */
function creditsWithScene() {
  const ep = S.episode;
  if (!ep || ep.outro_start === null || ep.outro_start === undefined || ep.outro_end === null || ep.outro_end === undefined) return null;
  const start = Number(ep.outro_start);
  const end = Number(ep.outro_end);
  const duration = episodeDuration();
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(duration > 0)) return null;
  if (start < duration * 0.5 || end <= start || duration - end < 30) return null;
  return { start, end };
}

function upNextTriggerTime() {
  const duration = episodeDuration();
  const outro = Number(S.episode && S.episode.outro_start);
  // A scene after the credits must not be skipped by the countdown.
  if (!creditsWithScene() && Number.isFinite(outro) && outro > duration * 0.5 && outro < duration - 5) return outro;
  return duration > 120 ? duration - 20 : Infinity;
}

function updateSkipIntro(time) {
  const button = els['skip-intro-btn'];
  const intro = introWindow();
  const credits = creditsWithScene();
  if (!button) return;
  const inIntro = Boolean(intro) && time >= intro.start && time < intro.end - 1;
  const inCredits = Boolean(credits) && time >= credits.start && time < credits.end - 1;
  if (inIntro && prefersAutoSkipIntro() && !S.introSkipped && canControlPlayback(false)) {
    S.introSkipped = true;
    seekTo(intro.end);
    showHud('skip-forward', 'Intro omitida');
    button.hidden = true;
    return;
  }
  if (inCredits && prefersAutoSkipIntro() && !S.creditsSkipped && canControlPlayback(false)) {
    S.creditsSkipped = true;
    seekTo(credits.end);
    showHud('skip-forward', 'Créditos omitidos');
    button.hidden = true;
    return;
  }
  if (!inIntro && intro && time < intro.start) S.introSkipped = false;
  if (!inCredits && credits && time < credits.start) S.creditsSkipped = false;
  if (els['skip-intro-label']) els['skip-intro-label'].textContent = inCredits ? 'Omitir créditos' : 'Omitir intro';
  button.hidden = !(inIntro || inCredits);
}

function skipIntro() {
  if (!canControlPlayback()) return;
  const time = absoluteTime();
  const credits = creditsWithScene();
  if (credits && time >= credits.start && time < credits.end) {
    S.creditsSkipped = true;
    els['skip-intro-btn'].hidden = true;
    seekTo(credits.end);
    return;
  }
  const intro = introWindow();
  if (!intro) return;
  S.introSkipped = true;
  els['skip-intro-btn'].hidden = true;
  seekTo(intro.end);
}

function updateUpNext(time) {
  if (!S.next || S.upNext.dismissed || S.upNext.navigating) return;
  const trigger = upNextTriggerTime();
  if (time >= trigger) {
    if (!S.upNext.shown) showUpNext(time);
  } else if (S.upNext.shown) {
    hideUpNext();
  }
}

function canAutoAdvance() {
  return prefersAutoPlayNext() && (!partyManager.isInRoom() || partyManager.isHost());
}

function showUpNext(time) {
  const card = els['up-next-card'];
  if (!card) return;
  const next = S.next;
  S.upNext.shown = true;
  const remaining = Math.max(1, Math.ceil(episodeDuration() - time));
  S.upNext.seconds = Math.min(UP_NEXT_COUNTDOWN, remaining);
  const autoplay = canAutoAdvance();

  const thumb = els['up-next-thumb'];
  if (thumb) {
    thumb.src = next.thumbnail_path || (S.show && S.show.backdrop_path) || '/assets/illustrations/backdrop_placeholder.svg';
  }
  els['up-next-title'].textContent = next.title || `Episodio ${next.episode_number}`;
  els['up-next-meta'].textContent = episodeLabel(next);
  card.classList.toggle('has-countdown', autoplay);
  els['up-next-dismiss'].textContent = autoplay ? 'Ver créditos' : 'Cerrar';
  card.hidden = false;
  requestAnimationFrame(() => card.classList.add('is-visible'));

  clearInterval(S.upNext.timer);
  if (autoplay) {
    renderUpNextCountdown();
    S.upNext.timer = setInterval(() => {
      if (!S.active) return;
      if (els.video.paused) return;
      S.upNext.seconds -= 1;
      renderUpNextCountdown();
      if (S.upNext.seconds <= 0) {
        clearInterval(S.upNext.timer);
        goToEpisode(S.next);
      }
    }, 1000);
  }
}

function renderUpNextCountdown() {
  if (els['up-next-count']) els['up-next-count'].textContent = String(Math.max(0, S.upNext.seconds));
  const ring = els['up-next-ring'];
  if (ring) ring.style.setProperty('--progress', String(1 - Math.max(0, S.upNext.seconds) / UP_NEXT_COUNTDOWN));
}

function hideUpNext({ dismiss = false } = {}) {
  const card = els['up-next-card'];
  clearInterval(S.upNext.timer);
  S.upNext.timer = null;
  S.upNext.shown = false;
  if (dismiss) S.upNext.dismissed = true;
  if (card) {
    card.classList.remove('is-visible');
    card.hidden = true;
  }
}

function showEndScreen() {
  const screen = els['player-end-screen'];
  if (!screen) return;
  S.endedShown = true;
  hideUpNext();
  els['player-end-title'].textContent = S.next ? 'Has terminado este episodio' : (S.show && S.show.media_type === 'movie' ? 'Fin de la película' : 'Has llegado al final de la serie');
  els['player-end-next'].hidden = !S.next;
  if (S.next) els['player-end-next'].querySelector('span').textContent = `Siguiente: ${episodeLabel(S.next)}`;
  screen.hidden = false;
  showControls();
}

function hideEndScreen() {
  if (!S.endedShown) return;
  S.endedShown = false;
  els['player-end-screen'].hidden = true;
}

// -------------------------------------------------------------------------------------------
// Progress persistence
// -------------------------------------------------------------------------------------------

function progressIdentity() {
  const token = AuthManager.getToken();
  const user = AuthManager.getUser();
  const profile = AuthManager.getActiveProfile();
  return {
    token,
    username: user && user.username ? user.username : 'guest',
    profileName: profile && profile.name ? profile.name : 'Principal',
    isGuest: !token || !user
  };
}

function saveProgress(force = false) {
  const video = els.video;
  if (!video || !S.episode || !currentEpisodeId || !video.getAttribute('src')) return;
  if (S.pendingSeek !== null) return;
  const time = absoluteTime();
  const duration = episodeDuration();
  if (!force && Math.abs(time - S.lastSavedAt) < 5) return;
  if (time < 1 && !force) return;
  S.lastSavedAt = time;
  const who = progressIdentity();

  if (who.isGuest) {
    try {
      const all = JSON.parse(readPref('kura_guest_progress', '{}') || '{}');
      all[currentEpisodeId] = { progress: time, duration, completed: duration > 0 && time >= duration - 30, updated_at: Date.now() };
      writePref('kura_guest_progress', JSON.stringify(all));
    } catch { /* storage full */ }
    return;
  }

  fetch(`/api/progress/${encodeURIComponent(currentEpisodeId)}`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${who.token}` },
    body: JSON.stringify({
      progress: time,
      progress_seconds: time,
      duration,
      username: who.username,
      profile_name: who.profileName,
      // The newest write wins on the server, whichever device it comes from.
      client_ts: Date.now()
    })
  }).catch(() => { /* retried on the next tick */ });
}

async function loadResumePosition(episodeId) {
  const hashQuery = window.location.hash.split('?')[1];
  if (hashQuery) {
    const shared = parseFloat(new URLSearchParams(hashQuery).get('t'));
    if (Number.isFinite(shared) && shared > 0) return { time: shared, source: 'link' };
  }
  const who = progressIdentity();
  try {
    if (who.isGuest) {
      const saved = JSON.parse(readPref('kura_guest_progress', '{}') || '{}')[episodeId];
      if (saved && !saved.completed) return { time: Number(saved.progress) || 0, source: 'history' };
      return { time: 0, source: 'start' };
    }
    const params = new URLSearchParams({ username: who.username, profile_name: who.profileName });
    const res = await fetch(`/api/progress/${encodeURIComponent(episodeId)}?${params}`, { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      if (data && !data.completed) return { time: Number(data.progress) || 0, source: 'history' };
    }
  } catch { /* start from the beginning */ }
  return { time: 0, source: 'start' };
}

function showResumeToast(time) {
  const toast = els['player-resume-toast'];
  if (!toast) return;
  els['player-resume-text'].textContent = `Continuando desde ${formatTime(time)}`;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  clearTimeout(S.resumeTimer);
  S.resumeTimer = setTimeout(hideResumeToast, 7000);
}

function hideResumeToast() {
  const toast = els['player-resume-toast'];
  clearTimeout(S.resumeTimer);
  if (!toast) return;
  toast.classList.remove('is-visible');
  toast.hidden = true;
}

// -------------------------------------------------------------------------------------------
// Errors & recovery
// -------------------------------------------------------------------------------------------

function hideError() {
  if (els['player-error-overlay']) els['player-error-overlay'].hidden = true;
}

function showError(title, message, { action = 'retry' } = {}) {
  setLoading(false);
  const overlay = els['player-error-overlay'];
  if (!overlay) return;
  els['player-error-title'].textContent = title;
  els['player-error-message'].textContent = message;
  const retry = els['player-error-retry-btn'];
  if (action === 'login') {
    retry.innerHTML = `${iconSvg('log-in', { size: 18 })} Iniciar sesión`;
    retry.onclick = () => {
      if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
    };
  } else if (action === 'profile') {
    retry.innerHTML = `${iconSvg('users', { size: 18 })} Elegir perfil`;
    retry.onclick = () => { location.hash = '#/profiles'; };
  } else {
    retry.innerHTML = `${iconSvg('refresh-cw', { size: 18 })} Reintentar`;
    retry.onclick = () => {
      S.retries = 0;
      loadStream(S.lastKnownTime, { autoplay: true });
    };
  }
  overlay.hidden = false;
  showControls();
}

function scheduleStreamRetry(reason) {
  clearTimeout(S.retryTimer);
  if (S.retries >= MAX_STREAM_RETRIES) {
    showError('No se pudo reproducir', reason || 'El servidor no respondió. Comprueba la conexión con KuraStream e inténtalo de nuevo.');
    return;
  }
  S.retries += 1;
  const delay = 1500 * (2 ** (S.retries - 1));
  setLoading(true, 'Reconectando…');
  S.retryTimer = setTimeout(() => {
    if (S.active) loadStream(S.lastKnownTime, { autoplay: true });
  }, delay);
}

function handleVideoError() {
  const video = els.video;
  if (!video.getAttribute('src')) return;
  if (!AuthManager.getToken()) {
    showError('Inicia sesión para ver', 'Necesitas una cuenta de KuraStream para reproducir este contenido.', { action: 'login' });
    return;
  }
  if (!AuthManager.isAdmin() && !AuthManager.getActiveProfile()) {
    showError('Elige un perfil', 'Selecciona quién está viendo para guardar tu progreso.', { action: 'profile' });
    return;
  }
  scheduleStreamRetry();
}

function armStallWatchdog() {
  clearTimeout(S.stallTimer);
  S.stallTimer = setTimeout(() => {
    const video = els.video;
    if (!S.active || video.paused || video.readyState >= 3) return;
    // A remux that stopped delivering data never recovers on its own; restart it where it froze.
    scheduleStreamRetry('La transmisión se detuvo y no se pudo recuperar.');
  }, STALL_RELOAD_MS);
}

function clearStallWatchdog() {
  clearTimeout(S.stallTimer);
  S.stallTimer = null;
}

// -------------------------------------------------------------------------------------------
// Media session (hardware keys, lock screen, Android notification)
// -------------------------------------------------------------------------------------------

function setupMediaSession() {
  if (!('mediaSession' in navigator) || !S.episode) return;
  const show = S.show || {};
  const art = S.episode.thumbnail_path || show.poster_path || show.backdrop_path;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: S.episode.title || episodeLabel(S.episode),
      artist: show.title || 'KuraStream',
      album: episodeLabel(S.episode),
      artwork: art ? [{ src: art, sizes: '512x512' }] : []
    });
    const handlers = {
      play: () => { if (canControlPlayback()) els.video.play().catch(() => {}); },
      pause: () => { if (canControlPlayback()) els.video.pause(); },
      seekbackward: () => { if (canControlPlayback()) seekBy(-SEEK_STEP); },
      seekforward: () => { if (canControlPlayback()) seekBy(SEEK_STEP); },
      seekto: details => { if (canControlPlayback() && Number.isFinite(details.seekTime)) seekTo(details.seekTime); },
      nexttrack: S.next ? () => playNextEpisode() : null,
      previoustrack: S.previous ? () => goToEpisode(S.previous) : null
    };
    Object.entries(handlers).forEach(([action, handler]) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ }
    });
  } catch { /* MediaMetadata unsupported */ }
}

function updateMediaPosition() {
  if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
  const duration = episodeDuration();
  if (!(duration > 0)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate: els.video.playbackRate || 1,
      position: Math.min(duration, Math.max(0, displayTime()))
    });
  } catch { /* invalid state while seeking */ }
}

function clearMediaSession() {
  if (!('mediaSession' in navigator)) return;
  ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'nexttrack', 'previoustrack'].forEach(action => {
    try { navigator.mediaSession.setActionHandler(action, null); } catch { /* unsupported */ }
  });
  try { navigator.mediaSession.metadata = null; } catch { /* unsupported */ }
}

// -------------------------------------------------------------------------------------------
// Event wiring
// -------------------------------------------------------------------------------------------

function bindVideoEvents() {
  const video = els.video;
  listen(video, 'loadstart', () => setLoading(true));
  listen(video, 'waiting', () => { setLoading(true); armStallWatchdog(); });
  listen(video, 'stalled', () => { if (!video.paused) armStallWatchdog(); });
  listen(video, 'seeking', () => setLoading(true));
  listen(video, 'seeked', () => setLoading(false));
  listen(video, 'canplay', () => { setLoading(false); clearStallWatchdog(); });
  listen(video, 'playing', () => {
    setLoading(false);
    clearStallWatchdog();
    S.retries = 0;
    hideError();
  });
  listen(video, 'loadedmetadata', () => {
    if (!(Number(S.episode.duration) > 0) && Number.isFinite(video.duration)) renderChapterTicks();
    renderProgress();
  });
  listen(video, 'play', () => {
    updatePlayState();
    hideEndScreen();
    scheduleHideControls();
    sendPartySync('play');
  });
  listen(video, 'pause', () => {
    updatePlayState();
    showControls();
    saveProgress(true);
    sendPartySync('pause');
  });
  listen(video, 'timeupdate', () => {
    if (S.pendingSeek !== null) return;
    const time = absoluteTime();
    if (video.readyState >= 2) S.lastKnownTime = time;
    renderProgress(time);
    renderBuffered();
    updateSkipIntro(time);
    updateUpNext(time);
  });
  listen(video, 'progress', renderBuffered);
  listen(video, 'ratechange', syncSettingsMenu);
  listen(video, 'volumechange', renderVolume);
  listen(video, 'error', handleVideoError);
  listen(video, 'ended', () => {
    const position = absoluteTime();
    const duration = Number(S.episode.duration) || 0;
    // A remux can report "ended" long before the episode does when the connection drops.
    if (!S.direct && duration > 0 && duration - position > 30) {
      scheduleStreamRetry('Se perdió la conexión con el video.');
      return;
    }
    // A guest that ran off the end while the host is still mid-episode (stale room state) re-aligns
    // instead of showing the end screen.
    if (partyManager.isInRoom() && !partyManager.isHost() && duration > 0) {
      const hostAt = partyManager.roomPositionNow();
      if (duration - hostAt > 30) {
        loadStream(hostAt, { autoplay: Boolean(partyManager.activeRoom && partyManager.activeRoom.is_playing) });
        return;
      }
    }
    saveProgress(true);
    updatePlayState();
    if (S.upNext.navigating) return;
    if (S.next && canAutoAdvance() && !S.upNext.dismissed) {
      goToEpisode(S.next);
    } else {
      showEndScreen();
    }
  });
}

function bindControls() {
  const on = (id, handler) => listen(els[id], 'click', event => {
    event.stopPropagation();
    // A mouse click leaves focus on the button and Space would press it again instead of pausing.
    if (event.detail > 0 && event.currentTarget instanceof HTMLElement) event.currentTarget.blur();
    handler(event);
  });

  on('player-back-btn', leavePlayer);
  on('play-pause-btn', togglePlay);
  on('center-play-pause-btn', togglePlay);
  on('rewind-btn', () => { if (canControlPlayback()) { seekBy(-SEEK_STEP); showSeekFeedback('left', '-10 s'); } });
  on('forward-btn', () => { if (canControlPlayback()) { seekBy(SEEK_STEP); showSeekFeedback('right', '+10 s'); } });
  on('center-rewind-btn', () => { if (canControlPlayback()) { seekBy(-SEEK_STEP); showSeekFeedback('left', '-10 s'); } });
  on('center-forward-btn', () => { if (canControlPlayback()) { seekBy(SEEK_STEP); showSeekFeedback('right', '+10 s'); } });
  on('mute-btn', toggleMute);
  on('next-ep-btn', playNextEpisode);
  on('episodes-btn', () => {
    if (els['player-episodes-panel'] && !els['player-episodes-panel'].hidden) closeEpisodesPanel();
    else openEpisodesPanel();
  });
  on('player-episodes-close', closeEpisodesPanel);
  on('player-tracks-btn', openTracks);
  on('more-options-btn', () => {
    if (els['more-options-menu']?.classList.contains('show')) closeSettingsMenu();
    else openSettingsMenu();
  });
  on('fullscreen-btn', toggleFullscreen);
  on('player-pip-btn', togglePictureInPicture);
  on('menu-pip-btn', togglePictureInPicture);
  on('menu-ambilight-btn', toggleAmbilight);
  on('menu-qr-btn', showQrShare);
  on('menu-file-info-btn', showFileInfo);
  on('menu-shortcuts-btn', () => toggleShortcuts(true));
  on('file-info-close', () => { els['file-info-modal'].hidden = true; });
  on('qr-share-close', () => { els['qr-share-modal'].hidden = true; });
  on('player-shortcuts-close', () => toggleShortcuts(false));
  on('skip-intro-btn', skipIntro);
  on('up-next-play', () => goToEpisode(S.next));
  on('up-next-dismiss', () => hideUpNext({ dismiss: true }));
  on('player-end-next', () => goToEpisode(S.next));
  on('player-end-replay', () => { hideEndScreen(); S.upNext.dismissed = false; loadStream(0, { autoplay: true }); });
  on('player-end-back', leavePlayer);
  on('player-error-back-btn', leavePlayer);
  on('player-resume-restart', () => {
    hideResumeToast();
    S.introSkipped = false;
    S.creditsSkipped = false;
    seekTo(0);
  });

  listen(els['player-shortcuts-modal'], 'click', event => {
    if (event.target === els['player-shortcuts-modal']) toggleShortcuts(false);
  });
  listen(els['player-episodes-seasons'], 'click', event => {
    const tab = event.target.closest('.player-season-tab');
    if (tab) renderEpisodesPanel(parseInt(tab.dataset.season, 10) || 0);
  });
  listen(els['player-episodes-list'], 'click', event => {
    const item = event.target.closest('.player-episode-item');
    if (!item) return;
    const episode = S.episodes.find(ep => ep.id === item.dataset.episodeId);
    if (!episode || episode.id === currentEpisodeId) {
      closeEpisodesPanel();
      return;
    }
    if (partyManager.isInRoom() && !partyManager.isHost()) {
      showHud('crown', 'El anfitrión elige el episodio');
      return;
    }
    goToEpisode(episode);
  });

  const menu = els['more-options-menu'];
  listen(menu, 'click', event => {
    event.stopPropagation();
    const speed = event.target.closest('.speed-opt');
    const boost = event.target.closest('.boost-opt');
    const preset = event.target.closest('.preset-opt');
    if (speed) setPlaybackRate(Number(speed.dataset.speed));
    else if (boost) setAudioBoost(Number(boost.dataset.boost));
    else if (preset) setAudioPreset(preset.dataset.preset, preset.textContent.trim());
  });

  // Clicking anywhere else closes the settings menu.
  listen(document, 'click', event => {
    if (!els['more-options-menu']?.classList.contains('show')) return;
    if (event.target.closest('#more-options-dropdown')) return;
    closeSettingsMenu();
  });

  // Volume slider
  const slider = els['volume-slider'];
  listen(slider, 'input', () => setVolume(Number(slider.value)));
  listen(slider, 'click', event => event.stopPropagation());

  // Keep controls up while the pointer rests on them.
  const bars = els.container.querySelectorAll('.player-top-bar, .player-bottom-bar, .player-more-menu, .player-panel');
  bars.forEach(bar => {
    listen(bar, 'pointerenter', () => els.container.classList.add('is-pointer-on-controls'));
    listen(bar, 'pointerleave', () => els.container.classList.remove('is-pointer-on-controls'));
  });

  listen(els.container, 'pointermove', event => {
    if (event.pointerType === 'mouse') showControls();
  });
  listen(els.container, 'mouseleave', () => {
    els.container.classList.remove('is-pointer-on-controls');
    hideControlsNow();
  });

  listen(document, 'fullscreenchange', renderFullscreenState);
  listen(document, 'webkitfullscreenchange', renderFullscreenState);

  // Persist progress when the tab is hidden or closed (the periodic save alone loses up to 10 s).
  listen(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveProgress(true);
  });
  listen(window, 'pagehide', () => saveProgress(true));
}

/** Timeline: click, drag (mouse and touch) and keyboard on the focused slider. */
function bindTimeline() {
  const bar = els['player-progress-bar'];
  if (!bar) return;
  const tooltip = els['player-progress-tooltip'];

  const positionAt = clientX => {
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / (rect.width || 1)));
  };
  const preview = ratio => {
    const time = ratio * episodeDuration();
    if (els['player-progress-hover']) els['player-progress-hover'].style.width = `${ratio * 100}%`;
    if (tooltip && !S.scrubPreview) {
      tooltip.textContent = formatTime(time);
      tooltip.style.left = `${ratio * 100}%`;
      tooltip.classList.add('is-visible');
    }
    return time;
  };

  let dragRatio = 0;
  listen(bar, 'pointerdown', event => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    event.stopPropagation();
    if (!canControlPlayback()) return;
    S.dragging = true;
    bar.setPointerCapture(event.pointerId);
    bar.classList.add('is-dragging');
    dragRatio = positionAt(event.clientX);
    const time = preview(dragRatio);
    els['player-progress-current'].style.width = `${dragRatio * 100}%`;
    els['player-progress-handle'].style.left = `${dragRatio * 100}%`;
    els['player-time-current'].textContent = formatTime(time);
    showControls();
  });
  listen(bar, 'pointermove', event => {
    const ratio = positionAt(event.clientX);
    preview(ratio);
    if (!S.dragging) return;
    dragRatio = ratio;
    els['player-progress-current'].style.width = `${ratio * 100}%`;
    els['player-progress-handle'].style.left = `${ratio * 100}%`;
    els['player-time-current'].textContent = formatTime(ratio * episodeDuration());
  });
  const finish = event => {
    if (!S.dragging) return;
    S.dragging = false;
    bar.classList.remove('is-dragging');
    try { bar.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    seekTo(dragRatio * episodeDuration());
    scheduleHideControls();
  };
  listen(bar, 'pointerup', finish);
  listen(bar, 'pointercancel', finish);
  listen(bar, 'pointerleave', () => {
    if (S.dragging) return;
    if (els['player-progress-hover']) els['player-progress-hover'].style.width = '0%';
    tooltip?.classList.remove('is-visible');
  });
  listen(bar, 'click', event => event.stopPropagation());
  listen(bar, 'keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      // Handled by the global shortcut handler (it shows the HUD); just keep focus here.
      return;
    }
    if (event.key === 'Home') { event.preventDefault(); seekTo(0); }
    if (event.key === 'End') { event.preventDefault(); seekTo(episodeDuration() - 5); }
  });
}

/**
 * Taps and clicks on the picture:
 *  - mouse: click toggles play, double click toggles fullscreen, hold = 2x speed;
 *  - touch: tap shows/hides the controls, double tap on the sides seeks (keeps seeking on
 *    further quick taps), hold = 2x speed.
 */
function bindSurfaceGestures() {
  const surface = els.video;
  const holdStart = () => {
    if (partyManager.isInRoom() || els.video.paused) return;
    S.hold.active = true;
    S.hold.previousRate = els.video.playbackRate;
    els.video.playbackRate = 2;
    els.container.classList.add('is-speed-hold');
    showHud('fast-forward', '2x');
  };
  const holdEnd = () => {
    clearTimeout(S.hold.timer);
    if (!S.hold.active) return false;
    S.hold.active = false;
    els.video.playbackRate = S.hold.previousRate || currentBaseRate();
    els.container.classList.remove('is-speed-hold');
    return true;
  };

  listen(surface, 'pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    S.tap.downAt = Date.now();
    S.tap.downX = event.clientX;
    S.tap.downY = event.clientY;
    S.tap.pointerType = event.pointerType;
    clearTimeout(S.hold.timer);
    S.hold.timer = setTimeout(holdStart, 550);
  });
  listen(surface, 'pointermove', event => {
    if (Math.hypot(event.clientX - S.tap.downX, event.clientY - S.tap.downY) > 24) clearTimeout(S.hold.timer);
  });
  listen(surface, 'pointercancel', holdEnd);
  listen(surface, 'contextmenu', event => { if (S.hold.active) event.preventDefault(); });
  listen(surface, 'pointerup', event => {
    const wasHold = holdEnd();
    if (wasHold) return;
    if (Math.hypot(event.clientX - S.tap.downX, event.clientY - S.tap.downY) > 24) return;
    if (overlayOpen()) {
      closeSettingsMenu();
      closeEpisodesPanel();
      return;
    }
    if (event.pointerType === 'mouse') {
      togglePlay();
      return;
    }
    handleTouchTap(event);
  });
  listen(surface, 'dblclick', event => {
    if (S.tap.pointerType !== 'mouse') return;
    event.preventDefault();
    toggleFullscreen();
  });
}

function handleTouchTap(event) {
  const now = Date.now();
  const rect = els.container.getBoundingClientRect();
  const ratio = (event.clientX - rect.left) / rect.width;
  const side = ratio < 0.35 ? 'left' : (ratio > 0.65 ? 'right' : null);

  const continuingStreak = side && S.tap.streakSide === side && now < S.tap.streakUntil;
  const isDoubleTap = side && now - S.tap.lastTime < 300 && Math.abs(event.clientX - S.tap.lastX) < 90;

  if ((continuingStreak || isDoubleTap) && canControlPlayback()) {
    if (!continuingStreak) S.tap.streakTotal = 0;
    const delta = side === 'left' ? -SEEK_STEP : SEEK_STEP;
    S.tap.streakTotal += delta;
    S.tap.streakSide = side;
    S.tap.streakUntil = now + 700;
    S.tap.lastTime = 0;
    seekBy(delta);
    showSeekFeedback(side, `${S.tap.streakTotal > 0 ? '+' : ''}${S.tap.streakTotal} s`);
    return;
  }

  S.tap.lastTime = now;
  S.tap.lastX = event.clientX;
  S.tap.streakSide = null;
  if (els.container.classList.contains('controls-hidden')) {
    showControls();
  } else if (!els.video.paused) {
    hideControlsNow();
  }
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = (target.tagName || '').toUpperCase();
  return target.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT' ||
    (tag === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(String(target.type).toLowerCase()));
}

function handleKeydown(event) {
  if (!S.active || event.defaultPrevented) return;
  if (event.key === 'Escape') {
    if (closeTopOverlay()) {
      event.preventDefault();
      return;
    }
    if (isFullscreen()) return; // the browser leaves fullscreen itself
    event.preventDefault();
    leavePlayer();
    return;
  }
  if (isTypingTarget(event.target) || event.ctrlKey || event.altKey || event.metaKey) return;
  // Let buttons and the track list react to Space/Enter themselves.
  const focusedButton = event.target && event.target.closest && event.target.closest('button, [role="radio"]');
  if (focusedButton && (event.key === 'Enter' || event.key === ' ') && focusedButton !== els['play-pause-btn']) return;
  if (isTracksModalOpen() && ['ArrowUp', 'ArrowDown'].includes(event.key)) return;

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const handled = () => { event.preventDefault(); showControls(); };

  switch (key) {
    case ' ':
    case 'k':
      handled();
      togglePlay();
      if (canControlPlayback(false)) showHud(els.video.paused ? 'pause' : 'play', els.video.paused ? 'Pausa' : 'Reproducir');
      return;
    case 'ArrowLeft':
    case 'j':
      handled();
      if (!canControlPlayback()) return;
      seekBy(-SEEK_STEP);
      showHud('rewind', '-10s');
      return;
    case 'ArrowRight':
    case 'l':
      handled();
      if (!canControlPlayback()) return;
      seekBy(SEEK_STEP);
      showHud('fast-forward', '+10s');
      return;
    case 'ArrowUp':
      handled();
      changeVolume(0.05);
      return;
    case 'ArrowDown':
      handled();
      changeVolume(-0.05);
      return;
    case 'm':
      handled();
      toggleMute();
      return;
    case 'f':
      handled();
      toggleFullscreen();
      return;
    case 'c':
      handled();
      cycleSubtitles();
      return;
    case 'n':
      handled();
      playNextEpisode();
      return;
    case 'b': {
      handled();
      const current = Math.round((S.audioEnhancer ? S.audioEnhancer.getGain() : 1) * 100);
      const next = BOOSTS[(BOOSTS.indexOf(current) + 1) % BOOSTS.length];
      setAudioBoost(next);
      return;
    }
    case 's':
    case '>':
    case '<': {
      handled();
      const index = SPEEDS.indexOf(currentBaseRateShown(els.video.playbackRate));
      const nextIndex = key === '<' ? Math.max(0, index - 1) : (key === '>' ? Math.min(SPEEDS.length - 1, index + 1) : (index + 1) % SPEEDS.length);
      setPlaybackRate(SPEEDS[nextIndex]);
      return;
    }
    case '?':
    case 'h':
      handled();
      toggleShortcuts();
      return;
    case 'Home':
      handled();
      if (canControlPlayback()) seekTo(0);
      return;
    case 'End':
      handled();
      if (canControlPlayback()) seekTo(episodeDuration() - 5);
      return;
    default:
      if (/^[0-9]$/.test(key)) {
        handled();
        if (!canControlPlayback()) return;
        const pct = Number(key) / 10;
        seekTo(pct * episodeDuration());
        showHud('skip-forward', `${Math.round(pct * 100)}%`);
      }
  }
}

function closeTopOverlay() {
  if (els['player-shortcuts-modal'] && !els['player-shortcuts-modal'].hidden) { toggleShortcuts(false); return true; }
  if (isTracksModalOpen()) { closeTracksModal(); return true; }
  if (els['more-options-menu']?.classList.contains('show')) { closeSettingsMenu(); return true; }
  if (els['player-episodes-panel'] && !els['player-episodes-panel'].hidden) { closeEpisodesPanel(); return true; }
  if (els['file-info-modal'] && !els['file-info-modal'].hidden) { els['file-info-modal'].hidden = true; return true; }
  if (els['qr-share-modal'] && !els['qr-share-modal'].hidden) { els['qr-share-modal'].hidden = true; return true; }
  return false;
}

// -------------------------------------------------------------------------------------------
// Watch party
// -------------------------------------------------------------------------------------------

const REACTIONS = {
  flame: 'flame', heart: 'heart', smile: 'smile', sparkles: 'sparkles', 'thumbs-up': 'thumbs-up'
};

function renderPartyMessage(msg) {
  const container = els['party-messages-container'];
  if (!container || !msg || msg.type === 'reaction') return;
  if (msg.id !== undefined && msg.id !== null) {
    if (S.seenMessageIds.has(msg.id)) return;
    S.seenMessageIds.add(msg.id);
  }
  const item = document.createElement('div');
  if (msg.type === 'system') {
    item.className = 'party-msg-item is-system';
    item.textContent = msg.message || '';
  } else {
    const name = msg.username || 'Invitado';
    const isHost = partyManager.activeRoom && name === partyManager.activeRoom.host_user;
    const isMine = name === partyManager.currentUser.username;
    const time = new Date(msg.created_at ? String(msg.created_at).replace(' ', 'T') : Date.now());
    const clock = Number.isNaN(time.getTime()) ? '' : time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    item.className = `party-msg-item${isMine ? ' is-mine' : ''}`;
    item.innerHTML = `
      <span class="party-msg-avatar" style="background:${escapeHtml(partyManager.getRandomColor(name))}">${escapeHtml(name.charAt(0).toUpperCase())}</span>
      <div class="party-msg-content">
        <div class="party-msg-meta"><span class="party-msg-author">${escapeHtml(name)}</span>${isHost ? `<span class="party-msg-host">${iconSvg('crown', { size: 12 })}</span>` : ''}<span class="party-msg-time">${escapeHtml(clock)}</span></div>
        <div class="party-msg-bubble">${escapeHtml(msg.message || '')}</div>
      </div>`;
  }
  container.appendChild(item);
  while (container.children.length > 150) container.removeChild(container.firstChild);
  container.scrollTop = container.scrollHeight;
}

function renderPartyRoom(room) {
  if (!room) return;
  if (els['player-party-sidebar']) els['player-party-sidebar'].hidden = false;
  els.container.classList.add('has-party');
  if (els['party-header-title']) els['party-header-title'].textContent = room.name || 'Watch Party';
  if (els['party-room-code-display']) els['party-room-code-display'].textContent = room.id;
  if (els['party-host-badge']) {
    els['party-host-badge'].innerHTML = partyManager.isHost()
      ? `${iconSvg('crown', { size: 13 })} Anfitrión`
      : `${iconSvg('crown', { size: 13 })} ${escapeHtml(room.host_user || 'Anfitrión')}`;
  }
  setIcon(els['party-sound-icon'], partyManager.soundsMuted ? 'volume-x' : 'volume-2', { size: 16 });
}

function bindParty() {
  const sidebar = els['player-party-sidebar'];
  const copyInvite = event => {
    event.stopPropagation();
    if (!partyManager.activeRoom) return;
    const roomId = partyManager.activeRoom.id;
    const url = `${window.location.origin}/#/party/${encodeURIComponent(roomId)}`;
    const done = () => showToast(`Enlace de invitación copiado (${roomId})`);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(done).catch(() => showToast(`Código de sala: ${roomId}`, 5000));
    } else {
      showToast(`Código de sala: ${roomId}`, 5000);
    }
  };

  listen(els['player-party-btn'], 'click', event => {
    event.stopPropagation();
    if (!partyManager.isInRoom()) {
      if (typeof window.openWatchPartyModal === 'function') window.openWatchPartyModal('create');
      return;
    }
    sidebar.hidden = !sidebar.hidden;
    els.container.classList.toggle('has-party', !sidebar.hidden);
  });
  listen(els['party-btn-close-sidebar'], 'click', event => {
    event.stopPropagation();
    sidebar.hidden = true;
    els.container.classList.remove('has-party');
  });
  listen(els['party-sound-toggle'], 'click', event => {
    event.stopPropagation();
    partyManager.toggleSounds();
    setIcon(els['party-sound-icon'], partyManager.soundsMuted ? 'volume-x' : 'volume-2', { size: 16 });
  });
  listen(els['party-btn-copy-code'], 'click', copyInvite);
  listen(els['party-btn-copy-cta'], 'click', copyInvite);
  listen(els['party-room-code-display'], 'click', copyInvite);
  listen(els['party-btn-leave'], 'click', async event => {
    event.stopPropagation();
    if (!window.confirm('¿Salir del Watch Party?')) return;
    await partyManager.leaveRoom();
  });
  listen(els['party-input-form'], 'submit', event => {
    event.preventDefault();
    const text = els['party-chat-input'].value.trim();
    if (!text) return;
    els['party-chat-input'].value = '';
    partyManager.sendMessage(text).catch(() => showToast('No se pudo enviar el mensaje.'));
  });
  els.container.querySelectorAll('.party-reaction-btn').forEach(button => {
    listen(button, 'click', event => {
      event.stopPropagation();
      const reaction = button.dataset.reaction;
      if (REACTIONS[reaction]) partyManager.sendReaction(reaction);
    });
  });

  const handlers = {
    sync: room => {
      if (!room || !S.active) return;
      renderPartyRoom(room);
      if (room.episode_id && room.episode_id !== currentEpisodeId) {
        if (!partyManager.isHost()) {
          showToast('El anfitrión cambió de episodio');
          location.hash = playerHash(room.episode_id);
        }
        return;
      }
      partyManager.applyRemotePlaybackToVideo(els.video, {
        offset: S.offset,
        isDirect: S.direct,
        seekAbsolute: time => loadStream(time, { autoplay: Boolean(room.is_playing) })
      });
    },
    message: renderPartyMessage,
    closed: () => {
      if (sidebar) sidebar.hidden = true;
      els.container.classList.remove('has-party');
      els.video.playbackRate = currentBaseRate();
      clearInterval(S.heartbeatTimer);
      showToast('Saliste del Watch Party');
    }
  };
  Object.entries(handlers).forEach(([event, handler]) => partyManager.on(event, handler));
  S.partyHandlers = handlers;

  if (partyManager.isInRoom()) {
    renderPartyRoom(partyManager.activeRoom);
    // The history arrived with the join, before this player existed: show it now (already-seen ids are skipped).
    partyManager.messageLog.forEach(renderPartyMessage);
  } else if (sidebar) {
    sidebar.hidden = true;
  }

  // The host keeps the room clock fresh so late joiners and drift correction have a recent anchor.
  clearInterval(S.heartbeatTimer);
  S.heartbeatTimer = setInterval(() => {
    if (S.active && partyManager.isInRoom() && partyManager.isHost() && !els.video.paused) sendPartySync('heartbeat');
  }, 10000);
}

function unbindParty() {
  clearInterval(S.heartbeatTimer);
  S.heartbeatTimer = null;
  if (!S.partyHandlers) return;
  Object.entries(S.partyHandlers).forEach(([event, handler]) => partyManager.off(event, handler));
  S.partyHandlers = null;
}

// -------------------------------------------------------------------------------------------
// Lifecycle
// -------------------------------------------------------------------------------------------

async function fetchShowWithEpisodes(episodeId) {
  const showId = getShowIdFromEpisodeId(episodeId);
  const res = await fetch(showApiUrl(showId));
  if (!res.ok) throw new Error(res.status === 404 ? 'Este título ya no está en la biblioteca.' : `Error ${res.status} al cargar el título.`);
  const data = await res.json();
  const show = data.show || data;
  const episodes = Array.isArray(data.episodes) ? data.episodes : (Array.isArray(show.episodes) ? show.episodes : []);
  let episode = episodes.find(ep => ep.id === episodeId);
  if (!episode) {
    const epRes = await fetch(`/api/episodes/${encodeURIComponent(episodeId)}`);
    if (epRes.ok) episode = await epRes.json();
  }
  if (!episode) throw new Error('No encontramos este episodio.');
  return { show, episodes, episode };
}

function resetUi() {
  hideError();
  hideUpNext();
  hideEndScreen();
  hideResumeToast();
  closeSettingsMenu();
  closeEpisodesPanel();
  closeTracksModal();
  if (els['skip-intro-btn']) els['skip-intro-btn'].hidden = true;
  if (els['file-info-modal']) els['file-info-modal'].hidden = true;
  if (els['qr-share-modal']) els['qr-share-modal'].hidden = true;
  if (els['player-shortcuts-modal']) els['player-shortcuts-modal'].hidden = true;
  if (els['player-progress-buffered']) els['player-progress-buffered'].style.width = '0%';
  if (els['player-episodes-list']) els['player-episodes-list'].innerHTML = '';
  if (els['party-messages-container'] && !partyManager.isInRoom()) els['party-messages-container'].innerHTML = '';
  els.container.classList.remove('controls-hidden', 'is-speed-hold', 'is-pointer-on-controls');
  els['player-progress-bar']?.querySelectorAll('.seekbar-chapter-tick').forEach(t => t.remove());
  renderProgress(0);
}

function initStaticIcons() {
  const icons = {
    'player-back-btn': 'arrow-left',
    'center-rewind-btn': 'rotate-ccw',
    'center-forward-btn': 'rotate-cw',
    'rewind-btn': 'rotate-ccw',
    'forward-btn': 'rotate-cw',
    'episodes-btn': 'list-video',
    'player-tracks-btn': 'subtitles',
    'more-options-btn': 'settings',
    'player-party-btn': 'users',
    'player-pip-btn': 'picture-in-picture-2'
  };
  Object.entries(icons).forEach(([id, name]) => {
    const button = els[id];
    if (!button) return;
    let slot = button.querySelector('.player-btn-icon');
    if (!slot) {
      slot = document.createElement('span');
      slot.className = 'player-btn-icon';
      button.prepend(slot);
    }
    setIcon(slot, name);
  });
  const nextIcon = els['next-ep-btn']?.querySelector('.player-btn-icon');
  setIcon(nextIcon, 'skip-forward');
  hydrateIcons(els.container);
}

export async function initPlayer(rawEpisodeId) {
  const episodeId = String(rawEpisodeId || '');
  if (S.active) destroyPlayer();
  const generation = ++playerInitGeneration;
  currentEpisodeId = episodeId;

  cacheElements();
  if (!els.video || !els.container) return;
  S.active = true;
  S.abort = new AbortController();
  S.episode = null;
  S.retries = 0;
  S.lastSavedAt = -1;
  S.introSkipped = false;
  S.creditsSkipped = false;
  S.pendingSeek = null;
  S.upNext = { shown: false, dismissed: false, navigating: false, seconds: 0, timer: null };
  S.endedShown = false;
  S.seenMessageIds = new Set();

  resetUi();
  initStaticIcons();
  setLoading(true);
  if (els['player-show-title']) els['player-show-title'].textContent = '';
  if (els['player-episode-title']) els['player-episode-title'].textContent = 'Cargando…';

  let loaded;
  try {
    loaded = await fetchShowWithEpisodes(episodeId);
  } catch (err) {
    if (generation !== playerInitGeneration) return;
    showError('No se pudo abrir el episodio', err.message || 'Inténtalo de nuevo.', { action: 'retry' });
    els['player-error-retry-btn'].onclick = () => initPlayer(episodeId);
    return;
  }
  if (generation !== playerInitGeneration || !S.active) return;

  S.show = loaded.show;
  S.episodes = loaded.episodes.length ? loaded.episodes : [loaded.episode];
  S.episode = loaded.episode;
  S.duration = Number(S.episode.duration) || 0;
  const adjacent = findAdjacentEpisodes(S.episodes, episodeId);
  S.next = adjacent.next;
  S.previous = adjacent.previous;

  // Tracks: explicit pick from the episode modal, then the profile/language preferences.
  const audioTracks = parseTrackList(S.episode.audio_tracks);
  let explicitAudio = null;
  try {
    if (sessionStorage.getItem('kura_play_audio_ep') === episodeId) explicitAudio = sessionStorage.getItem('kura_play_audio_track');
    sessionStorage.removeItem('kura_play_audio_ep');
    sessionStorage.removeItem('kura_play_audio_track');
  } catch { /* storage blocked */ }
  const prefs = window.userPreferences || {};
  const { audio: prefAudio, subtitle: prefSub } = readLanguagePrefs(localStorage, prefs);
  S.audioTrack = chooseAudioTrack(audioTracks, { explicit: explicitAudio, preferred: prefAudio });
  const audioInfo = audioTracks.find((t, i) => trackNumber(t, i) === S.audioTrack);
  const subtitleTracks = parseTrackList(S.episode.subtitle_tracks);
  S.subtitleTrack = chooseSubtitleTrack(subtitleTracks, { preferred: prefSub, audioLang: detectTrackLang(audioInfo) });
  S.lastSubtitleTrack = S.subtitleTrack !== -1 ? S.subtitleTrack : (subtitleTracks.filter(t => !isBitmapSubtitle(t)).map((t, i) => trackNumber(t, i))[0] ?? -1);
  S.direct = isDirectPlayable(S.episode, S.audioTrack);

  renderTitles();
  renderChapterTicks();
  if (els['next-ep-btn']) els['next-ep-btn'].hidden = !S.next;
  if (els['episodes-btn']) els['episodes-btn'].hidden = S.episodes.length < 2;
  const pipSupported = document.pictureInPictureEnabled || typeof els.video.webkitSetPresentationMode === 'function';
  if (els['menu-pip-btn']) els['menu-pip-btn'].hidden = !pipSupported;
  if (els['player-pip-btn']) els['player-pip-btn'].hidden = !pipSupported;
  if (els['menu-ambilight-btn']) els['menu-ambilight-btn'].hidden = isPerfLite();

  // Volume and speed survive between sessions.
  const savedVolume = parseFloat(readPref('playerVolume', '1'));
  els.video.volume = Number.isFinite(savedVolume) && savedVolume > 0 ? Math.min(1, savedVolume) : 1;
  els.video.muted = readPref('kura_player_muted') === '1';
  renderVolume();
  renderFullscreenState();
  updatePlayState();

  bindVideoEvents();
  bindControls();
  bindTimeline();
  bindSurfaceGestures();
  listen(document, 'keydown', handleKeydown);
  bindParty();

  // Boost / EQ chosen in Ajustes apply from the first frame; otherwise no Web Audio graph is built.
  // An AudioContext created before any click starts suspended and, with the video routed through it, plays in
  // silence (a link that autoplays with boost/EQ on). Build the graph on the first gesture instead.
  if (Number(readPref('kura_audio_boost', '100')) !== 100 || readPref('kura_audio_preset', 'flat') !== 'flat') {
    ['pointerdown', 'keydown', 'touchstart'].forEach((type) => {
      listen(document, type, () => { if (S.active) ensureAudioEnhancer(); }, { once: true, capture: true, passive: true });
    });
  }

  if (S.direct && window.matchMedia('(hover: hover)').matches) {
    S.scrubPreview = initScrubPreview(els['player-progress-bar'], els.video, { canDirectPlay: true, duration: S.duration, src: buildStreamUrl(0) });
  } else {
    S.scrubPreview = null;
  }

  setupMediaSession();
  applyAmbilight();

  const resume = await loadResumePosition(episodeId);
  if (generation !== playerInitGeneration || !S.active) return;
  let start = resume.time >= 10 && (!S.duration || resume.time < S.duration - 30) ? resume.time : 0;
  if (resume.source === 'link') start = resume.time;

  // A watch-party guest starts where the room is.
  if (partyManager.isInRoom() && !partyManager.isHost() && partyManager.activeRoom && partyManager.activeRoom.episode_id === episodeId) {
    start = partyManager.roomPositionNow();
    if (S.duration > 0) start = Math.min(start, Math.max(0, S.duration - 5));
  }

  // The host announces the new episode before asking for its stream: guests learn about the change right away
  // instead of after the host's (possibly slow) stream setup, and a busy server cannot swallow the announcement.
  if (partyManager.isInRoom() && partyManager.isHost() && partyManager.activeRoom && partyManager.activeRoom.episode_id !== episodeId) {
    partyManager.sendPlaybackSync(true, start, episodeId, 'episode_change');
  }

  const autoplay = !partyManager.isInRoom() || partyManager.isHost() || Boolean(partyManager.activeRoom && partyManager.activeRoom.is_playing);
  loadStream(start, { autoplay });
  if (start > 0 && resume.source === 'history' && !partyManager.isInRoom()) showResumeToast(start);
  if (S.subtitleTrack !== -1) applySubtitleTrack(S.subtitleTrack);

  clearInterval(S.saveTimer);
  S.saveTimer = setInterval(() => {
    if (!els.video.paused) {
      saveProgress();
      updateMediaPosition();
    }
  }, PROGRESS_SAVE_MS);

  showControls();
}

export function destroyPlayer() {
  if (!S.active && !S.abort) return;
  saveProgress(true);
  S.active = false;
  playerInitGeneration++;
  if (S.abort) S.abort.abort();
  S.abort = null;

  [S.seekTimer, S.hideTimer, S.retryTimer, S.stallTimer, S.hudTimer, S.toastTimer, S.resumeTimer, S.hold.timer]
    .forEach(timer => clearTimeout(timer));
  clearInterval(S.saveTimer);
  clearInterval(S.upNext.timer);
  clearInterval(S.ambilightTimer);
  S.saveTimer = S.ambilightTimer = null;
  S.pendingSeek = null;
  S.dragging = false;
  S.hold.active = false;

  unbindParty();
  destroySubtitles();
  closeTracksModal();
  if (S.scrubPreview) {
    S.scrubPreview.destroy();
    S.scrubPreview = null;
  }
  if (S.audioEnhancer) {
    S.audioEnhancer.destroy();
    S.audioEnhancer = null;
  }
  clearMediaSession();

  const video = els.video;
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.playbackRate = 1;
  }
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  if (els.container) {
    els.container.classList.remove('controls-hidden', 'is-loading', 'is-speed-hold', 'has-party', 'is-pointer-on-controls');
  }
  document.title = 'KuraStream - Entretenimiento Offline';
  currentEpisodeId = null;
}
