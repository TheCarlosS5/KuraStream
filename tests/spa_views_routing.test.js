import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dbHelper } from '../backend/db.js';

test('HTML contains SPA view sections for mylist, history, genres, and stats', () => {
  const htmlPath = path.join(process.cwd(), 'frontend', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(html.includes('id="mylist-view"'), 'index.html contains mylist-view container');
  assert.ok(html.includes('id="mylist-grid"'), 'index.html contains mylist-grid');
  assert.ok(html.includes('id="history-view"'), 'index.html contains history-view container');
  assert.ok(html.includes('id="btn-clear-history"'), 'index.html contains btn-clear-history button');
  assert.ok(html.includes('id="genres-view"'), 'index.html contains genres-view container');
  assert.ok(html.includes('id="genre-catalog-section"'), 'index.html contains genre-catalog-section');
  assert.ok(html.includes('id="stats-view"'), 'index.html contains stats-view container');
  assert.ok(html.includes('id="stats-cards-grid"'), 'index.html contains stats-cards-grid');
});

test('app.js includes handlers for SPA view routes and render functions', () => {
  const appJsPath = path.join(process.cwd(), 'frontend', 'app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  assert.ok(appJs.includes("hash === '#/my-list'"), 'app.js handles #/my-list route');
  assert.ok(appJs.includes("hash === '#/history'"), 'app.js handles #/history route');
  assert.ok(appJs.includes("hash.startsWith('#/genres')"), 'app.js handles #/genres route');
  assert.ok(appJs.includes("hash === '#/stats'"), 'app.js handles #/stats route');

  assert.ok(appJs.includes('renderMyListView()'), 'app.js contains renderMyListView');
  assert.ok(appJs.includes('renderHistoryView()'), 'app.js contains renderHistoryView');
  assert.ok(appJs.includes('renderGenresView('), 'app.js contains renderGenresView');
  assert.ok(appJs.includes('renderStatsView()'), 'app.js contains renderStatsView');
});

test('dbHelper history deletion and user stats work correctly', () => {
  const testUser = 'test_spa_user_' + Date.now();
  const testProfile = 'Principal';
  
  dbHelper.saveWatchProgress(testUser, 'test_ep_1', 300, testProfile);
  dbHelper.saveWatchProgress(testUser, 'test_ep_2', 600, testProfile);

  const stats = dbHelper.getUserStats(testUser, testProfile);
  assert.equal(stats.watched_episodes, 2);
  assert.equal(stats.total_time_seconds, 900);

  dbHelper.deleteHistoryItem(testUser, testProfile, 'test_ep_1');
  const updatedStats = dbHelper.getUserStats(testUser, testProfile);
  assert.equal(updatedStats.watched_episodes, 1);
  assert.equal(updatedStats.total_time_seconds, 600);

  dbHelper.clearUserHistory(testUser, testProfile);
  const clearedStats = dbHelper.getUserStats(testUser, testProfile);
  assert.equal(clearedStats.watched_episodes, 0);
  assert.equal(clearedStats.total_time_seconds, 0);
});
