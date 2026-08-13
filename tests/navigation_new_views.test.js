import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('index.html contains expected navigation elements, view containers, and interactive modals/notifications', () => {
  const htmlPath = path.join(process.cwd(), 'frontend', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(html.includes('id="nav-mylist"'), 'index.html contains nav-mylist');
  assert.ok(html.includes('id="nav-history"'), 'index.html contains nav-history');
  assert.ok(html.includes('id="mylist-view"'), 'index.html contains mylist-view');
  assert.ok(html.includes('id="history-view"'), 'index.html contains history-view');
  assert.ok(html.includes('id="genres-view"'), 'index.html contains genres-view');
  assert.ok(html.includes('id="stats-view"'), 'index.html contains stats-view');
  assert.ok(html.includes('id="random-modal"'), 'index.html contains random-modal');
  assert.ok(html.includes('id="notifications-container"'), 'index.html contains notifications-container');
});

test('app.js defines openRandomAnimeModal and loadNotifications functions', () => {
  const appJsPath = path.join(process.cwd(), 'frontend', 'app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  assert.ok(appJs.includes('openRandomAnimeModal'), 'app.js includes openRandomAnimeModal function');
  assert.ok(appJs.includes('loadNotifications'), 'app.js includes loadNotifications function');
  assert.ok(appJs.includes('btn-close-random'), 'app.js references btn-close-random modal close button');
  assert.ok(appJs.includes('btn-mark-notifications-read'), 'app.js references btn-mark-notifications-read button');
});
