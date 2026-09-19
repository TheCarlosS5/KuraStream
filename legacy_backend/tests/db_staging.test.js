import test from 'node:test';
import assert from 'node:assert/strict';
import { dbHelper } from '../backend/db.js';

test('dbHelper supports staged_imports CRUD operations', () => {
  const item = {
    id: 'test_stage_1',
    raw_title: 'Demon.Slayer.Kimetsu.no.Yaiba.1080p',
    clean_title: 'Demon Slayer: Kimetsu no Yaiba',
    media_type: 'anime',
    season: 1,
    episode: 1,
    file_path: '/library/downloads/staged/demon_slayer.mkv',
    tmdb_id: '203737',
    source_info: 'Nyaa AutoDownloader'
  };

  dbHelper.saveStagedImport(item);

  const fetched = dbHelper.getStagedImport('test_stage_1');
  assert.ok(fetched);
  assert.equal(fetched.clean_title, 'Demon Slayer: Kimetsu no Yaiba');
  assert.equal(fetched.season, 1);

  const all = dbHelper.getStagedImports();
  assert.ok(all.some(i => i.id === 'test_stage_1'));

  dbHelper.updateStagedImport('test_stage_1', { clean_title: 'Demon Slayer Season 1' });
  const updated = dbHelper.getStagedImport('test_stage_1');
  assert.equal(updated.clean_title, 'Demon Slayer Season 1');

  dbHelper.deleteStagedImport('test_stage_1');
  const deleted = dbHelper.getStagedImport('test_stage_1');
  assert.equal(deleted, null);
});
