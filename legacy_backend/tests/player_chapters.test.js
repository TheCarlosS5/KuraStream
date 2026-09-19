import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { formatChapterTime, renderChapterTicks, renderChaptersDropdown } from '../frontend/player.js';

test('style.css contains styles for skip intro button, seekbar chapter ticks, and chapters dropdown', () => {
  const cssPath = path.join(process.cwd(), 'frontend', 'style.css');
  const content = fs.readFileSync(cssPath, 'utf8');

  assert.ok(content.includes('.skip-intro-btn'), 'style.css must include .skip-intro-btn rule');
  assert.ok(content.includes('.seekbar-chapter-tick'), 'style.css must include .seekbar-chapter-tick rule');
  assert.ok(content.includes('.chapters-btn'), 'style.css must include .chapters-btn rule');
  assert.ok(content.includes('.chapters-dropdown'), 'style.css must include .chapters-dropdown rule');
  assert.ok(content.includes('.chapters-dropdown-menu'), 'style.css must include .chapters-dropdown-menu rule');
  assert.ok(content.includes('.chapter-item'), 'style.css must include .chapter-item rule');
});

test('index.html contains chapter dropdown container and skip intro overlay button', () => {
  const indexPath = path.join(process.cwd(), 'frontend', 'index.html');
  const content = fs.readFileSync(indexPath, 'utf8');

  assert.ok(content.includes('id="chapters-dropdown-container"'), 'index.html must include chapters dropdown container');
  assert.ok(content.includes('id="chapters-btn"'), 'index.html must include chapters button');
  assert.ok(content.includes('id="chapters-menu-list"'), 'index.html must include chapters menu list');
  assert.ok(content.includes('id="skip-intro-btn"'), 'index.html must include skip intro button');
});

test('formatChapterTime formats timestamps correctly into MM:SS or H:MM:SS', () => {
  assert.equal(formatChapterTime(0), '00:00');
  assert.equal(formatChapterTime(90), '01:30');
  assert.equal(formatChapterTime(1200), '20:00');
  assert.equal(formatChapterTime(3665), '1:01:05');
  assert.equal(formatChapterTime(null), '00:00');
});

test('renderChapterTicks appends tick marks to seekbar element', () => {
  // Create mock progress bar DOM node
  const ticks = [];
  const mockProgressBar = {
    children: [],
    querySelectorAll: (selector) => {
      if (selector === '.seekbar-chapter-tick') {
        return ticks;
      }
      return [];
    },
    appendChild: (el) => {
      ticks.push(el);
    }
  };

  // Mock global document
  globalThis.document = globalThis.document || {};
  const origCreateElement = globalThis.document.createElement;
  const origGetElementById = globalThis.document.getElementById;

  globalThis.document.getElementById = (id) => {
    if (id === 'player-progress-bar') return mockProgressBar;
    return null;
  };

  globalThis.document.createElement = (tag) => {
    const attrs = {};
    const style = {};
    return {
      tagName: tag.toUpperCase(),
      className: '',
      style,
      setAttribute: (k, v) => { attrs[k] = v; },
      getAttribute: (k) => attrs[k],
      remove: () => {}
    };
  };

  const episodeData = {
    duration: 1000,
    chapters: [
      { title: 'Intro', start: 0, end: 90 },
      { title: 'Episodio', start: 90, end: 900 },
      { title: 'Outro', start: 900, end: 1000 }
    ]
  };

  renderChapterTicks(episodeData);

  // Restore original document helpers
  if (origCreateElement) {
    globalThis.document.createElement = origCreateElement;
  } else {
    delete globalThis.document.createElement;
  }
  if (origGetElementById) {
    globalThis.document.getElementById = origGetElementById;
  } else {
    delete globalThis.document.getElementById;
  }

  assert.ok(ticks.length >= 3, 'Should render at least 3 chapter tick marks');
  assert.equal(ticks[0].style.left, '0%');
  assert.equal(ticks[1].style.left, '9%');
  assert.equal(ticks[2].style.left, '90%');
});

test('renderChaptersDropdown populates chapter menu items with formatted timestamps', () => {
  let menuHtml = '';
  let containerStyle = { display: 'none' };
  let clickListeners = [];

  const mockMenuList = {
    set innerHTML(html) { menuHtml = html; },
    get innerHTML() { return menuHtml; },
    querySelectorAll: (selector) => {
      return [{
        textContent: '00:00 - Intro',
        getAttribute: (k) => k === 'data-start' ? '0' : null,
        set onclick(fn) { clickListeners.push(fn); }
      }];
    }
  };

  const mockContainer = {
    style: containerStyle,
    classList: { remove: () => {} }
  };

  // Mock document.getElementById
  globalThis.document = globalThis.document || {};
  const origGetElementById = globalThis.document.getElementById;
  globalThis.document.getElementById = (id) => {
    if (id === 'chapters-dropdown-container') return mockContainer;
    if (id === 'chapters-menu-list') return mockMenuList;
    return null;
  };

  const episodeData = {
    duration: 1290,
    chapters: [
      { title: 'Intro', start: 0, end: 90 },
      { title: 'Episodio', start: 90, end: 1200 },
      { title: 'Outro', start: 1200, end: 1290 }
    ]
  };

  renderChaptersDropdown(episodeData);

  if (origGetElementById) {
    globalThis.document.getElementById = origGetElementById;
  } else {
    delete globalThis.document.getElementById;
  }

  assert.equal(mockContainer.style.display, '', 'Chapters container should be visible');
  assert.ok(menuHtml.includes('00:00 - Intro'), 'Chapters menu should render 00:00 - Intro');
  assert.ok(menuHtml.includes('01:30 - Episodio'), 'Chapters menu should render 01:30 - Episodio');
  assert.ok(menuHtml.includes('20:00 - Outro'), 'Chapters menu should render 20:00 - Outro');
});

test('player.js contains auto-skip outro jump and intro rewind flag reset logic', () => {
  const playerPath = path.join(process.cwd(), 'frontend', 'player.js');
  const content = fs.readFileSync(playerPath, 'utf8');

  assert.ok(content.includes('hasSkippedIntroForCurrentEpisode = false;'), 'player.js must reset intro skip flag on rewind');
  assert.ok(content.includes('loadVideoStream(Math.max(0, duration - 1))'), 'player.js must seek to duration - 1s on auto-skip outro');
});

