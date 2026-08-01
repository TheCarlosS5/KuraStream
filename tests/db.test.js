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

  // Verify watch_history
  const historyCols = db.prepare("PRAGMA table_info(watch_history)").all();
  const hasProfileCol = historyCols.some(c => c.name === 'profile_name');
  assert.ok(hasProfileCol, 'watch_history should have profile_name column');

  // Verify favorites
  const favoritesCols = db.prepare("PRAGMA table_info(favorites)").all();
  const hasFavProfileCol = favoritesCols.some(c => c.name === 'profile_name');
  assert.ok(hasFavProfileCol, 'favorites should have profile_name column');
});
