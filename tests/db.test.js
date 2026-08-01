import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
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

test('Data Migration Flow Verification', () => {
  // 1. Create a mock in-memory database
  const mockDb = new DatabaseSync(':memory:');
  
  // 2. Setup the old schema (without profile_name)
  mockDb.exec(`
    CREATE TABLE watch_history (
      username TEXT NOT NULL,
      episode_id TEXT NOT NULL,
      progress_seconds REAL NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (username, episode_id)
    );
    
    CREATE TABLE favorites (
      username TEXT NOT NULL,
      show_id TEXT NOT NULL,
      PRIMARY KEY (username, show_id)
    );
  `);
  
  // 3. Insert dummy data into the old schema
  mockDb.exec(`
    INSERT INTO watch_history (username, episode_id, progress_seconds, updated_at)
    VALUES ('user1', 'ep101', 120.5, '2026-08-01 12:00:00');
    
    INSERT INTO favorites (username, show_id)
    VALUES ('user1', 'show99');
  `);
  
  // 4. Run the exact migration logic on the mockDb
  
  // --- Start of watch_history migration code replication ---
  const watchHistoryInfo = mockDb.prepare("PRAGMA table_info(watch_history)").all();
  const whProfileNameCol = watchHistoryInfo.find(col => col.name === 'profile_name');
  const whIsPrimaryKeyComposite = whProfileNameCol && whProfileNameCol.pk > 0;
  if (!whIsPrimaryKeyComposite) {
    mockDb.exec("BEGIN TRANSACTION;");
    mockDb.exec("ALTER TABLE watch_history RENAME TO watch_history_old;");
    mockDb.exec(`
      CREATE TABLE watch_history (
        username TEXT NOT NULL,
        profile_name TEXT NOT NULL DEFAULT 'Principal',
        episode_id TEXT NOT NULL,
        progress_seconds REAL NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (username, profile_name, episode_id)
      );
    `);
    const hasProfileNameInOld = whProfileNameCol !== undefined;
    if (hasProfileNameInOld) {
      mockDb.exec(`
        INSERT OR IGNORE INTO watch_history (username, profile_name, episode_id, progress_seconds, updated_at)
        SELECT username, COALESCE(profile_name, 'Principal'), episode_id, progress_seconds, updated_at FROM watch_history_old;
      `);
    } else {
      mockDb.exec(`
        INSERT OR IGNORE INTO watch_history (username, profile_name, episode_id, progress_seconds, updated_at)
        SELECT username, 'Principal', episode_id, progress_seconds, updated_at FROM watch_history_old;
      `);
    }
    mockDb.exec("DROP TABLE watch_history_old;");
    mockDb.exec("COMMIT;");
  }
  // --- End of watch_history migration code replication ---

  // --- Start of favorites migration code replication ---
  const favoritesInfo = mockDb.prepare("PRAGMA table_info(favorites)").all();
  const favProfileNameCol = favoritesInfo.find(col => col.name === 'profile_name');
  const favIsPrimaryKeyComposite = favProfileNameCol && favProfileNameCol.pk > 0;
  if (!favIsPrimaryKeyComposite) {
    mockDb.exec("BEGIN TRANSACTION;");
    mockDb.exec("ALTER TABLE favorites RENAME TO favorites_old;");
    mockDb.exec(`
      CREATE TABLE favorites (
        username TEXT NOT NULL,
        profile_name TEXT NOT NULL DEFAULT 'Principal',
        show_id TEXT NOT NULL,
        PRIMARY KEY (username, profile_name, show_id)
      );
    `);
    const hasProfileNameInOld = favProfileNameCol !== undefined;
    if (hasProfileNameInOld) {
      mockDb.exec(`
        INSERT OR IGNORE INTO favorites (username, profile_name, show_id)
        SELECT username, COALESCE(profile_name, 'Principal'), show_id FROM favorites_old;
      `);
    } else {
      mockDb.exec(`
        INSERT OR IGNORE INTO favorites (username, profile_name, show_id)
        SELECT username, 'Principal', show_id FROM favorites_old;
      `);
    }
    mockDb.exec("DROP TABLE favorites_old;");
    mockDb.exec("COMMIT;");
  }
  // --- End of favorites migration code replication ---

  // 5. Assert database schema state
  const whColsAfter = mockDb.prepare("PRAGMA table_info(watch_history)").all();
  const whPKCols = whColsAfter.filter(c => c.pk > 0).map(c => c.name);
  assert.ok(whPKCols.includes('username'), 'watch_history PK should contain username after migration');
  assert.ok(whPKCols.includes('profile_name'), 'watch_history PK should contain profile_name after migration');
  assert.ok(whPKCols.includes('episode_id'), 'watch_history PK should contain episode_id after migration');
  assert.strictEqual(whPKCols.length, 3, 'watch_history should have 3 PK columns after migration');

  const favColsAfter = mockDb.prepare("PRAGMA table_info(favorites)").all();
  const favPKCols = favColsAfter.filter(c => c.pk > 0).map(c => c.name);
  assert.ok(favPKCols.includes('username'), 'favorites PK should contain username after migration');
  assert.ok(favPKCols.includes('profile_name'), 'favorites PK should contain profile_name after migration');
  assert.ok(favPKCols.includes('show_id'), 'favorites PK should contain show_id after migration');
  assert.strictEqual(favPKCols.length, 3, 'favorites should have 3 PK columns after migration');

  // 6. Assert data preservation
  const whData = mockDb.prepare("SELECT * FROM watch_history").all();
  assert.strictEqual(whData.length, 1);
  assert.strictEqual(whData[0].username, 'user1');
  assert.strictEqual(whData[0].profile_name, 'Principal');
  assert.strictEqual(whData[0].episode_id, 'ep101');
  assert.strictEqual(whData[0].progress_seconds, 120.5);

  const favData = mockDb.prepare("SELECT * FROM favorites").all();
  assert.strictEqual(favData.length, 1);
  assert.strictEqual(favData[0].username, 'user1');
  assert.strictEqual(favData[0].profile_name, 'Principal');
  assert.strictEqual(favData[0].show_id, 'show99');
});
