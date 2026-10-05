import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const app = fs.readFileSync(new URL('../frontend/js/main.js', import.meta.url), 'utf8');
const player = fs.readFileSync(new URL('../frontend/player.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../frontend/style.css', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../frontend/sw.js', import.meta.url), 'utf8');
const nav = fs.readFileSync(new URL('../frontend/js/modules/navigation.js', import.meta.url), 'utf8');
const catalogMod = fs.readFileSync(new URL('../frontend/js/modules/catalog.js', import.meta.url), 'utf8');
function evaluate(source, name, context) {
  const fn = source.match(new RegExp(`(?:export )?(?:async )?function ${name}\\([^\\n]*\\{[\\s\\S]*?^\\}`, 'm'));
  assert.ok(fn, `Missing ${name}`);
  vm.runInContext(fn[0].replace(/^export /, ''), context);
}

test('notification metadata stays in text and quoted attributes, with encoded routes', async () => {
  const attack = `<img src=x onerror=alert(1)>"'&`;
  const ids = `show?part/one"'`;
  const list = { innerHTML: '', querySelectorAll: () => [] };
  const context = vm.createContext({ URL, console, document: { getElementById: key => key === 'notifications-list' ? list : null }, getUserAndProfile: () => ({ activeUser: 'user', profileName: 'profile', hasProfile: true, token: 'test-token' }), fetch: async () => ({ ok: true, json: async () => [{ show_id: ids, episode_id: ids, show_title: attack, episode_number: attack, season_number: attack, message: attack, poster_path: 'javascript:alert(1)' }, { show_id: ids, title: attack, poster_path: attack }] }) });
  for (const name of ['escapeHtml', 'escapeHtmlAttribute', 'catalogueImageUrl', 'loadNotifications']) evaluate(app, name, context);
  await context.loadNotifications();
  assert.ok(!list.innerHTML.includes('<img src=x'), 'No injected elements');
  assert.ok(!list.innerHTML.includes('javascript:'), 'No executable poster URL');
  assert.ok(list.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&#039;&amp;'));
  assert.ok(list.innerHTML.includes('href="#/player/show%3Fpart%2Fone%22&#039;"'));
  assert.ok(list.innerHTML.includes('href="#/show/show%3Fpart%2Fone%22&#039;"'));
  assert.ok(list.innerHTML.includes('data-show-id="show?part/one&quot;&#039;"'));
});

test('router decodes IDs only after separating the actual query string', () => {
  for (const kind of ['show', 'player']) {
    let received;
    const context = vm.createContext({ console, window: { location: { hash: `#/${kind}/Show%3Fpart%2Fone_S1_E1?t=42` }, addEventListener() {} }, document: { querySelector: () => ({ style: { removeProperty() {} } }), querySelectorAll: () => [], getElementById: () => null }, updateMosaicBgVisibility() {}, updateActiveNavHighlight() {}, resetChameleonTheme() {}, currentView: '', loadShowDetails: id => { received = id; }, initPlayer: id => { received = id; } });
    evaluate(app, 'setupRouter', context);
    context.setupRouter();
    assert.equal(received, 'Show?part/one_S1_E1');
  }
});

for (const entry of ['code', 'modal']) {
  test(`watch-party ${entry} join preserves question marks, slashes and percent signs through the router`, async () => {
    for (const [episodeId, expectedHash] of [
      ['Show?part/100%_S1_E1', '#/player/Show%3Fpart%2F100%25_S1_E1'],
      ['literal%2Fname_S1_E1', '#/player/literal%252Fname_S1_E1']
    ]) {
      let received;
      const nodes = {
        'modal-watch-party': { style: {} },
        'party-join-submit-btn': {},
        'party-join-code-input': { value: 'ROOM' },
        'party-join-name-input': { value: 'Viewer' }
      };
      const context = vm.createContext({
        console,
        window: { location: { hash: '' }, addEventListener() {} },
        document: { getElementById: key => nodes[key] || null, addEventListener() {} },
        partyManager: { joinRoom: async () => ({ episode_id: episodeId }) },
        showToast() {},
        alert: message => { throw new Error(message); },
        updateMosaicBgVisibility() {}, updateActiveNavHighlight() {}, resetChameleonTheme() {},
        currentView: '', initPlayer: id => { received = id; }
      });
      for (const name of ['joinWatchPartyByCode', 'setupWatchPartyModal', 'setupRouter']) evaluate(app, name, context);
      if (entry === 'code') {
        await context.joinWatchPartyByCode('ROOM', 'Viewer');
      } else {
        context.setupWatchPartyModal();
        await nodes['party-join-submit-btn'].onclick();
      }
      assert.equal(context.window.location.hash, expectedHash);
      context.document = { getElementById: () => null, querySelector: () => ({ style: { removeProperty() {} } }), querySelectorAll: () => [] };
      context.setupRouter();
      assert.equal(received, episodeId, 'Player receives the original API episode ID');
    }
  });
}

test('decoded IDs retain question marks and slashes through API URL construction', async () => {
  let requested;
  const stop = new Error('Stop after first API request');
  const context = vm.createContext({ console: { error() {} }, document: { getElementById: () => null }, fetch: async url => { requested = url; throw stop; } });
  evaluate(player, 'getShowIdFromEpisodeId', context);
  evaluate(player, 'showApiUrl', context);
  // The player loads its episode through showApiUrl(getShowIdFromEpisodeId(id)).
  assert.ok(/showApiUrl\(getShowIdFromEpisodeId\(episodeId\)\)|showApiUrl\(showId\)/.test(player), 'player must build the show request with showApiUrl');
  assert.equal(context.showApiUrl(context.getShowIdFromEpisodeId('Show?part/one_S1_E1')), '/api/shows/Show%3Fpart%2Fone');
  assert.equal(context.getShowIdFromEpisodeId('Show%2Ftitle_S1_E1'), 'Show%2Ftitle', 'Literal percent escapes in IDs are not decoded twice');
  // Detail loading needs only the initial DOM reset before its first API request.
  const node = { textContent: '', innerHTML: '', children: [], remove() {} };
  context.document.getElementById = () => node;
  evaluate(app, 'loadShowDetails', context);
  await context.loadShowDetails('Show?part/one').catch(() => {});
  assert.equal(requested, '/api/shows/Show%3Fpart%2Fone');
});

test('player continuation, back and share links encode IDs before appending queries', () => {
  assert.ok(!/#\/(?:player|show)\/\$\{(?:nextEpisodeId|currentEpisodeId|getShowIdFromEpisodeId\(currentEpisodeId\))\}/.test(player));
});

test('new service worker installs exact versioned shell assets and retires old cache', async () => {
  const handlers = {};
  const installed = [];
  const cacheModes = [];
  const removed = [];
  let cacheName;
  const context = vm.createContext({ URL, Request, console, self: { location: { origin: 'https://kura.test' }, addEventListener: (type, handler) => { handlers[type] = handler; }, skipWaiting() {}, clients: { claim() {} } }, caches: { open: async name => { cacheName = name; return { addAll: async assets => { cacheModes.push(...assets.map(asset => asset.cache)); installed.push(...assets.map(asset => typeof asset === 'string' ? asset : new URL(asset.url).pathname + new URL(asset.url).search)); } }; }, keys: async () => ['kurastream-v2.0', cacheName], delete: async name => { removed.push(name); } } });
  vm.runInContext(sw, context);
  let done;
  handlers.install({ waitUntil: promise => { done = promise; } });
  await done;
  assert.notEqual(cacheName, 'kurastream-v2.0', 'Existing installations must get a fresh cache');
  assert.ok(cacheModes.every(mode => mode === 'reload'), 'Install must not copy stale HTTP-cached HTML or modules into the new cache');
  for (const match of html.matchAll(/(?:src|href)="((?:(?:js\/)?main\.js|player\.js|style\.css)\?[^" ]+)"/g)) {
    const assetPath = match[1].startsWith('/') ? match[1] : '/' + match[1];
    assert.ok(installed.includes(assetPath), `Precache ${match[1]}`);
  }
  const playerImportMatch = app.match(/from '(?:\.\/|\.\.\/)(player\.js[^']+)'/);
  assert.ok(playerImportMatch, 'Missing player.js import in main.js');
  const playerImport = playerImportMatch[1];
  assert.ok(html.includes(`src="${playerImport}"`), 'App and HTML must load the same player version');
  const visited = new Set();
  const checkModule = path => {
    if (visited.has(path)) return;
    visited.add(path);
    assert.ok(installed.includes(path), `Offline module dependency missing: ${path}`);
    const source = fs.readFileSync(new URL('../frontend' + path.split('?')[0], import.meta.url), 'utf8');
    for (const match of source.matchAll(/^import .*?from ['"]([^'"]+)['"]/gm)) {
      if (!match[1].startsWith('.')) continue;
      const dependency = new URL(match[1], 'https://kura.test' + path);
      checkModule(dependency.pathname + dependency.search);
    }
  };
  const mainScriptMatch = html.match(/src="(\/js\/main\.js\?[^"]+)"/);
  checkModule(mainScriptMatch ? mainScriptMatch[1] : '/js/main.js?v=2026.10.04-outros');
  handlers.activate({ waitUntil: promise => { done = promise; } });
  await done;
  assert.deepEqual(removed, ['kurastream-v2.0']);
});

test('active catalogue/calendar positive states use jade tokens', () => {
  for (const name of ['createShowCardHTML', 'renderCalendarDay', 'renderStatsView']) {
    const body = app.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\{[\\s\\S]*?^\\}`, 'm'))[0];
    assert.ok(!/#00e08f|rgba\(0,\s*224,\s*143/i.test(body), `${name} uses legacy green`);
  }
  const calendarBanner = html.match(/<div class="calendar-header-banner"[^>]+>/)[0];
  assert.ok(!/#00e08f|rgba\(0,\s*224,\s*143/i.test(calendarBanner));
  assert.ok(/--success-color:\s*#2DD4BF/i.test(css));
});

test('single router architecture: navigation.js and main.js do not register duplicate hash routers', () => {
  assert.ok(!nav.includes("window.addEventListener('hashchange'"), 'navigation.js must not register duplicate hashchange');
  assert.ok(!nav.includes('export function initRouter'), 'navigation.js must not export duplicate initRouter');
  assert.ok(!nav.includes("getElementById('view-catalog')"), 'navigation.js must not reference obsolete view-catalog');
  assert.ok(!nav.includes("getElementById('view-show-detail')"), 'navigation.js must not reference obsolete view-show-detail');
  assert.ok(!app.includes('import { appRouter }'), 'main.js must not import dead appRouter');
  assert.ok(!app.includes("from './core/router.js'"), 'main.js must not import core/router.js');
  assert.ok(!app.includes('router: appRouter'), 'main.js must not expose dead appRouter on window.KuraStream');

  const coreRouter = fs.readFileSync(new URL('../frontend/js/core/router.js', import.meta.url), 'utf8');
  assert.ok(!coreRouter.includes("constructor() {\n    this.routes = {};\n    this.currentRoute = null;\n    this.beforeHooks = [];\n\n    window.addEventListener('hashchange'"), 'core/router.js must not auto-register hashchange listener in constructor');
});

test('purge fabricated metadata: no 8.5 rating or 2026 year fallback in frontend modules', () => {
  // Check main.js
  assert.ok(!/['"]8\.5['"]/.test(app), 'main.js must not contain fabricated 8.5 rating');
  // Check catalog.js
  assert.ok(!/['"]8\.5['"]/.test(catalogMod), 'catalog.js must not contain fabricated 8.5 rating');
  assert.ok(!/['"]2026['"]/.test(catalogMod), 'catalog.js must not contain fabricated 2026 year');
  assert.ok(catalogMod.includes('escapeHtml'), 'catalog.js must sanitize HTML');

  // Check billboard rendering with empty metadata
  const context = vm.createContext({
    escapeHtml: s => String(s || ''),
    escapeHtmlAttribute: s => String(s || ''),
    catalogueImageUrl: s => s
  });
  evaluate(app, 'renderBillboardHero', context);
  const heroHtml = context.renderBillboardHero({ title: 'Test Anime' });
  assert.ok(!heroHtml.includes('8.5'), 'renderBillboardHero must not fabricate 8.5 rating');
  assert.ok(heroHtml.includes('N/A'), 'renderBillboardHero shows N/A for missing rating/year');
});

