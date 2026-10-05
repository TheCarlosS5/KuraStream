/**
 * Home hero: up to five titles that rotate on their own (crossfade), with arrows, swipe,
 * keyboard and progress indicators. Only the visible slide and the next one load their
 * artwork, and rotation stops while the pointer rests on it, the tab is hidden or the
 * dashboard is not on screen.
 */
import { iconSvg } from '../core/icons.js';

const SLIDE_MS = 8000;
const MAX_SLIDES = 5;

let state = null;

/** Titles for the hero: featured first, then a daily rotation of the best candidates. */
export function pickHeroShows(shows, limit = MAX_SLIDES) {
  const withArt = shows.filter(show => show && (show.backdrop_path || show.poster_path));
  const featured = withArt.filter(show => show.is_featured && show.backdrop_path);
  const now = Date.now();
  const score = show => {
    const rating = Number(show.rating) || 0;
    const added = Date.parse(String(show.created_at || '').replace(' ', 'T'));
    const recent = Number.isFinite(added) && now - added < 14 * 86400000 ? 2 : 0;
    const airing = show.status === 'airing' ? 1 : 0;
    const backdrop = show.backdrop_path ? 3 : 0;
    return rating + recent + airing + backdrop;
  };
  const rest = withArt
    .filter(show => !featured.includes(show))
    .sort((a, b) => score(b) - score(a))
    .slice(0, Math.max(limit * 2, limit));
  // Same order all day, a different set of five the next day.
  const day = Math.floor(now / 86400000);
  const offset = rest.length ? day % rest.length : 0;
  const rotated = rest.slice(offset).concat(rest.slice(0, offset));
  return featured.concat(rotated).slice(0, limit);
}

function slideImage(slide) {
  const img = slide && slide.querySelector('img[data-src]');
  if (img) {
    img.src = img.dataset.src;
    img.removeAttribute('data-src');
  }
}

function goTo(index, { user = false } = {}) {
  if (!state) return;
  const { slides, dots } = state;
  const count = slides.length;
  state.index = (index + count) % count;
  slides.forEach((slide, i) => {
    const active = i === state.index;
    slide.classList.toggle('is-active', active);
    slide.setAttribute('aria-hidden', active ? 'false' : 'true');
    slide.querySelectorAll('a, button').forEach(el => { el.tabIndex = active ? 0 : -1; });
  });
  dots.forEach((dot, i) => {
    const active = i === state.index;
    dot.classList.toggle('is-active', active);
    dot.setAttribute('aria-current', active ? 'true' : 'false');
    // Restart the progress fill animation on the newly active dot.
    const fill = dot.querySelector('.hero-dot-fill');
    if (fill && active) {
      fill.style.animation = 'none';
      void fill.offsetWidth;
      fill.style.animation = '';
    }
  });
  slideImage(slides[state.index]);
  slideImage(slides[(state.index + 1) % count]);
  if (user) restart();
}

function canRotate() {
  return state && state.slides.length > 1 && !state.hovered && !state.focused && !document.hidden &&
    state.root.offsetParent !== null && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function restart() {
  if (!state) return;
  clearTimeout(state.timer);
  const running = canRotate();
  state.root.classList.toggle('is-paused', !running);
  if (!running) return;
  state.timer = setTimeout(() => {
    goTo(state.index + 1);
    restart();
  }, SLIDE_MS);
}

export function destroyHeroCarousel() {
  if (!state) return;
  clearTimeout(state.timer);
  state.abort.abort();
  state = null;
}

/**
 * Mounts the carousel. `renderSlide(show, index)` returns the markup of one slide.
 */
export function mountHeroCarousel(container, shows, renderSlide) {
  destroyHeroCarousel();
  const wrapper = container.querySelector('#hero-carousel-wrapper');
  const indicators = container.querySelector('#carousel-indicators');
  const prev = container.querySelector('#carousel-prev-btn');
  const next = container.querySelector('#carousel-next-btn');
  if (!wrapper || !shows.length) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  wrapper.innerHTML = shows.map((show, index) => renderSlide(show, index)).join('');
  const slides = [...wrapper.querySelectorAll('.billboard-hero')];
  const multiple = slides.length > 1;
  container.classList.toggle('has-multiple', multiple);

  if (indicators) {
    indicators.innerHTML = multiple ? shows.map((show, index) => `
      <button type="button" class="hero-dot" data-index="${index}" aria-label="${index + 1} de ${shows.length}">
        <span class="hero-dot-fill" style="animation-duration:${SLIDE_MS}ms"></span>
      </button>`).join('') : '';
  }
  if (prev) prev.innerHTML = iconSvg('chevron-left', { size: 28 });
  if (next) next.innerHTML = iconSvg('chevron-right', { size: 28 });

  const abort = new AbortController();
  const opts = { signal: abort.signal };
  state = {
    root: container,
    slides,
    dots: indicators ? [...indicators.querySelectorAll('.hero-dot')] : [],
    index: 0,
    timer: null,
    hovered: false,
    focused: false,
    abort
  };

  prev?.addEventListener('click', () => goTo(state.index - 1, { user: true }), opts);
  next?.addEventListener('click', () => goTo(state.index + 1, { user: true }), opts);
  indicators?.addEventListener('click', event => {
    const dot = event.target.closest('.hero-dot');
    if (dot) goTo(Number(dot.dataset.index), { user: true });
  }, opts);

  container.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'mouse') return;
    state.hovered = true;
    restart();
  }, opts);
  container.addEventListener('pointerleave', () => {
    state.hovered = false;
    restart();
  }, opts);
  container.addEventListener('focusin', () => { state.focused = true; restart(); }, opts);
  container.addEventListener('focusout', event => {
    if (!container.contains(event.relatedTarget)) {
      state.focused = false;
      restart();
    }
  }, opts);
  container.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') goTo(state.index - 1, { user: true });
    if (event.key === 'ArrowRight') goTo(state.index + 1, { user: true });
  }, opts);
  document.addEventListener('visibilitychange', restart, opts);
  window.addEventListener('hashchange', restart, opts);

  // Horizontal swipe on touch screens.
  let startX = null;
  let startY = null;
  wrapper.addEventListener('touchstart', event => {
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
  }, { passive: true, signal: abort.signal });
  wrapper.addEventListener('touchend', event => {
    if (startX === null) return;
    const dx = event.changedTouches[0].clientX - startX;
    const dy = event.changedTouches[0].clientY - startY;
    startX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) goTo(state.index + (dx < 0 ? 1 : -1), { user: true });
  }, { passive: true, signal: abort.signal });

  goTo(0);
  restart();
}
