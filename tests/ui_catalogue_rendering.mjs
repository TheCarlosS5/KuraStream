import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Evaluate the real renderers without starting the app or making API requests.
const source = fs.readFileSync(new URL('../frontend/app.js', import.meta.url), 'utf8');
assert.ok(!/setProperty\('--accent-(?:color|hover|glow)'/.test(source), 'Artwork must not override semantic action colors');
const names = ['escapeHtml', 'escapeHtmlAttribute', 'catalogueImageUrl', 'setupCatalogueActions', 'renderBillboardHero', 'renderContinueWatching', 'createShowCardHTML', 'renderEpisodeList', 'showEpisodeDetails', 'loadShowDetails', 'renderMyListView', 'renderHistoryView', 'loadPopularSidebar', 'renderCalendarDay', 'openRandomAnimeModal'];
const context = vm.createContext({ URL, console });
for (const name of names) {
  const body = source.match(new RegExp(`(?:export )?(?:async )?function ${name}\\([^\\n]*\\{[\\s\\S]*?^\\}`, 'm'));
  assert.ok(body, `Missing ${name}`);
  vm.runInContext(body[0].replace(/^export /, ''), context);
}
const hostile = `<script>alert('x')</script>" onerror="alert(1)&`;
const id = `id/'\"<>&?=#`;
assert.equal(context.escapeHtml(2026), '2026');
assert.equal(context.escapeHtml(null), '');
assert.equal(context.escapeHtmlAttribute(`"'&<>`), '&quot;&#039;&amp;&lt;&gt;');
const show = { id, title: hostile, year: hostile, rating: '8.5', genres: hostile, synopsis: hostile, poster_path: hostile, backdrop_path: hostile };
const episode = { id, episode_id: id, episode_number: hostile, season_number: hostile, title: hostile, episode_title: hostile, show_title: hostile, synopsis: hostile, thumbnail_path: hostile, progress_seconds: 30, duration: 120 };
const target = { innerHTML: '' };
context.renderEpisodeList([episode], target);
for (const markup of [context.renderBillboardHero(show), context.renderContinueWatching([episode]), context.createShowCardHTML(show), target.innerHTML]) {
  assert.ok(!markup.includes('<script>'), 'Metadata must remain text');
  assert.ok(!markup.includes('" onerror="'), 'Metadata must not create attributes');
  assert.ok(!markup.includes('onclick='), 'No dynamic inline JavaScript');
  assert.ok(markup.includes('&lt;script&gt;'), 'Escaped metadata must remain visible');
}
assert.ok(context.renderBillboardHero(show).includes('#/show/id%2F&#039;%22%3C%3E%26%3F%3D%23'));
assert.ok(context.renderContinueWatching([episode]).includes('#/player/id%2F&#039;%22%3C%3E%26%3F%3D%23'));
assert.ok(target.innerHTML.includes('data-episode-id="id/&#039;&quot;&lt;&gt;&amp;?=#"'));
for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)']) {
  assert.equal(context.catalogueImageUrl(url), '', 'Reject executable URL schemes');
}
assert.equal(context.catalogueImageUrl('/poster.jpg?a=1&b=2'), '/poster.jpg?a=1&b=2');
assert.equal(context.catalogueImageUrl('https://example.com/poster.jpg'), 'https://example.com/poster.jpg');

const handlers = {};
let selectedEpisode;
context.document = { addEventListener: (name, handler) => { handlers[name] = handler; } };
context.window = { location: { hash: '' }, showEpisodeDetails: value => { selectedEpisode = value; } };
context.setupCatalogueActions();
const route = '#/show/' + encodeURIComponent(id);
handlers.click({ target: { closest: selector => {
  assert.equal(selector, '[data-catalogue-route], .episode-item[data-episode-id]', 'Do not activate unrelated data-episode-id controls');
  return { dataset: { catalogueRoute: route } };
} } });
assert.equal(context.window.location.hash, route);
handlers.click({ target: { closest: () => ({ dataset: { episodeId: id } }) } });
assert.equal(selectedEpisode, id, 'Episode cards must still open the details modal');
const elements = new Map();
const element = () => ({ innerHTML: '', style: { removeProperty() {} }, classList: { add() {}, remove() {} }, remove() {}, querySelectorAll: () => [], insertAdjacentElement() {}, addEventListener() {} });
context.document.getElementById = key => {
  if (!elements.has(key)) elements.set(key, element());
  return elements.get(key);
};
context.currentShowEpisodes = [{ ...episode, audio_tracks: [{ title: hostile, language: hostile }], subtitle_tracks: [{ title: hostile, language: hostile }] }];
context.location = { hash: '' };
context.showEpisodeDetails(id);
for (const key of ['ep-detail-audio', 'ep-detail-subtitles']) {
  assert.ok(!elements.get(key).innerHTML.includes('<script>'), 'Episode track metadata must remain text');
}
elements.get('ep-detail-play-btn').onclick();
assert.equal(context.location.hash, '#/player/' + encodeURIComponent(id));
context.document.querySelector = () => element();
context.document.createElement = element;
context.localStorage = { getItem: () => null };
context.fetch = async () => ({ json: async () => ({ show: { ...show, rating: 8.5, cast_members: [{ character: hostile, name: hostile }] }, episodes: [episode] }) });
context.loadShowComments = async () => {};
const loadPopularSidebar = context.loadPopularSidebar;
context.loadPopularSidebar = async () => {};
await context.loadShowDetails(id);
for (const key of ['detail-cast', 'detail-meta-badges', 'season-tabs']) {
  const markup = elements.get(key).innerHTML;
  assert.ok(markup.includes('&lt;script&gt;'), `${key} should retain escaped metadata`);
  assert.ok(!markup.includes('<script>'), `${key} must not inject HTML`);
}
context.getUserAndProfile = () => ({ activeUser: 'test', profileName: 'Principal', isGuest: false, token: 'fixture' });
context.mylistSortValue = 'recent';
context.fetch = async () => ({ ok: true, json: async () => [{ ...show, rating: 8.5 }] });
await context.renderMyListView();
await loadPopularSidebar('other');
context.fetch = async () => ({ ok: true, json: async () => [episode] });
await context.renderHistoryView();
context.calendarDataCache = { Monday: [{ ...show, cover_image: hostile, library_show_id: id, in_library: true, episode: hostile, studio: hostile, airing_at: 1 }] };
context.renderCalendarDay('Monday');
context.setInterval = fn => setInterval(fn, 1);
context.clearInterval = clearInterval;
context.setTimeout = fn => setTimeout(fn, 0);
context.fetch = async url => ({ ok: true, json: async () => url.endsWith('/random') ? { show } : [show] });
await context.openRandomAnimeModal();
const failures = [];
for (const key of ['mylist-grid', 'detail-popular-sidebar', 'history-list', 'calendar-grid-content', 'random-card-body']) {
  const markup = elements.get(key)?.innerHTML || '';
  if (!markup.includes('&lt;script&gt;') || markup.includes('<script>') || markup.includes('" onerror="') || markup.includes('onclick=')) failures.push(key);
}
assert.deepEqual(failures, [], 'All catalogue views must escape metadata and avoid inline event values');
console.log('Catalogue hostile metadata and navigation regressions passed');
