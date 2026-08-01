import test from 'node:test';
import assert from 'node:assert';
import { db } from '../backend/db.js';

test('Database Schema Verification', () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const hasProfiles = tables.some(t => t.name === 'profiles');
  assert.ok(hasProfiles, 'profiles table should exist');

  // Verify fields on profiles
  const profileCols = db.prepare("PRAGMA table_info(profiles)").all();
  const colNames = profileCols.map(c => c.name);
  assert.ok(colNames.includes('username'), 'profiles table should have username column');
  assert.ok(colNames.includes('profile_name'), 'profiles table should have profile_name column');
  assert.ok(colNames.includes('avatar_color'), 'profiles table should have avatar_color column');
  assert.ok(colNames.includes('is_kids'), 'profiles table should have is_kids column');
  assert.ok(colNames.includes('pin'), 'profiles table should have pin column');
  assert.ok(colNames.includes('pref_audio_lang'), 'profiles table should have pref_audio_lang column');
  assert.ok(colNames.includes('pref_sub_lang'), 'profiles table should have pref_sub_lang column');

  // Verify foreign key constraints on profiles
  const foreignKeys = db.prepare("PRAGMA foreign_key_list(profiles)").all();
  const hasUserFK = foreignKeys.some(fk => 
    fk.table === 'users' && 
    fk.from === 'username' && 
    fk.to === 'username' && 
    fk.on_delete === 'CASCADE'
  );
  assert.ok(hasUserFK, 'profiles should have a foreign key referencing users(username) ON DELETE CASCADE');

  // Verify watch_history composite primary key
  const historyCols = db.prepare("PRAGMA table_info(watch_history)").all();
  const historyPKCols = historyCols.filter(c => c.pk > 0).map(c => c.name);
  assert.ok(historyPKCols.includes('username'), 'watch_history PK should include username');
  assert.ok(historyPKCols.includes('profile_name'), 'watch_history PK should include profile_name');
  assert.ok(historyPKCols.includes('episode_id'), 'watch_history PK should include episode_id');
  assert.strictEqual(historyPKCols.length, 3, 'watch_history PK should have exactly 3 columns');

  // Verify favorites composite primary key
  const favoritesCols = db.prepare("PRAGMA table_info(favorites)").all();
  const favoritesPKCols = favoritesCols.filter(c => c.pk > 0).map(c => c.name);
  assert.ok(favoritesPKCols.includes('username'), 'favorites PK should include username');
  assert.ok(favoritesPKCols.includes('profile_name'), 'favorites PK should include profile_name');
  assert.ok(favoritesPKCols.includes('show_id'), 'favorites PK should include show_id');
  assert.strictEqual(favoritesPKCols.length, 3, 'favorites PK should have exactly 3 columns');
});
