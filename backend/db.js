import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'kurastream.db');

export const db = new DatabaseSync(dbPath);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS shows (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    synopsis TEXT,
    rating REAL,
    year INTEGER,
    studio TEXT,
    director TEXT,
    writer TEXT,
    cast_members TEXT, -- JSON array of { name, character, profile_path }
    poster_path TEXT,
    backdrop_path TEXT,
    media_type TEXT NOT NULL DEFAULT 'anime', -- 'anime', 'movie', 'manga'
    backdrop_loops TEXT DEFAULT '[]',
    genres TEXT DEFAULT '',
    trailer_key TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    show_id TEXT NOT NULL,
    season_number INTEGER NOT NULL,
    episode_number INTEGER NOT NULL,
    title TEXT,
    synopsis TEXT,
    filepath TEXT NOT NULL,
    duration REAL, -- in seconds
    size INTEGER, -- in bytes
    video_codec TEXT,
    resolution TEXT,
    fps REAL,
    audio_tracks TEXT, -- JSON array of { index, codec, language, title }
    subtitle_tracks TEXT, -- JSON array of { index, codec, language, title }
    thumbnail_path TEXT DEFAULT '',
    intro_start INTEGER DEFAULT NULL,
    intro_end INTEGER DEFAULT NULL,
    outro_start INTEGER DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS watch_history (
    username TEXT NOT NULL,
    profile_name TEXT NOT NULL DEFAULT 'Principal',
    episode_id TEXT NOT NULL,
    progress_seconds REAL NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (username, profile_name, episode_id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user'
  );

  CREATE TABLE IF NOT EXISTS profiles (
    username TEXT NOT NULL,
    profile_name TEXT NOT NULL,
    avatar_color TEXT NOT NULL DEFAULT '#a855f7',
    is_kids INTEGER NOT NULL DEFAULT 0,
    pin TEXT,
    pref_audio_lang TEXT NOT NULL DEFAULT 'default',
    pref_sub_lang TEXT NOT NULL DEFAULT 'default',
    PRIMARY KEY (username, profile_name),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    show_id TEXT NOT NULL,
    username TEXT NOT NULL,
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS favorites (
    username TEXT NOT NULL,
    profile_name TEXT NOT NULL DEFAULT 'Principal',
    show_id TEXT NOT NULL,
    PRIMARY KEY (username, profile_name, show_id)
  );
`);

// Run migrations for existing DBs
try {
  db.exec(`ALTER TABLE shows ADD COLUMN backdrop_loops TEXT DEFAULT '[]';`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE shows ADD COLUMN created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE shows ADD COLUMN genres TEXT DEFAULT '';`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE shows ADD COLUMN trailer_key TEXT;`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE episodes ADD COLUMN thumbnail_path TEXT DEFAULT '';`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE episodes ADD COLUMN intro_start INTEGER DEFAULT NULL;`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE episodes ADD COLUMN intro_end INTEGER DEFAULT NULL;`);
} catch (e) {}

try {
  db.exec(`ALTER TABLE episodes ADD COLUMN outro_start INTEGER DEFAULT NULL;`);
} catch (e) {}

// Migration for user-specific watch_history
try {
  const tableInfo = db.prepare("PRAGMA table_info(watch_history)").all();
  const hasUsername = tableInfo.some(col => col.name === 'username');
  if (!hasUsername) {
    db.exec("ALTER TABLE watch_history RENAME TO watch_history_old");
    db.exec(`
      CREATE TABLE watch_history (
        username TEXT NOT NULL,
        profile_name TEXT NOT NULL DEFAULT 'Principal',
        episode_id TEXT NOT NULL,
        progress_seconds REAL NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (username, profile_name, episode_id)
      )
    `);
    db.exec(`
      INSERT OR IGNORE INTO watch_history (username, profile_name, episode_id, progress_seconds, updated_at)
      SELECT 'guest', 'Principal', episode_id, progress_seconds, updated_at FROM watch_history_old
    `);
    db.exec("DROP TABLE watch_history_old");
    console.log("watch_history migrated to multi-user successfully.");
  }
} catch (e) {
  console.error("Watch history migration failed:", e);
}

// Run migrations for profiles, watch_history and favorites to support multi-profiles
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      username TEXT NOT NULL,
      profile_name TEXT NOT NULL,
      avatar_color TEXT NOT NULL DEFAULT '#a855f7',
      is_kids INTEGER NOT NULL DEFAULT 0,
      pin TEXT,
      pref_audio_lang TEXT NOT NULL DEFAULT 'default',
      pref_sub_lang TEXT NOT NULL DEFAULT 'default',
      PRIMARY KEY (username, profile_name),
      FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
    );
  `);
} catch (e) {
  console.error("Profiles table migration failed:", e);
}

// Migration for adding profile_name to watch_history composite primary key
try {
  const tableInfo = db.prepare("PRAGMA table_info(watch_history)").all();
  const profileNameCol = tableInfo.find(col => col.name === 'profile_name');
  const isPrimaryKeyComposite = profileNameCol && profileNameCol.pk > 0;
  if (!isPrimaryKeyComposite) {
    db.exec("ALTER TABLE watch_history RENAME TO watch_history_old");
    db.exec(`
      CREATE TABLE watch_history (
        username TEXT NOT NULL,
        profile_name TEXT NOT NULL DEFAULT 'Principal',
        episode_id TEXT NOT NULL,
        progress_seconds REAL NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (username, profile_name, episode_id)
      )
    `);
    const hasProfileNameInOld = profileNameCol !== undefined;
    if (hasProfileNameInOld) {
      db.exec(`
        INSERT OR IGNORE INTO watch_history (username, profile_name, episode_id, progress_seconds, updated_at)
        SELECT username, COALESCE(profile_name, 'Principal'), episode_id, progress_seconds, updated_at FROM watch_history_old
      `);
    } else {
      db.exec(`
        INSERT OR IGNORE INTO watch_history (username, profile_name, episode_id, progress_seconds, updated_at)
        SELECT username, 'Principal', episode_id, progress_seconds, updated_at FROM watch_history_old
      `);
    }
    db.exec("DROP TABLE watch_history_old");
    console.log("watch_history migrated to composite primary key with profile_name successfully.");
  }
} catch (e) {
  console.error("Watch history multi-profile migration failed:", e);
}

// Migration for adding profile_name to favorites composite primary key
try {
  const tableInfo = db.prepare("PRAGMA table_info(favorites)").all();
  const profileNameCol = tableInfo.find(col => col.name === 'profile_name');
  const isPrimaryKeyComposite = profileNameCol && profileNameCol.pk > 0;
  if (!isPrimaryKeyComposite) {
    db.exec("ALTER TABLE favorites RENAME TO favorites_old");
    db.exec(`
      CREATE TABLE favorites (
        username TEXT NOT NULL,
        profile_name TEXT NOT NULL DEFAULT 'Principal',
        show_id TEXT NOT NULL,
        PRIMARY KEY (username, profile_name, show_id)
      )
    `);
    const hasProfileNameInOld = profileNameCol !== undefined;
    if (hasProfileNameInOld) {
      db.exec(`
        INSERT OR IGNORE INTO favorites (username, profile_name, show_id)
        SELECT username, COALESCE(profile_name, 'Principal'), show_id FROM favorites_old
      `);
    } else {
      db.exec(`
        INSERT OR IGNORE INTO favorites (username, profile_name, show_id)
        SELECT username, 'Principal', show_id FROM favorites_old
      `);
    }
    db.exec("DROP TABLE favorites_old");
    console.log("favorites migrated to composite primary key with profile_name successfully.");
  }
} catch (e) {
  console.error("Favorites multi-profile migration failed:", e);
}

// Insert default setting for admin password PIN if not exists
try {
  db.exec(`
    INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_pin', '0101');
  `);
} catch (e) {
  console.error("Failed to insert default settings:", e);
}

// Seed default admin user
try {
  db.exec(`
    INSERT OR IGNORE INTO users (username, password, role) VALUES ('TheCarlosS5', 'Carlos2009.', 'admin');
  `);
} catch (e) {
  console.error("Failed to seed default admin user:", e);
}

// Database helper functions
export const dbHelper = {
  // Shows
  getShows: (type = 'anime') => {
    if (type === 'all') {
      const stmt = db.prepare("SELECT * FROM shows");
      return stmt.all();
    }
    const stmt = db.prepare("SELECT * FROM shows WHERE media_type = ?");
    return stmt.all(type);
  },
  getShow: (id) => {
    const stmt = db.prepare("SELECT * FROM shows WHERE id = ?");
    return stmt.get(id);
  },
  saveShow: (show) => {
    const existing = dbHelper.getShow(show.id);
    
    // Safely parse backdrop_loops
    let loops = [];
    if (show.backdrop_loops !== undefined) {
      if (Array.isArray(show.backdrop_loops)) {
        loops = show.backdrop_loops;
      } else if (typeof show.backdrop_loops === 'string') {
        try { loops = JSON.parse(show.backdrop_loops); } catch(e) { loops = []; }
      }
    } else if (existing && existing.backdrop_loops) {
      try { loops = JSON.parse(existing.backdrop_loops); } catch(e) { loops = []; }
    }
    
    // Safely parse cast_members
    let cast = [];
    if (show.cast_members !== undefined) {
      if (Array.isArray(show.cast_members)) {
        cast = show.cast_members;
      } else if (typeof show.cast_members === 'string') {
        try { cast = JSON.parse(show.cast_members); } catch(e) { cast = []; }
      }
    } else if (existing && existing.cast_members) {
      try { cast = JSON.parse(existing.cast_members); } catch(e) { cast = []; }
    }

    const trailer_key = show.trailer_key !== undefined ? show.trailer_key : (existing ? existing.trailer_key : null);

    if (existing) {
      const stmt = db.prepare(`
        UPDATE shows SET 
          title = ?, 
          synopsis = ?, 
          rating = ?, 
          year = ?, 
          studio = ?, 
          director = ?, 
          writer = ?, 
          cast_members = ?, 
          poster_path = ?, 
          backdrop_path = ?, 
          media_type = ?, 
          backdrop_loops = ?,
          genres = ?,
          trailer_key = ?
        WHERE id = ?
      `);
      stmt.run(
        show.title,
        show.synopsis || '',
        show.rating || 0.0,
        show.year || null,
        show.studio || '',
        show.director || '',
        show.writer || '',
        JSON.stringify(cast),
        show.poster_path || '',
        show.backdrop_path || '',
        show.media_type || 'anime',
        JSON.stringify(loops),
        show.genres || existing.genres || '',
        trailer_key,
        show.id
      );
    } else {
      const stmt = db.prepare(`
        INSERT INTO shows (id, title, synopsis, rating, year, studio, director, writer, cast_members, poster_path, backdrop_path, media_type, backdrop_loops, genres, trailer_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        show.id,
        show.title,
        show.synopsis || '',
        show.rating || 0.0,
        show.year || null,
        show.studio || '',
        show.director || '',
        show.writer || '',
        JSON.stringify(cast),
        show.poster_path || '',
        show.backdrop_path || '',
        show.media_type || 'anime',
        JSON.stringify(loops),
        show.genres || '',
        trailer_key
      );
    }
  },
  deleteShow: (id) => {
    const stmt = db.prepare("DELETE FROM shows WHERE id = ?");
    stmt.run(id);
  },

  // Episodes
  getEpisodes: (showId) => {
    const stmt = db.prepare("SELECT * FROM episodes WHERE show_id = ? ORDER BY season_number, episode_number");
    return stmt.all(showId);
  },
  getEpisode: (id) => {
    const stmt = db.prepare("SELECT * FROM episodes WHERE id = ?");
    return stmt.get(id);
  },
  saveEpisode: (ep) => {
    const existing = dbHelper.getEpisode(ep.id);
    const thumbPath = ep.thumbnail_path !== undefined ? ep.thumbnail_path : (existing && existing.thumbnail_path ? existing.thumbnail_path : '');

    let audio = [];
    if (ep.audio_tracks !== undefined) {
      if (Array.isArray(ep.audio_tracks)) {
        audio = ep.audio_tracks;
      } else if (typeof ep.audio_tracks === 'string') {
        try { audio = JSON.parse(ep.audio_tracks); } catch(e) { audio = []; }
      }
    } else if (existing && existing.audio_tracks) {
      try { audio = JSON.parse(existing.audio_tracks); } catch(e) { audio = []; }
    }

    let sub = [];
    if (ep.subtitle_tracks !== undefined) {
      if (Array.isArray(ep.subtitle_tracks)) {
        sub = ep.subtitle_tracks;
      } else if (typeof ep.subtitle_tracks === 'string') {
        try { sub = JSON.parse(ep.subtitle_tracks); } catch(e) { sub = []; }
      }
    } else if (existing && existing.subtitle_tracks) {
      try { sub = JSON.parse(existing.subtitle_tracks); } catch(e) { sub = []; }
    }

    const intro_start = ep.intro_start !== undefined ? ep.intro_start : (existing && existing.intro_start !== undefined ? existing.intro_start : null);
    const intro_end = ep.intro_end !== undefined ? ep.intro_end : (existing && existing.intro_end !== undefined ? existing.intro_end : null);
    const outro_start = ep.outro_start !== undefined ? ep.outro_start : (existing && existing.outro_start !== undefined ? existing.outro_start : null);

    if (existing) {
      const stmt = db.prepare(`
        UPDATE episodes SET 
          show_id = ?, 
          season_number = ?, 
          episode_number = ?, 
          title = ?, 
          synopsis = ?, 
          filepath = ?, 
          duration = ?, 
          size = ?, 
          video_codec = ?, 
          resolution = ?, 
          fps = ?, 
          audio_tracks = ?, 
          subtitle_tracks = ?, 
          thumbnail_path = ?,
          intro_start = ?,
          intro_end = ?,
          outro_start = ?
        WHERE id = ?
      `);
      stmt.run(
        ep.show_id,
        ep.season_number,
        ep.episode_number,
        ep.title || '',
        ep.synopsis || '',
        ep.filepath,
        ep.duration || 0,
        ep.size || 0,
        ep.video_codec || '',
        ep.resolution || '',
        ep.fps || 0.0,
        JSON.stringify(audio),
        JSON.stringify(sub),
        thumbPath,
        intro_start,
        intro_end,
        outro_start,
        ep.id
      );
    } else {
      const stmt = db.prepare(`
        INSERT INTO episodes (id, show_id, season_number, episode_number, title, synopsis, filepath, duration, size, video_codec, resolution, fps, audio_tracks, subtitle_tracks, thumbnail_path, intro_start, intro_end, outro_start)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        ep.id,
        ep.show_id,
        ep.season_number,
        ep.episode_number,
        ep.title || '',
        ep.synopsis || '',
        ep.filepath,
        ep.duration || 0,
        ep.size || 0,
        ep.video_codec || '',
        ep.resolution || '',
        ep.fps || 0.0,
        JSON.stringify(audio),
        JSON.stringify(sub),
        thumbPath,
        intro_start,
        intro_end,
        outro_start
      );
    }
  },

  // Watch History
  getHistory: (username = 'guest') => {
    const stmt = db.prepare(`
      SELECT h.*, e.title as episode_title, e.episode_number, e.season_number, s.id as show_id, s.title as show_title, s.poster_path, e.thumbnail_path, e.duration
      FROM watch_history h
      JOIN episodes e ON h.episode_id = e.id
      JOIN shows s ON e.show_id = s.id
      WHERE h.username = ? AND h.episode_id = (
        SELECT h2.episode_id
        FROM watch_history h2
        JOIN episodes e2 ON h2.episode_id = e2.id
        WHERE e2.show_id = s.id AND h2.username = ?
        ORDER BY h2.updated_at DESC, e2.season_number DESC, e2.episode_number DESC
        LIMIT 1
      )
      ORDER BY h.updated_at DESC
    `);
    const history = stmt.all(username, username);
    
    const nextEpStmt = db.prepare(`
      SELECT * FROM episodes
      WHERE show_id = ?
        AND (season_number > ? OR (season_number = ? AND episode_number > ?))
      ORDER BY season_number ASC, episode_number ASC
      LIMIT 1
    `);

    const processedHistory = [];
    for (const entry of history) {
      if (entry.duration && entry.progress_seconds >= 0.95 * entry.duration) {
        const nextEp = nextEpStmt.get(entry.show_id, entry.season_number, entry.season_number, entry.episode_number);
        
        if (nextEp) {
          processedHistory.push({
            username: entry.username,
            episode_id: nextEp.id,
            progress_seconds: 0,
            updated_at: entry.updated_at,
            episode_title: nextEp.title,
            episode_number: nextEp.episode_number,
            season_number: nextEp.season_number,
            show_id: entry.show_id,
            show_title: entry.show_title,
            poster_path: entry.poster_path,
            thumbnail_path: nextEp.thumbnail_path,
            duration: nextEp.duration
          });
        }
      } else {
        processedHistory.push(entry);
      }
    }
    return processedHistory;
  },
  getWatchProgress: (username = 'guest', episodeId) => {
    const stmt = db.prepare(`
      SELECT h.progress_seconds, e.duration
      FROM watch_history h
      LEFT JOIN episodes e ON h.episode_id = e.id
      WHERE h.username = ? AND h.episode_id = ?
    `);
    const result = stmt.get(username, episodeId);
    if (!result) return 0;
    
    // Reset to 0 if progress is >= 95% of duration
    if (result.duration && result.progress_seconds >= 0.95 * result.duration) {
      return 0;
    }
    return result.progress_seconds;
  },
  saveWatchProgress: (username = 'guest', episodeId, progressSeconds) => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO watch_history (username, episode_id, progress_seconds, updated_at)
      VALUES (?, ?, ?, datetime('now'))
    `);
    stmt.run(username, episodeId, progressSeconds);
  },
  transferGuestHistory: (username) => {
    if (!username || username === 'guest') return;
    try {
      // Find all guest watch history records
      const guestRecords = db.prepare("SELECT * FROM watch_history WHERE username = 'guest'").all();
      
      for (const record of guestRecords) {
        // Check if user already has progress for this episode
        const userRecord = db.prepare("SELECT progress_seconds FROM watch_history WHERE username = ? AND episode_id = ?").get(username, record.episode_id);
        
        if (userRecord) {
          // Keep the record with maximum progress
          if (record.progress_seconds > userRecord.progress_seconds) {
            db.prepare(`
              UPDATE watch_history 
              SET progress_seconds = ?, updated_at = datetime('now')
              WHERE username = ? AND episode_id = ?
            `).run(record.progress_seconds, username, record.episode_id);
          }
        } else {
          // Transfer the record directly by creating a new one
          db.prepare(`
            INSERT INTO watch_history (username, episode_id, progress_seconds, updated_at)
            VALUES (?, ?, ?, ?)
          `).run(username, record.episode_id, record.progress_seconds, record.updated_at);
        }
      }
      
      // Delete guest records after transfer
      db.prepare("DELETE FROM watch_history WHERE username = 'guest'").run();
    } catch (e) {
      console.error("Failed to transfer guest watch history:", e);
    }
  },

  // Settings
  getSetting: (key) => {
    const stmt = db.prepare("SELECT value FROM settings WHERE key = ?");
    const result = stmt.get(key);
    return result ? result.value : null;
  },
  saveSetting: (key, value) => {
    const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    stmt.run(key, value);
  },
  // Users
  getUser: (username) => {
    const stmt = db.prepare("SELECT * FROM users WHERE username = ?");
    return stmt.get(username);
  },
  createUser: (username, password, role = 'user') => {
    const stmt = db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)");
    stmt.run(username, password, role);
  },

  // Chat
  getChatMessages: (limit = 50) => {
    const stmt = db.prepare("SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?");
    const msgs = stmt.all(limit);
    return msgs.reverse();
  },
  saveChatMessage: (username, message) => {
    const stmt = db.prepare("INSERT INTO chat_messages (username, message, created_at) VALUES (?, ?, datetime('now'))");
    stmt.run(username, message);
  },

  // Comments
  getComments: (showId) => {
    const stmt = db.prepare("SELECT * FROM comments WHERE show_id = ? ORDER BY id ASC");
    return stmt.all(showId);
  },
  saveComment: (showId, username, comment) => {
    const stmt = db.prepare("INSERT INTO comments (show_id, username, comment, created_at) VALUES (?, ?, ?, datetime('now'))");
    stmt.run(showId, username, comment);
  },

  getStats: () => {
    const showsCount = db.prepare("SELECT COUNT(*) as count FROM shows").get().count;
    const animeCount = db.prepare("SELECT COUNT(*) as count FROM shows WHERE media_type = 'anime'").get().count;
    const movieCount = db.prepare("SELECT COUNT(*) as count FROM shows WHERE media_type = 'movie'").get().count;
    const episodesCount = db.prepare("SELECT COUNT(*) as count FROM episodes").get().count;
    const totalSize = db.prepare("SELECT SUM(size) as size FROM episodes").get().size || 0;
    const totalDuration = db.prepare("SELECT SUM(duration) as duration FROM episodes").get().duration || 0;
    return { showsCount, animeCount, movieCount, episodesCount, totalSize, totalDuration };
  },

  // Favorites (My List)
  getFavorites: (username) => {
    if (!username) return [];
    const stmt = db.prepare(`
      SELECT s.*
      FROM favorites f
      JOIN shows s ON f.show_id = s.id
      WHERE f.username = ?
      ORDER BY s.title ASC
    `);
    return stmt.all(username);
  },
  isFavorite: (username, showId) => {
    if (!username || !showId) return false;
    const stmt = db.prepare("SELECT 1 FROM favorites WHERE username = ? AND show_id = ?");
    return !!stmt.get(username, showId);
  },
  toggleFavorite: (username, showId, isFav) => {
    if (!username || !showId) return;
    if (isFav) {
      const stmt = db.prepare("INSERT OR IGNORE INTO favorites (username, show_id) VALUES (?, ?)");
      stmt.run(username, showId);
    } else {
      const stmt = db.prepare("DELETE FROM favorites WHERE username = ? AND show_id = ?");
      stmt.run(username, showId);
    }
  }
};
