<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/middleware/RateLimiter.php';

class Database {
    private static ?PDO $pdo = null;

    public static function setConnection(?PDO $customPdo): void {
        self::$pdo = $customPdo;
    }

    public static function getConnection(): PDO {
        if (self::$pdo === null) {
            try {
                // Connect directly to kurastream DB
                self::$pdo = new PDO(
                    "mysql:host=" . DB_HOST . ";port=" . DB_PORT . ";dbname=" . DB_NAME . ";charset=utf8mb4",
                    DB_USER,
                    DB_PASS,
                    [
                        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                        PDO::ATTR_TIMEOUT => 2
                    ]
                );
            } catch (PDOException $e) {
                error_log("Database Connection Error: " . $e->getMessage());
                if (defined('TESTING_MODE')) {
                    throw new PDOException("Database connection error (sanitized)", (int)$e->getCode());
                }
                jsonError("Database Connection Failed. Please check server logs.", 500);
            }
            if (!defined('TESTING_MODE')) {
                self::applyPendingMigrations(self::$pdo);
            }
        }
        return self::$pdo;
    }

    /**
     * Brings the schema up to date after a code update, so new columns exist before any query uses them.
     * A marker file keyed on the newest migration keeps this to a filesystem check on normal requests.
     */
    private static function applyPendingMigrations(PDO $pdo): void {
        $files = glob(__DIR__ . '/migrations/*.sql') ?: [];
        if (empty($files)) {
            return;
        }
        sort($files);
        $latest = basename(end($files));
        $marker = sys_get_temp_dir() . '/kurastream_schema_' . md5(DB_HOST . '|' . DB_PORT . '|' . DB_NAME) . '.txt';
        if (@file_get_contents($marker) === $latest) {
            return;
        }

        require_once __DIR__ . '/services/MigrationManager.php';
        // Several server workers can get here at once; only one may run the ALTER statements.
        $locked = (int)$pdo->query("SELECT GET_LOCK('kurastream_migrations', 30)")->fetchColumn() === 1;
        try {
            MigrationManager::runPending($pdo);
            @file_put_contents($marker, $latest);
        } catch (Throwable $e) {
            error_log('KuraStream migration error: ' . $e->getMessage());
        } finally {
            if ($locked) {
                $pdo->query("SELECT RELEASE_LOCK('kurastream_migrations')");
            }
        }
    }

    public static function initializeSchema(?PDO $customPdo = null): array {
        $db = $customPdo ?: self::getConnection();
        require_once __DIR__ . '/services/MigrationManager.php';
        return MigrationManager::runPending($db);
    }
}

class DbHelper {
    /**
     * Runs $work atomically. Joins an already-open transaction instead of nesting
     * (PDO/MySQL has no nested transactions).
     */
    public static function transactional(callable $work) {
        $db = Database::getConnection();
        if ($db->inTransaction()) {
            return $work($db);
        }
        $db->beginTransaction();
        try {
            $result = $work($db);
            $db->commit();
            return $result;
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->rollBack();
            throw $e;
        }
    }

    public static function getShows($type = 'all', $isKids = false): array {
        $db = Database::getConnection();
        $sql = "SELECT * FROM shows";
        $params = [];

        if ($type !== 'all') {
            $sql .= " WHERE media_type = :type";
            $params['type'] = $type;
        }

        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        $shows = $stmt->fetchAll();

        return array_map(function($s) {
            $s['rating'] = (float)$s['rating'];
            $s['year'] = $s['year'] !== null ? (int)$s['year'] : null;
            return $s;
        }, $shows);
    }

    public static function getShow($id): ?array {
        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM shows WHERE id = :id");
        $stmt->execute(['id' => $id]);
        $show = $stmt->fetch();
        if (!$show) return null;
        $show['rating'] = (float)$show['rating'];
        $show['year'] = $show['year'] !== null ? (int)$show['year'] : null;
        return $show;
    }

    public static function findShowByFolderOrTitle(string $folder, string $title): ?array {
        $db = Database::getConnection();
        $cleanFolder = str_replace('_', ' ', $folder);
        $cleanTitle = trim($title);

        $prefix = '%' . trim(str_replace('_', '%', $folder)) . '%';
        $stmt = $db->prepare("
            SELECT * FROM shows 
            WHERE id = :f1 
               OR id = :f2 
               OR LOWER(title) = LOWER(:t1) 
               OR LOWER(title) = LOWER(:t2)
               OR LOWER(title) LIKE LOWER(:p1)
               OR LOWER(id) LIKE LOWER(:p2)
            LIMIT 1
        ");
        $stmt->execute([
            'f1' => $folder,
            'f2' => strtolower(preg_replace('/[^A-Za-z0-9]+/', '_', $folder)),
            't1' => $cleanFolder,
            't2' => $cleanTitle,
            'p1' => $prefix,
            'p2' => $prefix
        ]);
        $show = $stmt->fetch();
        if (!$show) return null;
        $show['rating'] = (float)$show['rating'];
        $show['year'] = $show['year'] !== null ? (int)$show['year'] : null;
        return $show;
    }

    public static function getProgress(string $username, string $profile, string $episodeId): ?array {
        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM watch_history WHERE username = :u AND profile_name = :p AND episode_id = :e");
        $stmt->execute(['u' => $username, 'p' => $profile, 'e' => $episodeId]);
        $row = $stmt->fetch();
        if (!$row) return null;
        return [
            'progress' => (float)$row['progress_seconds'],
            'completed' => (bool)$row['completed'],
            'duration' => (float)$row['duration']
        ];
    }

    public static function saveProgress(string $username, string $profile, string $episodeId, float $progress, float $duration = 0, ?bool $completed = null): void {
        $db = Database::getConnection();
        
        if ($duration <= 0) {
            $ep = self::getEpisode($episodeId);
            if ($ep && !empty($ep['duration'])) {
                $duration = (float)$ep['duration'];
            }
        }

        if ($duration > 0) {
            $progress = max(0.0, min($progress, $duration));
            if ($completed === null) {
                $completed = ($progress >= ($duration * 0.9));
            }
        } else {
            $progress = max(0.0, min($progress, 86400.0));
            $completed = (bool)$completed;
        }

        $stmt = $db->prepare("
            INSERT INTO watch_history (username, profile_name, episode_id, progress_seconds, duration, completed)
            VALUES (:u, :p, :e, :prog, :dur, :comp)
            ON DUPLICATE KEY UPDATE 
                progress_seconds = VALUES(progress_seconds),
                duration = IF(VALUES(duration) > 0, VALUES(duration), duration),
                completed = VALUES(completed)
        ");
        $stmt->execute([
            'u' => $username,
            'p' => $profile,
            'e' => $episodeId,
            'prog' => $progress,
            'dur' => $duration,
            'comp' => $completed ? 1 : 0
        ]);
    }

    public static function saveShow(array $show): void {
        $db = Database::getConnection();
        $existing = self::getShow($show['id']);

        $cast = [];
        if (isset($show['cast_members'])) {
            $cast = is_array($show['cast_members']) ? $show['cast_members'] : json_decode($show['cast_members'], true);
        } else if ($existing && !empty($existing['cast_members'])) {
            $cast = json_decode($existing['cast_members'], true);
        }

        $loops = [];
        if (isset($show['backdrop_loops'])) {
            $loops = is_array($show['backdrop_loops']) ? $show['backdrop_loops'] : json_decode($show['backdrop_loops'], true);
        } else if ($existing && !empty($existing['backdrop_loops'])) {
            $loops = json_decode($existing['backdrop_loops'], true);
        }

        $tmdbId = !empty($show['tmdb_id']) ? (int)$show['tmdb_id'] : ($existing['tmdb_id'] ?? null);

        $stmt = $db->prepare("
            INSERT INTO shows (id, title, synopsis, rating, year, studio, director, writer, cast_members, poster_path, backdrop_path, media_type, backdrop_loops, genres, trailer_key, age_rating, status, tmdb_id)
            VALUES (:id, :title, :synopsis, :rating, :year, :studio, :director, :writer, :cast_members, :poster_path, :backdrop_path, :media_type, :backdrop_loops, :genres, :trailer_key, :age_rating, :status, :tmdb_id)
            ON DUPLICATE KEY UPDATE
                title = VALUES(title),
                synopsis = VALUES(synopsis),
                rating = VALUES(rating),
                year = VALUES(year),
                studio = VALUES(studio),
                director = VALUES(director),
                writer = VALUES(writer),
                cast_members = VALUES(cast_members),
                poster_path = VALUES(poster_path),
                backdrop_path = VALUES(backdrop_path),
                media_type = VALUES(media_type),
                backdrop_loops = VALUES(backdrop_loops),
                genres = VALUES(genres),
                trailer_key = VALUES(trailer_key),
                age_rating = VALUES(age_rating),
                status = VALUES(status),
                tmdb_id = COALESCE(VALUES(tmdb_id), tmdb_id)
        ");

        $stmt->execute([
            'id' => $show['id'],
            'title' => $show['title'],
            'synopsis' => $show['synopsis'] ?? '',
            'rating' => $show['rating'] ?? 0.0,
            'year' => $show['year'] ?? null,
            'studio' => $show['studio'] ?? '',
            'director' => $show['director'] ?? '',
            'writer' => $show['writer'] ?? '',
            'cast_members' => json_encode($cast ?: []),
            'poster_path' => $show['poster_path'] ?? '',
            'backdrop_path' => $show['backdrop_path'] ?? '',
            'media_type' => $show['media_type'] ?? 'anime',
            'backdrop_loops' => json_encode($loops ?: []),
            'genres' => $show['genres'] ?? '',
            'trailer_key' => $show['trailer_key'] ?? null,
            'age_rating' => $show['age_rating'] ?? 'TV-14',
            'status' => $show['status'] ?? 'finished',
            'tmdb_id' => $tmdbId
        ]);
    }

    public static function deleteShow($id): void {
        // All-or-nothing: a failure halfway used to leave a show without episodes (or orphan favorites).
        self::transactional(function (PDO $db) use ($id) {
            $db->prepare("DELETE FROM watch_history WHERE episode_id IN (SELECT id FROM episodes WHERE show_id = :id)")->execute(['id' => $id]);
            $db->prepare("DELETE FROM episodes WHERE show_id = :id")->execute(['id' => $id]);
            $db->prepare("DELETE FROM favorites WHERE show_id = :id")->execute(['id' => $id]);
            try {
                $db->prepare("DELETE FROM show_seasons WHERE show_id = :id")->execute(['id' => $id]);
            } catch (Throwable $e) {
                // Schemas from before migration 010 have no seasons table.
            }
            $db->prepare("DELETE FROM shows WHERE id = :id")->execute(['id' => $id]);
        });
    }

    public static function updateShowStatus(string $showId, string $status): bool {
        $db = Database::getConnection();
        $stmt = $db->prepare("UPDATE shows SET status = :status WHERE id = :id");
        return $stmt->execute(['status' => $status, 'id' => $showId]);
    }

    public static function updateShowTmdbId(string $showId, string $tmdbId): bool {
        $db = Database::getConnection();
        $stmt = $db->prepare("UPDATE shows SET tmdb_id = :tmdb_id WHERE id = :id");
        return $stmt->execute(['tmdb_id' => $tmdbId, 'id' => $showId]);
    }

    public static function getUserPreferences(string $username, string $profile = 'Principal'): array {
        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM user_preferences WHERE username = :u AND profile_name = :p");
        $stmt->execute(['u' => $username, 'p' => $profile]);
        $row = $stmt->fetch();
        if (!$row) {
            return [
                'auto_skip_intro' => false,
                'auto_play_next' => true,
                'preferred_audio_language' => 'jpn',
                'preferred_subtitle_language' => 'spa',
                'audio_boost' => 100,
                'audio_preset' => 'flat',
                'notifications_enabled' => true
            ];
        }
        return [
            'auto_skip_intro' => (bool)$row['auto_skip_intro'],
            'auto_play_next' => (bool)$row['auto_play_next'],
            'preferred_audio_language' => !empty($row['preferred_audio_language']) ? (string)$row['preferred_audio_language'] : 'jpn',
            'preferred_subtitle_language' => !empty($row['preferred_subtitle_language']) ? (string)$row['preferred_subtitle_language'] : 'spa',
            'audio_boost' => isset($row['audio_boost']) ? (int)$row['audio_boost'] : 100,
            'audio_preset' => !empty($row['audio_preset']) ? (string)$row['audio_preset'] : 'flat',
            'notifications_enabled' => array_key_exists('notifications_enabled', $row) ? (bool)$row['notifications_enabled'] : true
        ];
    }

    public static function saveUserPreferences(string $username, string $profile, array $data): void {
        $db = Database::getConnection();
        $existing = self::getUserPreferences($username, $profile);
        $autoSkip = isset($data['auto_skip_intro']) ? (int)(bool)$data['auto_skip_intro'] : (int)$existing['auto_skip_intro'];
        $autoPlay = isset($data['auto_play_next']) ? (int)(bool)$data['auto_play_next'] : (int)$existing['auto_play_next'];
        $prefAudio = isset($data['preferred_audio_language']) ? trim((string)$data['preferred_audio_language']) : ($existing['preferred_audio_language'] ?? 'jpn');
        $prefSub = isset($data['preferred_subtitle_language']) ? trim((string)$data['preferred_subtitle_language']) : ($existing['preferred_subtitle_language'] ?? 'spa');
        $audioBoost = isset($data['audio_boost']) ? (int)$data['audio_boost'] : (int)($existing['audio_boost'] ?? 100);
        $audioPreset = isset($data['audio_preset']) ? trim((string)$data['audio_preset']) : ($existing['audio_preset'] ?? 'flat');
        $notificationsEnabled = isset($data['notifications_enabled']) ? (int)(bool)$data['notifications_enabled'] : (int)$existing['notifications_enabled'];

        $stmt = $db->prepare("
            INSERT INTO user_preferences (username, profile_name, auto_skip_intro, auto_play_next, preferred_audio_language, preferred_subtitle_language, audio_boost, audio_preset, notifications_enabled)
            VALUES (:u, :p, :skip, :play, :pref_audio, :pref_sub, :boost, :preset, :notif)
            ON DUPLICATE KEY UPDATE 
                auto_skip_intro = VALUES(auto_skip_intro), 
                auto_play_next = VALUES(auto_play_next),
                preferred_audio_language = VALUES(preferred_audio_language),
                preferred_subtitle_language = VALUES(preferred_subtitle_language),
                audio_boost = VALUES(audio_boost),
                audio_preset = VALUES(audio_preset),
                notifications_enabled = VALUES(notifications_enabled)
        ");
        $stmt->execute([
            'u' => $username,
            'p' => $profile,
            'skip' => $autoSkip,
            'play' => $autoPlay,
            'pref_audio' => $prefAudio,
            'pref_sub' => $prefSub,
            'boost' => $audioBoost,
            'preset' => $audioPreset,
            'notif' => $notificationsEnabled
        ]);
    }

    public static function getEpisode($id): ?array {
        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM episodes WHERE id = :id");
        $stmt->execute(['id' => $id]);
        $ep = $stmt->fetch();

        if (!$ep) {
            $lastS = strrpos($id, '_S');
            if ($lastS !== false) {
                $prefix = substr($id, 0, $lastS);
                $suffix = substr($id, $lastS);
                
                $cand1 = str_replace('_', ' ', $prefix) . $suffix;
                $stmt->execute(['id' => $cand1]);
                $ep = $stmt->fetch();
                
                if (!$ep) {
                    $cand2 = str_replace(' ', '_', $prefix) . $suffix;
                    $stmt->execute(['id' => $cand2]);
                    $ep = $stmt->fetch();
                }
            }
        }

        if (!$ep) {
            $candSpaces = str_replace('_', ' ', $id);
            $stmt->execute(['id' => $candSpaces]);
            $ep = $stmt->fetch();
        }

        if (!$ep) return null;
        $ep['audio_tracks'] = !empty($ep['audio_tracks']) ? (is_array($ep['audio_tracks']) ? $ep['audio_tracks'] : json_decode($ep['audio_tracks'], true)) : [];
        if (is_string($ep['audio_tracks'])) {
            $ep['audio_tracks'] = json_decode($ep['audio_tracks'], true) ?: [];
        }
        $ep['subtitle_tracks'] = !empty($ep['subtitle_tracks']) ? (is_array($ep['subtitle_tracks']) ? $ep['subtitle_tracks'] : json_decode($ep['subtitle_tracks'], true)) : [];
        if (is_string($ep['subtitle_tracks'])) {
            $ep['subtitle_tracks'] = json_decode($ep['subtitle_tracks'], true) ?: [];
        }
        $ep['chapters'] = !empty($ep['chapters']) ? (is_array($ep['chapters']) ? $ep['chapters'] : json_decode($ep['chapters'], true)) : [];
        if (is_string($ep['chapters'])) {
            $ep['chapters'] = json_decode($ep['chapters'], true) ?: [];
        }
        return $ep;
    }

    /**
     * Timings typed by an admin: only the timing fields, marked 'manual' so neither the AniSkip
     * sync nor the audio pass replaces them.
     */
    public static function manualTimings(array $data): array {
        $out = array_intersect_key($data, array_flip(['intro_start', 'intro_end', 'outro_start', 'outro_end', 'chapters']));
        if (array_key_exists('intro_start', $out) || array_key_exists('intro_end', $out)) $out['intro_source'] = 'manual';
        if (array_key_exists('outro_start', $out) || array_key_exists('outro_end', $out)) $out['outro_source'] = 'manual';
        return $out;
    }

    public static function saveEpisodeTimestamps(string $id, array $data): bool {
        $db = Database::getConnection();
        $ep = self::getEpisode($id);
        if (!$ep) return false;

        $introStart = array_key_exists('intro_start', $data) ? ($data['intro_start'] !== null ? (int)$data['intro_start'] : null) : $ep['intro_start'];
        $introEnd = array_key_exists('intro_end', $data) ? ($data['intro_end'] !== null ? (int)$data['intro_end'] : null) : $ep['intro_end'];
        $outroStart = array_key_exists('outro_start', $data) ? ($data['outro_start'] !== null ? (int)$data['outro_start'] : null) : $ep['outro_start'];
        
        $chapters = array_key_exists('chapters', $data) ? $data['chapters'] : ($ep['chapters'] ?? []);
        $chaptersJson = is_array($chapters) ? json_encode($chapters) : $chapters;

        $params = [
            'id' => $ep['id'],
            'intro_start' => $introStart,
            'intro_end' => $introEnd,
            'outro_start' => $outroStart,
            'chapters' => $chaptersJson
        ];
        // Only touched when the caller says where the timings came from (older schemas lack the columns).
        $sourceSql = '';
        if (array_key_exists('intro_source', $data)) {
            $sourceSql = ', intro_source = :intro_source, intro_checked_at = CURRENT_TIMESTAMP';
            $params['intro_source'] = $data['intro_source'];
        }
        if (array_key_exists('outro_source', $data)) {
            $sourceSql .= ', outro_source = :outro_source, outro_checked_at = CURRENT_TIMESTAMP';
            $params['outro_source'] = $data['outro_source'];
        }
        if (array_key_exists('outro_end', $data)) {
            $sourceSql .= ', outro_end = :outro_end';
            $params['outro_end'] = $data['outro_end'] !== null ? (int)$data['outro_end'] : null;
        }

        $stmt = $db->prepare("
            UPDATE episodes
            SET intro_start = :intro_start,
                intro_end = :intro_end,
                outro_start = :outro_start,
                chapters = :chapters{$sourceSql}
            WHERE id = :id
        ");

        $stmt->execute($params);
        return true;
    }

    /** Seasons of a show with their own artwork, regular seasons in order and specials last. */
    public static function getShowSeasons(string $showId): array {
        $db = Database::getConnection();
        try {
            $stmt = $db->prepare("SELECT * FROM show_seasons WHERE show_id = :id");
            $stmt->execute(['id' => $showId]);
            $rows = $stmt->fetchAll();
        } catch (Throwable $e) {
            return [];
        }
        usort($rows, fn($a, $b) => [(int)$a['season_number'] <= 0 ? 1 : 0, (int)$a['season_number']]
            <=> [(int)$b['season_number'] <= 0 ? 1 : 0, (int)$b['season_number']]);
        return $rows;
    }

    public static function getShowSeason(string $showId, int $season): ?array {
        foreach (self::getShowSeasons($showId) as $row) {
            if ((int)$row['season_number'] === $season) return $row;
        }
        return null;
    }

    public static function saveShowSeason(array $row): void {
        $db = Database::getConnection();
        $stmt = $db->prepare("
            INSERT INTO show_seasons (show_id, season_number, name, title, synopsis, year, air_date, episode_count, status, poster_path, backdrop_path, anilist_id, mal_id, mal_map, synced_at)
            VALUES (:show_id, :season_number, :name, :title, :synopsis, :year, :air_date, :episode_count, :status, :poster_path, :backdrop_path, :anilist_id, :mal_id, :mal_map, CURRENT_TIMESTAMP)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                title = VALUES(title),
                synopsis = VALUES(synopsis),
                year = VALUES(year),
                air_date = VALUES(air_date),
                episode_count = VALUES(episode_count),
                status = VALUES(status),
                poster_path = VALUES(poster_path),
                backdrop_path = VALUES(backdrop_path),
                anilist_id = VALUES(anilist_id),
                mal_id = VALUES(mal_id),
                mal_map = VALUES(mal_map),
                synced_at = CURRENT_TIMESTAMP
        ");
        $stmt->execute([
            'show_id' => $row['show_id'],
            'season_number' => (int)$row['season_number'],
            'name' => $row['name'] ?? '',
            'title' => $row['title'] ?? '',
            'synopsis' => $row['synopsis'] ?? '',
            'year' => $row['year'] ?? null,
            'air_date' => !empty($row['air_date']) ? $row['air_date'] : null,
            'episode_count' => $row['episode_count'] ?? null,
            'status' => $row['status'] ?? null,
            'poster_path' => $row['poster_path'] ?? '',
            'backdrop_path' => $row['backdrop_path'] ?? '',
            'anilist_id' => $row['anilist_id'] ?? null,
            'mal_id' => $row['mal_id'] ?? null,
            'mal_map' => json_encode($row['mal_map'] ?? [])
        ]);
    }

    public static function serializeSeasonForClient(array $row): array {
        return [
            'season_number' => (int)$row['season_number'],
            'name' => $row['name'] ?? '',
            'title' => $row['title'] ?? '',
            'synopsis' => $row['synopsis'] ?? '',
            'year' => isset($row['year']) && $row['year'] !== null ? (int)$row['year'] : null,
            'episode_count' => isset($row['episode_count']) && $row['episode_count'] !== null ? (int)$row['episode_count'] : null,
            'status' => $row['status'] ?? null,
            'poster_path' => $row['poster_path'] ?? '',
            'backdrop_path' => $row['backdrop_path'] ?? '',
            'mal_id' => isset($row['mal_id']) && $row['mal_id'] !== null ? (int)$row['mal_id'] : null,
            'anilist_id' => isset($row['anilist_id']) && $row['anilist_id'] !== null ? (int)$row['anilist_id'] : null
        ];
    }

    public static function updateEpisodeDetails(string $epId, string $title, ?string $synopsis = null): bool {
        $db = Database::getConnection();
        if ($synopsis !== null) {
            $stmt = $db->prepare("UPDATE episodes SET title = :t, synopsis = :s WHERE id = :id");
            return $stmt->execute(['t' => $title, 's' => $synopsis, 'id' => $epId]);
        } else {
            $stmt = $db->prepare("UPDATE episodes SET title = :t WHERE id = :id");
            return $stmt->execute(['t' => $title, 'id' => $epId]);
        }
    }

    public static function getEpisodesForShow($showId): array {
        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM episodes WHERE show_id = :show_id ORDER BY season_number ASC, episode_number ASC");
        $stmt->execute(['show_id' => $showId]);
        $episodes = $stmt->fetchAll();

        return array_map(function($e) {
            $e['audio_tracks'] = !empty($e['audio_tracks']) ? json_decode($e['audio_tracks'], true) : [];
            $e['subtitle_tracks'] = !empty($e['subtitle_tracks']) ? json_decode($e['subtitle_tracks'], true) : [];
            $e['chapters'] = !empty($e['chapters']) ? json_decode($e['chapters'], true) : [];
            return $e;
        }, $episodes);
    }

    public static function serializeEpisodeForClient(array $ep): array {
        $ext = !empty($ep['filepath']) ? strtolower(pathinfo($ep['filepath'], PATHINFO_EXTENSION)) : '';
        $isDirect = ($ext === 'mp4' || $ext === 'webm');
        $container = !empty($ext) ? $ext : 'unknown';

        $audioTracks = !empty($ep['audio_tracks']) 
            ? (is_array($ep['audio_tracks']) ? $ep['audio_tracks'] : json_decode($ep['audio_tracks'], true)) 
            : [];
        $subtitleTracks = !empty($ep['subtitle_tracks']) 
            ? (is_array($ep['subtitle_tracks']) ? $ep['subtitle_tracks'] : json_decode($ep['subtitle_tracks'], true)) 
            : [];
        $chapters = !empty($ep['chapters']) 
            ? (is_array($ep['chapters']) ? $ep['chapters'] : json_decode($ep['chapters'], true)) 
            : [];

        return [
            'id' => $ep['id'],
            'show_id' => $ep['show_id'] ?? '',
            'season_number' => (int)($ep['season_number'] ?? 1),
            'episode_number' => (int)($ep['episode_number'] ?? 1),
            'title' => $ep['title'] ?? '',
            'synopsis' => $ep['synopsis'] ?? '',
            'duration' => (float)($ep['duration'] ?? 0.0),
            'size' => (int)($ep['size'] ?? 0),
            'video_codec' => $ep['video_codec'] ?? '',
            'audio_codec' => $ep['audio_codec'] ?? '',
            'resolution' => $ep['resolution'] ?? '',
            'fps' => (float)($ep['fps'] ?? 0.0),
            'audio_tracks' => $audioTracks ?: [],
            'subtitle_tracks' => $subtitleTracks ?: [],
            'thumbnail_path' => $ep['thumbnail_path'] ?? '',
            'intro_start' => isset($ep['intro_start']) && $ep['intro_start'] !== null ? (float)$ep['intro_start'] : null,
            'intro_end' => isset($ep['intro_end']) && $ep['intro_end'] !== null ? (float)$ep['intro_end'] : null,
            'outro_start' => isset($ep['outro_start']) && $ep['outro_start'] !== null ? (float)$ep['outro_start'] : null,
            // End of the ending credits; a scene may follow it (null: credits run to the end).
            'outro_end' => isset($ep['outro_end']) && $ep['outro_end'] !== null ? (float)$ep['outro_end'] : null,
            // Where the timings came from (aniskip, audio, chapters...); shown in the admin editor.
            'intro_source' => $ep['intro_source'] ?? null,
            'outro_source' => $ep['outro_source'] ?? null,
            'chapters' => $chapters ?: [],
            'created_at' => $ep['created_at'] ?? null,
            'stream_url' => "/api/stream/" . urlencode($ep['id']),
            'direct_playable' => $isDirect,
            'container' => $container
        ];
    }

    public static function saveEpisode(array $ep): void {
        $db = Database::getConnection();
        
        $hasCreatedAt = !empty($ep['created_at']);
        $hasFileMtime = isset($ep['file_mtime']);

        $cols = "id, show_id, season_number, episode_number, title, synopsis, filepath, duration, size, video_codec, resolution, fps, audio_tracks, subtitle_tracks, thumbnail_path, intro_start, intro_end, outro_start, chapters, availability_status, missing_scan_count, missing_since";
        $vals = ":id, :show_id, :season_number, :episode_number, :title, :synopsis, :filepath, :duration, :size, :video_codec, :resolution, :fps, :audio_tracks, :subtitle_tracks, :thumbnail_path, :intro_start, :intro_end, :outro_start, :chapters, 'available', 0, NULL";
        
        if ($hasCreatedAt) {
            $cols .= ", created_at";
            $vals .= ", :created_at";
        }
        if ($hasFileMtime) {
            $cols .= ", file_mtime";
            $vals .= ", :file_mtime";
        }

        $updatePart = "
            title = VALUES(title),
            synopsis = VALUES(synopsis),
            filepath = VALUES(filepath),
            duration = VALUES(duration),
            size = VALUES(size),
            video_codec = VALUES(video_codec),
            resolution = VALUES(resolution),
            fps = VALUES(fps),
            audio_tracks = VALUES(audio_tracks),
            subtitle_tracks = VALUES(subtitle_tracks),
            thumbnail_path = VALUES(thumbnail_path),
            intro_start = COALESCE(VALUES(intro_start), episodes.intro_start),
            intro_end = COALESCE(VALUES(intro_end), episodes.intro_end),
            outro_start = COALESCE(VALUES(outro_start), episodes.outro_start),
            chapters = CASE WHEN VALUES(chapters) IS NOT NULL AND VALUES(chapters) != '[]' THEN VALUES(chapters) ELSE episodes.chapters END,
            availability_status = 'available',
            missing_scan_count = 0,
            missing_since = NULL
        ";
        if ($hasFileMtime) {
            $updatePart .= ", file_mtime = VALUES(file_mtime)";
        }

        $params = [
            'id' => $ep['id'],
            'show_id' => $ep['show_id'],
            'season_number' => $ep['season_number'],
            'episode_number' => $ep['episode_number'],
            'title' => $ep['title'] ?? '',
            'synopsis' => $ep['synopsis'] ?? '',
            'filepath' => $ep['filepath'],
            'duration' => $ep['duration'] ?? 0,
            'size' => $ep['size'] ?? 0,
            'video_codec' => $ep['video_codec'] ?? '',
            'resolution' => $ep['resolution'] ?? '',
            'fps' => $ep['fps'] ?? 0,
            'audio_tracks' => is_string($ep['audio_tracks'] ?? null) ? $ep['audio_tracks'] : json_encode($ep['audio_tracks'] ?? []),
            'subtitle_tracks' => is_string($ep['subtitle_tracks'] ?? null) ? $ep['subtitle_tracks'] : json_encode($ep['subtitle_tracks'] ?? []),
            'thumbnail_path' => $ep['thumbnail_path'] ?? '',
            'intro_start' => array_key_exists('intro_start', $ep) ? $ep['intro_start'] : null,
            'intro_end' => array_key_exists('intro_end', $ep) ? $ep['intro_end'] : null,
            'outro_start' => array_key_exists('outro_start', $ep) ? $ep['outro_start'] : null,
            'chapters' => (!empty($ep['chapters']) && $ep['chapters'] !== '[]') ? (is_string($ep['chapters']) ? $ep['chapters'] : json_encode($ep['chapters'])) : null
        ];
        if ($hasCreatedAt) {
            $params['created_at'] = $ep['created_at'];
        }
        if ($hasFileMtime) {
            $params['file_mtime'] = (int)$ep['file_mtime'];
        }

        $driver = '';
        try {
            $driver = $db->getAttribute(PDO::ATTR_DRIVER_NAME);
        } catch (Throwable $e) {}

        if ($driver === 'sqlite') {
            $check = $db->prepare("SELECT id, intro_start, intro_end, outro_start, chapters FROM episodes WHERE id = :id");
            $check->execute(['id' => $ep['id']]);
            $existing = $check->fetch(PDO::FETCH_ASSOC);

            if ($existing) {
                $introStart = array_key_exists('intro_start', $ep) && $ep['intro_start'] !== null ? $ep['intro_start'] : $existing['intro_start'];
                $introEnd = array_key_exists('intro_end', $ep) && $ep['intro_end'] !== null ? $ep['intro_end'] : $existing['intro_end'];
                $outroStart = array_key_exists('outro_start', $ep) && $ep['outro_start'] !== null ? $ep['outro_start'] : $existing['outro_start'];
                $chapters = (!empty($ep['chapters']) && $ep['chapters'] !== '[]') ? (is_string($ep['chapters']) ? $ep['chapters'] : json_encode($ep['chapters'])) : $existing['chapters'];

                $stmt = $db->prepare("
                    UPDATE episodes SET
                        title = :title,
                        synopsis = :synopsis,
                        filepath = :filepath,
                        duration = :duration,
                        size = :size,
                        video_codec = :video_codec,
                        resolution = :resolution,
                        fps = :fps,
                        audio_tracks = :audio_tracks,
                        subtitle_tracks = :subtitle_tracks,
                        thumbnail_path = :thumbnail_path,
                        intro_start = :intro_start,
                        intro_end = :intro_end,
                        outro_start = :outro_start,
                        chapters = :chapters,
                        availability_status = 'available',
                        missing_scan_count = 0,
                        missing_since = NULL
                    WHERE id = :id
                ");
                $stmt->execute([
                    'title' => $ep['title'] ?? '',
                    'synopsis' => $ep['synopsis'] ?? '',
                    'filepath' => $ep['filepath'],
                    'duration' => $ep['duration'] ?? 0,
                    'size' => $ep['size'] ?? 0,
                    'video_codec' => $ep['video_codec'] ?? '',
                    'resolution' => $ep['resolution'] ?? '',
                    'fps' => $ep['fps'] ?? 0,
                    'audio_tracks' => json_encode($ep['audio_tracks'] ?? []),
                    'subtitle_tracks' => json_encode($ep['subtitle_tracks'] ?? []),
                    'thumbnail_path' => $ep['thumbnail_path'] ?? '',
                    'intro_start' => $introStart,
                    'intro_end' => $introEnd,
                    'outro_start' => $outroStart,
                    'chapters' => $chapters,
                    'id' => $ep['id']
                ]);
                return;
            } else {
                $stmt = $db->prepare("INSERT INTO episodes ({$cols}) VALUES ({$vals})");
                $stmt->execute($params);
                return;
            }
        }

        try {
            $updateWithAvail = $updatePart . ", availability_status = 'available', missing_scan_count = 0, missing_since = NULL";
            $stmt = $db->prepare("INSERT INTO episodes ({$cols}) VALUES ({$vals}) ON DUPLICATE KEY UPDATE {$updateWithAvail}");
            $stmt->execute($params);
        } catch (Throwable $e) {
            $stmt = $db->prepare("INSERT INTO episodes ({$cols}) VALUES ({$vals}) ON DUPLICATE KEY UPDATE {$updatePart}");
            $stmt->execute($params);
        }
    }

    public static function getRandomShow(bool $isKids = false): ?array {
        $db = Database::getConnection();
        $shows = $db->query("SELECT * FROM shows")->fetchAll();
        if (empty($shows)) return null;

        if ($isKids) {
            $shows = array_values(array_filter($shows, function($s) {
                $rating = strtoupper(trim((string)($s['age_rating'] ?? '')));
                if (in_array($rating, ['R', 'TV-MA', '18+', 'NC-17', 'RX', 'R18'])) return false;
                $genres = strtolower((string)($s['genres'] ?? ''));
                if (str_contains($genres, 'ecchi') || str_contains($genres, 'hentai') || str_contains($genres, 'erotica')) return false;
                return true;
            }));
            if (empty($shows)) return null;
        }

        $show = $shows[array_rand($shows)];
        $show['rating'] = (float)$show['rating'];
        $show['year'] = $show['year'] !== null ? (int)$show['year'] : null;
        return $show;
    }

    public static function getUserStats(string $username, string $profile = 'Principal'): array {
        $db = Database::getConnection();

        $stmt = $db->prepare("
            SELECT 
                SUM(CASE 
                    WHEN completed = 1 AND duration > 0 AND duration > progress_seconds THEN duration 
                    ELSE COALESCE(progress_seconds, 0) 
                END) as total_time, 
                COUNT(DISTINCT episode_id) as watched_eps
            FROM watch_history
            WHERE username = :u AND profile_name = :p
        ");
        $stmt->execute(['u' => $username, 'p' => $profile]);
        $row = $stmt->fetch() ?: [];
        $totalTime = (int)round((float)($row['total_time'] ?? 0));
        $watchedEpisodes = (int)($row['watched_eps'] ?? 0);

        $stmtComp = $db->prepare("
            SELECT s.id, COUNT(DISTINCT e.id) as total_episodes, COUNT(DISTINCT w.episode_id) as watched_episodes
            FROM shows s
            JOIN episodes e ON e.show_id = s.id
            LEFT JOIN watch_history w ON w.episode_id = e.id AND w.username = :u AND w.profile_name = :p AND (w.progress_seconds >= e.duration * 0.8 OR (e.duration = 0 AND w.progress_seconds > 0))
            GROUP BY s.id
            HAVING total_episodes > 0 AND total_episodes = watched_episodes
        ");
        $stmtComp->execute(['u' => $username, 'p' => $profile]);
        $completedShows = count($stmtComp->fetchAll());

        $stmtGenres = $db->prepare("
            SELECT DISTINCT s.id, s.genres
            FROM shows s
            LEFT JOIN episodes e ON e.show_id = s.id
            LEFT JOIN watch_history w ON w.episode_id = e.id AND w.username = :u1 AND w.profile_name = :p1
            LEFT JOIN favorites f ON f.show_id = s.id AND f.username = :u2 AND f.profile_name = :p2
            WHERE w.episode_id IS NOT NULL OR f.show_id IS NOT NULL
        ");
        $stmtGenres->execute([
            'u1' => $username, 'p1' => $profile,
            'u2' => $username, 'p2' => $profile
        ]);
        $rows = $stmtGenres->fetchAll();

        $genreCounts = [];
        foreach ($rows as $r) {
            if (empty($r['genres'])) continue;
            $genresList = array_map('trim', explode(',', $r['genres']));
            foreach ($genresList as $g) {
                if ($g === '') continue;
                $genreCounts[$g] = ($genreCounts[$g] ?? 0) + 1;
            }
        }

        arsort($genreCounts);
        $topGenre = !empty($genreCounts) ? (string)array_key_first($genreCounts) : 'Ninguno';

        return [
            'total_time_seconds' => $totalTime,
            'watched_episodes' => $watchedEpisodes,
            'completed_shows' => $completedShows,
            'top_genre' => $topGenre,
            'genres_breakdown' => $genreCounts
        ];
    }

    public static function deleteHistoryItem(string $username, string $profile, string $episodeId): void {
        $db = Database::getConnection();
        $stmt = $db->prepare("DELETE FROM watch_history WHERE username = :u AND profile_name = :p AND episode_id = :ep");
        $stmt->execute(['u' => $username, 'p' => $profile, 'ep' => $episodeId]);
    }

    public static function clearUserHistory(string $username, string $profile): void {
        $db = Database::getConnection();
        $stmt = $db->prepare("DELETE FROM watch_history WHERE username = :u AND profile_name = :p");
        $stmt->execute(['u' => $username, 'p' => $profile]);
    }

    public static function getNotifications(string $username, string $profile = 'Principal'): array {
        $db = Database::getConnection();

        $lastSeenAt = null;
        try {
            $prefStmt = $db->prepare("SELECT notifications_last_seen_at FROM user_preferences WHERE username = :u AND profile_name = :p");
            $prefStmt->execute(['u' => $username, 'p' => $profile]);
            $prefRow = $prefStmt->fetch();
            $lastSeenAt = $prefRow['notifications_last_seen_at'] ?? null;
        } catch (Throwable $e) {
            $lastSeenAt = null;
        }

        $stmt = $db->prepare("
            SELECT e.id as episode_id, e.season_number, e.episode_number, e.title as episode_title, 
                   e.created_at as episode_created_at,
                   s.id as show_id, s.title as show_title, s.poster_path, s.created_at as show_created_at
            FROM favorites f
            JOIN shows s ON f.show_id = s.id
            JOIN episodes e ON e.show_id = s.id
            WHERE f.username = :u AND f.profile_name = :p
            ORDER BY COALESCE(e.created_at, s.created_at) DESC, e.season_number DESC, e.episode_number DESC
            LIMIT 20
        ");
        $stmt->execute(['u' => $username, 'p' => $profile]);
        $rows = $stmt->fetchAll();

        $unreadCount = 0;
        $notifications = [];

        foreach ($rows as $r) {
            $createdAt = !empty($r['episode_created_at']) ? $r['episode_created_at'] : (!empty($r['show_created_at']) ? $r['show_created_at'] : '2026-01-01 00:00:00');
            $isUnread = false;
            if ($lastSeenAt === null) {
                $isUnread = true;
                $unreadCount++;
            } else {
                $isUnread = (strtotime($createdAt) > strtotime($lastSeenAt));
                if ($isUnread) {
                    $unreadCount++;
                }
            }

            $notifications[] = [
                'id' => 'notif_' . $r['episode_id'],
                'show_id' => $r['show_id'],
                'show_title' => $r['show_title'],
                'poster_path' => $r['poster_path'] ?? '',
                'episode_id' => $r['episode_id'],
                'season_number' => (int)$r['season_number'],
                'episode_number' => (int)$r['episode_number'],
                'title' => $r['episode_title'] ?? '',
                'message' => "¡Nuevo episodio disponible! S{$r['season_number']} E{$r['episode_number']}: {$r['show_title']}",
                'created_at' => $createdAt,
                'is_unread' => $isUnread
            ];
        }

        return [
            'notifications' => $notifications,
            'unread_count' => $unreadCount,
            'last_seen_at' => $lastSeenAt
        ];
    }

    public static function markNotificationsSeen(string $username, string $profile = 'Principal'): void {
        $db = Database::getConnection();
        $stmt = $db->prepare("
            INSERT INTO user_preferences (username, profile_name, notifications_last_seen_at)
            VALUES (:u, :p, CURRENT_TIMESTAMP)
            ON DUPLICATE KEY UPDATE notifications_last_seen_at = CURRENT_TIMESTAMP
        ");
        $stmt->execute(['u' => $username, 'p' => $profile]);
    }

    public static function toggleFavorite(string $username, string $profile = 'Principal', string $showId = ''): bool {
        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT 1 FROM favorites WHERE username = :u AND profile_name = :p AND show_id = :s");
        $stmt->execute(['u' => $username, 'p' => $profile, 's' => $showId]);
        if ($stmt->fetch()) {
            $del = $db->prepare("DELETE FROM favorites WHERE username = :u AND profile_name = :p AND show_id = :s");
            $del->execute(['u' => $username, 'p' => $profile, 's' => $showId]);
            return false;
        } else {
            $ins = $db->prepare("INSERT INTO favorites (username, profile_name, show_id) VALUES (:u, :p, :s)");
            $ins->execute(['u' => $username, 'p' => $profile, 's' => $showId]);
            return true;
        }
    }

    public static function registerUser(string $username, string $password, string $role = 'user'): ?array {
        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM users WHERE username = :u");
        $stmt->execute(['u' => $username]);
        if ($stmt->fetch()) {
            return null; // Already exists
        }

        $hash = password_hash($password, PASSWORD_BCRYPT);
        $ins = $db->prepare("INSERT INTO users (username, password_hash, role) VALUES (:u, :p, :r)");
        try {
            $ins->execute(['u' => $username, 'p' => $hash, 'r' => $role]);
        } catch (PDOException $e) {
            // Two simultaneous registrations of the same name both pass the SELECT above; the loser hits the key.
            if ((int)($e->errorInfo[1] ?? 0) === 1062) {
                return null;
            }
            throw $e;
        }

        // Create default profile
        self::saveUserProfile($username, [
            'id' => 'profile_' . bin2hex(random_bytes(16)),
            'name' => 'Principal',
            'avatar' => '',
            'color' => '#a855f7'
        ]);

        return [
            'username' => $username,
            'role' => $role
        ];
    }

    public static function getUser(string $username): ?array {
        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM users WHERE LOWER(username) = LOWER(:u)");
        $stmt->execute(['u' => $username]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public static function sanitizeProfileForClient(array $profile): array {
        $hasPin = !empty($profile['pin']);
        unset($profile['pin']);
        $profile['has_pin'] = $hasPin;
        // Raw rows carry is_kids as 0/1; typed clients (the Android app) require a JSON boolean.
        $profile['is_kids'] = (bool)($profile['is_kids'] ?? false);
        return $profile;
    }

    public static function getUserProfiles(string $username): array {
        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM user_profiles WHERE username = :u ORDER BY created_at ASC");
        $stmt->execute(['u' => $username]);
        $rows = $stmt->fetchAll();
        if (empty($rows)) {
            $defaultProfile = self::saveUserProfile($username, [
                'name' => 'Principal',
                'color' => '#818CF8',
                'is_kids' => 0
            ]);
            return [$defaultProfile];
        }
        return array_map(function($p) {
            $name = $p['name'] ?? 'Principal';
            $color = $p['color'] ?? '#a855f7';
            $p['profile_name'] = $name;
            $p['name'] = $name;
            $p['avatar_color'] = $color;
            $p['color'] = $color;
            $p['is_kids'] = (bool)($p['is_kids'] ?? 0);
            return self::sanitizeProfileForClient($p);
        }, $rows);
    }

    public static function getUserProfileById(string $username, string $profileId): ?array {
        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM user_profiles WHERE username = :u AND id = :id");
        $stmt->execute(['u' => $username, 'id' => $profileId]);
        $row = $stmt->fetch();
        if (!$row) {
            return null;
        }
        $name = $row['name'] ?? 'Principal';
        $color = $row['color'] ?? '#a855f7';
        $row['profile_name'] = $name;
        $row['name'] = $name;
        $row['avatar_color'] = $color;
        $row['color'] = $color;
        $row['is_kids'] = (bool)($row['is_kids'] ?? 0);
        return $row;
    }

    public static function saveUserProfile(string $username, array $data): array {
        $db = Database::getConnection();
        $id = !empty($data['id']) ? trim((string)$data['id']) : null;
        $existing = null;

        if ($id) {
            $checkStmt = $db->prepare("SELECT * FROM user_profiles WHERE id = :id");
            $checkStmt->execute(['id' => $id]);
            $existing = $checkStmt->fetch();
            if ($existing) {
                if ($existing['username'] !== $username) {
                    jsonError('Acceso denegado: El perfil no pertenece a este usuario', 403);
                }
                if (!empty($existing['pin'])) {
                    $currentPin = trim((string)($data['current_pin'] ?? ''));
                    RateLimiter::consumePinAttempt($username, (string)$existing['id']);
                    if (empty($currentPin) || !password_verify($currentPin, $existing['pin'])) {
                        jsonError('PIN actual requerido o incorrecto para modificar este perfil', 403);
                    }
                    RateLimiter::clearPinAttempts($username, (string)$existing['id']);
                }
            } else {
                // Client supplied an id that doesn't exist: ignore it and generate a secure random ID
                $id = 'prof_' . bin2hex(random_bytes(16));
            }
        } else {
            $id = 'prof_' . bin2hex(random_bytes(16));
        }

        $rawName = $data['profile_name'] ?? $data['name'] ?? 'Perfil';
        if (!is_string($rawName)) {
            jsonError('El nombre del perfil debe ser texto', 400);
        }
        $name = trim($rawName);
        if (mb_strlen($name, 'UTF-8') > 64) {
            jsonError('El nombre del perfil no puede superar 64 caracteres', 400);
        }
        if (empty($name)) {
            $name = 'Perfil';
        }

        // Enforce uniqueness of profile name per user
        $dupCheck = $db->prepare("SELECT id FROM user_profiles WHERE username = :u AND name = :n AND id != :id");
        $dupCheck->execute(['u' => $username, 'n' => $name, 'id' => $id]);
        if ($dupCheck->fetch()) {
            jsonError('Ya existe un perfil con ese nombre para este usuario', 409);
        }

        $avatar = (string)($data['avatar'] ?? ($data['avatar_image'] ?? ''));
        if ($avatar !== '' && str_starts_with($avatar, 'data:')) {
            $parts = explode(',', $avatar, 2);
            $dataBin = base64_decode($parts[1] ?? '', true);
            // Only raster images are stored: an SVG (or anything else) served from /library would be
            // same-origin active content.
            $imageInfo = ($dataBin !== false && strlen($dataBin) <= 5 * 1024 * 1024) ? @getimagesizefromstring($dataBin) : false;
            $extensions = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_GIF => 'gif', IMAGETYPE_WEBP => 'webp'];
            if ($imageInfo === false || !isset($extensions[$imageInfo[2]])) {
                jsonError('El avatar debe ser una imagen JPG, PNG, GIF o WebP de hasta 5 MB', 400);
            }
            $avatarDir = LIBRARY_DIR . '/avatars/uploads';
            if (!is_dir($avatarDir)) {
                @mkdir($avatarDir, 0775, true);
            }
            $cleanUser = preg_replace('/[^a-zA-Z0-9_-]/', '', $username);
            $filename = 'avatar_' . $cleanUser . '_' . bin2hex(random_bytes(6)) . '.' . $extensions[$imageInfo[2]];
            if (@file_put_contents($avatarDir . '/' . $filename, $dataBin) === false) {
                jsonError('No se pudo guardar el avatar', 500);
            }
            $avatar = '/library/avatars/uploads/' . $filename;
        } elseif ($avatar !== '' && !str_starts_with($avatar, '/library/avatars/') && !preg_match('#^https?://#i', $avatar)) {
            $avatar = '';
        }

        $color = $data['avatar_color'] ?? $data['color'] ?? '#a855f7';
        $isKids = !empty($data['is_kids']) ? 1 : 0;
        $rawPin = trim((string)($data['pin'] ?? ''));
        $pinHash = $existing ? ($existing['pin'] ?? '') : '';
        if ($rawPin !== '') {
            if (!preg_match('/^[0-9]{4,6}$/', $rawPin)) {
                jsonError('El PIN debe tener entre 4 y 6 dígitos', 400);
            }
            // Always hash with bcrypt - never accept raw unverified hash prefixes
            $pinHash = password_hash($rawPin, PASSWORD_BCRYPT);
        } elseif (!empty($data['remove_pin'])) {
            $pinHash = '';
        }

        // History, favorites and preferences are keyed by profile name, so a rename must carry them along.
        if ($existing && ($existing['name'] ?? '') !== $name) {
            self::moveProfileData($username, (string)$existing['name'], $name);
        }

        $stmt = $db->prepare("
            INSERT INTO user_profiles (id, username, name, avatar, color, is_kids, pin)
            VALUES (:id, :u, :n, :a, :c, :k, :p)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                avatar = VALUES(avatar),
                color = VALUES(color),
                is_kids = VALUES(is_kids),
                pin = VALUES(pin)
        ");
        $stmt->execute([
            'id' => $id,
            'u' => $username,
            'n' => $name,
            'a' => $avatar,
            'c' => $color,
            'k' => $isKids,
            'p' => $pinHash
        ]);

        // A replaced upload would otherwise stay in /library/avatars/uploads forever.
        if ($existing && ($existing['avatar'] ?? '') !== $avatar) {
            self::deleteUploadedAvatar((string)($existing['avatar'] ?? ''));
        }

        return self::sanitizeProfileForClient([
            'id' => $id,
            'username' => $username,
            'name' => $name,
            'profile_name' => $name,
            'avatar' => $avatar,
            'color' => $color,
            'avatar_color' => $color,
            'is_kids' => (bool)$isKids,
            'pin' => $pinHash
        ]);
    }

    /** Tables whose rows belong to a profile through (username, profile_name). Comments stay as authored. */
    private const PROFILE_DATA_TABLES = ['watch_history', 'favorites', 'user_preferences'];

    private static function moveProfileData(string $username, string $oldName, string $newName): void {
        // A rename must move history, favorites and preferences together or not at all.
        self::transactional(function (PDO $db) use ($username, $oldName, $newName) {
            foreach (self::PROFILE_DATA_TABLES as $table) {
                // Rows left under the new name by a previously deleted profile would collide with the primary key.
                $db->prepare("DELETE FROM {$table} WHERE username = :u AND profile_name = :new")
                    ->execute(['u' => $username, 'new' => $newName]);
                $db->prepare("UPDATE {$table} SET profile_name = :new WHERE username = :u AND profile_name = :old")
                    ->execute(['u' => $username, 'new' => $newName, 'old' => $oldName]);
            }
        });
    }

    /** Removes a profile photo uploaded by a user; presets and external URLs are left alone. */
    private static function deleteUploadedAvatar(string $avatarUrl): void {
        $prefix = '/library/avatars/uploads/';
        if (!str_starts_with($avatarUrl, $prefix)) {
            return;
        }
        $file = basename($avatarUrl);
        if ($file === '' || !preg_match('/^avatar_[A-Za-z0-9_-]+\.(?:jpg|png|gif|webp)$/', $file)) {
            return;
        }
        $path = LIBRARY_DIR . '/avatars/uploads/' . $file;
        if (is_file($path)) {
            @unlink($path);
        }
    }

    public static function deleteUserProfile(string $username, string $id, string $pin = ''): bool {
        $db = Database::getConnection();
        $checkStmt = $db->prepare("SELECT * FROM user_profiles WHERE id = :id");
        $checkStmt->execute(['id' => $id]);
        $existing = $checkStmt->fetch();

        if (!$existing) {
            jsonError('Perfil no encontrado', 404);
        }
        if ($existing['username'] !== $username) {
            jsonError('Acceso denegado: No tienes permisos para eliminar este perfil', 403);
        }
        if (($existing['name'] ?? '') === 'Principal') {
            jsonError('No se puede eliminar el perfil principal', 400);
        }
        if (!empty($existing['pin'])) {
            RateLimiter::consumePinAttempt($username, (string)$existing['id']);
            if ($pin === '' || !password_verify($pin, $existing['pin'])) {
                jsonError('PIN actual requerido o incorrecto para eliminar este perfil', 403);
            }
            RateLimiter::clearPinAttempts($username, (string)$existing['id']);
        }

        $deleted = self::transactional(function (PDO $db) use ($username, $id, $existing) {
            $stmt = $db->prepare("DELETE FROM user_profiles WHERE username = :u AND id = :id");
            $deleted = $stmt->execute(['u' => $username, 'id' => $id]);
            // Otherwise a new profile created later with the same name would inherit this one's history.
            foreach (self::PROFILE_DATA_TABLES as $table) {
                $db->prepare("DELETE FROM {$table} WHERE username = :u AND profile_name = :p")
                    ->execute(['u' => $username, 'p' => $existing['name']]);
            }
            return $deleted;
        });
        if ($deleted) {
            self::deleteUploadedAvatar((string)($existing['avatar'] ?? ''));
        }
        return $deleted;
    }

    public static function getComments(string $showId): array {
        $db = Database::getConnection();
        $stmt = $db->prepare("
            SELECT c.*, p.avatar, p.color as avatar_color
            FROM comments c
            LEFT JOIN user_profiles p ON p.username = c.username AND p.name = c.profile_name
            WHERE c.show_id = :s 
            ORDER BY c.created_at DESC
        ");
        $stmt->execute(['s' => $showId]);
        return $stmt->fetchAll();
    }

    public static function addComment(string $showId, string $username, string $profile, string $content, string $episodeId = ''): array {
        $db = Database::getConnection();
        $id = 'comm_' . bin2hex(random_bytes(16));
        $stmt = $db->prepare("
            INSERT INTO comments (id, show_id, episode_id, username, profile_name, content)
            VALUES (:id, :s, :e, :u, :p, :c)
        ");
        $stmt->execute([
            'id' => $id,
            's' => $showId,
            'e' => $episodeId,
            'u' => $username,
            'p' => $profile,
            'c' => $content
        ]);

        return [
            'id' => $id,
            'show_id' => $showId,
            'episode_id' => $episodeId,
            'username' => $username,
            'profile_name' => $profile,
            'content' => $content,
            'created_at' => date('Y-m-d H:i:s')
        ];
    }

    // ==========================================
    // WATCH PARTY HELPERS
    // ==========================================

    public static function createPartyRoom(array $data): string {
        $db = Database::getConnection();
        $id = !empty($data['id']) ? trim($data['id']) : ('KURA-' . strtoupper(bin2hex(random_bytes(12))));
        $name = $data['name'] ?? 'Watch Party';
        $host = $data['host_user'] ?? 'Anfitrión';
        $episodeId = $data['episode_id'] ?? '';
        $isPublic = !empty($data['is_public']) ? 1 : 0;
        $allowGuestControls = !empty($data['allow_guest_controls']) ? 1 : 0;
        $currentTime = (float)($data['current_time'] ?? 0.0);
        $isPlaying = !empty($data['is_playing']) ? 1 : 0;
        $nowMs = (int)(microtime(true) * 1000);

        $stmt = $db->prepare("
            INSERT INTO party_rooms (id, name, host_user, episode_id, is_playing, `current_time`, last_sync_timestamp, is_public, allow_guest_controls, participants_count, created_at, updated_at)
            VALUES (:id, :name, :host, :ep, :playing, :time, :sync, :pub, :ctrl, 1, NOW(), NOW())
            ON DUPLICATE KEY UPDATE 
                name = VALUES(name),
                host_user = VALUES(host_user),
                episode_id = VALUES(episode_id),
                is_playing = VALUES(is_playing),
                `current_time` = VALUES(`current_time`),
                last_sync_timestamp = VALUES(last_sync_timestamp),
                is_public = VALUES(is_public),
                allow_guest_controls = VALUES(allow_guest_controls),
                updated_at = NOW()
        ");

        $stmt->execute([
            'id' => $id,
            'name' => $name,
            'host' => $host,
            'ep' => $episodeId,
            'playing' => $isPlaying,
            'time' => $currentTime,
            'sync' => $nowMs,
            'pub' => $isPublic,
            'ctrl' => $allowGuestControls
        ]);

        return $id;
    }

    public static function getPartyRoom(string $roomId): ?array {
        $db = Database::getConnection();
        $stmt = $db->prepare("
            SELECT r.*, e.title as episode_title, e.season_number, e.episode_number, e.thumbnail_path,
                   s.id as show_id, s.title as show_title, s.poster_path, s.backdrop_path
            FROM party_rooms r
            LEFT JOIN episodes e ON r.episode_id = e.id
            LEFT JOIN shows s ON e.show_id = s.id
            WHERE r.id = :id
        ");
        $stmt->execute(['id' => $roomId]);
        $row = $stmt->fetch();
        if (!$row) return null;

        $row['is_playing'] = (bool)$row['is_playing'];
        $row['current_time'] = (float)$row['current_time'];
        $row['last_sync_timestamp'] = (int)$row['last_sync_timestamp'];
        $row['is_public'] = (bool)$row['is_public'];
        $row['allow_guest_controls'] = (bool)$row['allow_guest_controls'];
        $row['participants_count'] = (int)$row['participants_count'];
        // Clients extrapolate the host position from last_sync_timestamp; this lets them measure
        // against the server clock instead of their own (the home server often runs without NTP).
        $row['server_time_ms'] = (int)(microtime(true) * 1000);

        return $row;
    }

    public static function updatePartyPlayback(string $roomId, bool $isPlaying, float $currentTime, ?string $episodeId = null, ?int $participants = null): bool {
        $db = Database::getConnection();
        $nowMs = (int)(microtime(true) * 1000);

        $sql = "UPDATE party_rooms SET is_playing = :playing, `current_time` = :time, last_sync_timestamp = :sync";
        $params = [
            'playing' => $isPlaying ? 1 : 0,
            'time' => $currentTime,
            'sync' => $nowMs,
            'id' => $roomId
        ];

        if (!empty($episodeId)) {
            $sql .= ", episode_id = :ep";
            $params['ep'] = $episodeId;
        }

        if ($participants !== null) {
            $sql .= ", participants_count = :parts";
            $params['parts'] = max(1, $participants);
        }

        $sql .= ", updated_at = NOW() WHERE id = :id";

        $stmt = $db->prepare($sql);
        return $stmt->execute($params);
    }

    public static function updatePartySettings(string $roomId, array $settings): bool {
        $db = Database::getConnection();
        $fields = [];
        $params = ['id' => $roomId];

        if (isset($settings['host_user'])) {
            $fields[] = "host_user = :host";
            $params['host'] = $settings['host_user'];
        }
        if (isset($settings['name'])) {
            $fields[] = "name = :name";
            $params['name'] = $settings['name'];
        }
        if (isset($settings['is_public'])) {
            $fields[] = "is_public = :pub";
            $params['pub'] = !empty($settings['is_public']) ? 1 : 0;
        }
        if (isset($settings['allow_guest_controls'])) {
            $fields[] = "allow_guest_controls = :ctrl";
            $params['ctrl'] = !empty($settings['allow_guest_controls']) ? 1 : 0;
        }

        if (empty($fields)) return true;

        $sql = "UPDATE party_rooms SET " . implode(", ", $fields) . ", updated_at = NOW() WHERE id = :id";
        $stmt = $db->prepare($sql);
        return $stmt->execute($params);
    }

    public static function addPartyMessage(string $roomId, string $username, string $message, string $type = 'chat'): int {
        $db = Database::getConnection();
        $stmt = $db->prepare("
            INSERT INTO party_messages (room_id, username, message, type, created_at)
            VALUES (:room, :user, :msg, :type, NOW())
        ");
        $stmt->execute([
            'room' => $roomId,
            'user' => $username,
            'msg' => $message,
            'type' => $type
        ]);

        return (int)$db->lastInsertId();
    }

    public static function getPartyMessages(string $roomId, int $afterId = 0, int $limit = 50): array {
        $db = Database::getConnection();
        $stmt = $db->prepare("
            SELECT id, room_id, username, message, type, created_at
            FROM party_messages
            WHERE room_id = :room AND id > :after
            ORDER BY id ASC
            LIMIT :lim
        ");
        $stmt->bindValue(':room', $roomId, PDO::PARAM_STR);
        $stmt->bindValue(':after', $afterId, PDO::PARAM_INT);
        $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
        $stmt->execute();
        $rows = $stmt->fetchAll();
        foreach ($rows as &$row) {
            if (isset($row['type']) && str_ends_with($row['type'], ':host')) {
                $row['role'] = 'host';
                $row['type'] = substr($row['type'], 0, -5);
            } else {
                $row['role'] = ($row['type'] === 'system') ? 'system' : 'guest';
            }
        }
        unset($row);
        return $rows;
    }

    public static function getPublicPartyRooms(int $limit = 20): array {
        $db = Database::getConnection();
        $stmt = $db->prepare("
            SELECT r.*, e.title as episode_title, e.season_number, e.episode_number, e.thumbnail_path,
                   s.id as show_id, s.title as show_title, s.poster_path, s.backdrop_path
            FROM party_rooms r
            LEFT JOIN episodes e ON r.episode_id = e.id
            LEFT JOIN shows s ON e.show_id = s.id
            WHERE r.is_public = 1 AND r.updated_at >= DATE_SUB(NOW(), INTERVAL 4 HOUR)
            ORDER BY r.updated_at DESC
            LIMIT :lim
        ");
        $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
        $stmt->execute();
        $rooms = $stmt->fetchAll();

        return array_map(function($r) {
            $r['is_playing'] = (bool)$r['is_playing'];
            $r['current_time'] = (float)$r['current_time'];
            $r['last_sync_timestamp'] = (int)$r['last_sync_timestamp'];
            $r['is_public'] = (bool)$r['is_public'];
            $r['allow_guest_controls'] = (bool)$r['allow_guest_controls'];
            $r['participants_count'] = (int)$r['participants_count'];
            return $r;
        }, $rooms);
    }

    public static function cleanupExpiredPartyRooms(int $inactiveHours = 24): int {
        $db = Database::getConnection();
        $stmt = $db->prepare("
            DELETE FROM party_rooms
            WHERE updated_at < DATE_SUB(NOW(), INTERVAL :h HOUR)
        ");
        $stmt->bindValue(':h', $inactiveHours, PDO::PARAM_INT);
        $stmt->execute();
        $deleted = $stmt->rowCount();

        if ($deleted > 0) {
            $db->exec("DELETE FROM party_messages WHERE room_id NOT IN (SELECT id FROM party_rooms)");
        }

        return $deleted;
    }

    public static function recordPartyMember(
        string $roomId,
        string $username,
        ?string $memberId = null,
        ?string $tokenHash = null,
        string $role = 'guest',
        bool $isKids = false,
        ?string $accountUsername = null,
        ?string $profileId = null
    ): void {
        $db = Database::getConnection();
        $stmt = $db->prepare("
            INSERT INTO party_members (room_id, username, member_id, token_hash, role, is_kids, account_username, profile_id, joined_at, last_ping)
            VALUES (:r, :u, :m, :t, :role, :kids, :acc_user, :prof_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON DUPLICATE KEY UPDATE 
                username = VALUES(username),
                token_hash = COALESCE(VALUES(token_hash), token_hash),
                role = VALUES(role),
                is_kids = VALUES(is_kids),
                account_username = VALUES(account_username),
                profile_id = VALUES(profile_id),
                last_ping = CURRENT_TIMESTAMP
        ");
        $stmt->execute([
            'r' => $roomId,
            'u' => $username,
            'm' => $memberId,
            't' => $tokenHash,
            'role' => $role,
            'kids' => $isKids ? 1 : 0,
            'acc_user' => $accountUsername,
            'prof_id' => $profileId
        ]);
    }

    public static function updatePartyMemberPing(string $roomId, string $memberId): void {
        $db = Database::getConnection();
        $stmt = $db->prepare("UPDATE party_members SET last_ping = CURRENT_TIMESTAMP WHERE room_id = :r AND member_id = :m");
        $stmt->execute(['r' => $roomId, 'm' => $memberId]);
    }

    public static function validatePartyMemberToken(string $roomId, string $memberId, string $memberToken): ?array {
        $db = Database::getConnection();
        $tokenHash = hash('sha256', $memberToken);
        $stmt = $db->prepare("
            SELECT * FROM party_members 
            WHERE room_id = :r AND member_id = :m AND token_hash = :h
        ");
        $stmt->execute(['r' => $roomId, 'm' => $memberId, 'h' => $tokenHash]);
        return $stmt->fetch() ?: null;
    }

    public static function getPartyMemberById(string $roomId, string $memberId): ?array {
        $db = Database::getConnection();
        $stmt = $db->prepare("
            SELECT * FROM party_members 
            WHERE room_id = :r AND member_id = :m
        ");
        $stmt->execute(['r' => $roomId, 'm' => $memberId]);
        return $stmt->fetch() ?: null;
    }

    public static function getPartyHostMember(string $roomId): ?array {
        $db = Database::getConnection();
        $stmt = $db->prepare("
            SELECT * FROM party_members 
            WHERE room_id = :r AND role = 'host'
            ORDER BY joined_at ASC LIMIT 1
        ");
        $stmt->execute(['r' => $roomId]);
        return $stmt->fetch() ?: null;
    }

    public static function removePartyMemberById(string $roomId, string $memberId): void {
        $db = Database::getConnection();
        $stmt = $db->prepare("DELETE FROM party_members WHERE room_id = :r AND member_id = :m");
        $stmt->execute(['r' => $roomId, 'm' => $memberId]);
    }

    public static function isPartyMemberActive(string $roomId, string $memberId, int $timeoutSeconds = 60): bool {
        $db = Database::getConnection();
        $driver = $db->getAttribute(PDO::ATTR_DRIVER_NAME);
        if ($driver === 'sqlite') {
            $stmt = $db->prepare("
                SELECT 1 FROM party_members 
                WHERE room_id = :r AND member_id = :m 
                  AND datetime(last_ping) >= datetime('now', :modifier)
            ");
            $sec = max(30, $timeoutSeconds * 2);
            $stmt->execute(['r' => $roomId, 'm' => $memberId, 'modifier' => "-{$sec} seconds"]);
            return (bool)$stmt->fetchColumn();
        }

        $stmt = $db->prepare("
            SELECT 1 FROM party_members 
            WHERE room_id = :r AND member_id = :m 
              AND last_ping >= DATE_SUB(NOW(), INTERVAL :sec SECOND)
        ");
        $stmt->bindValue(':r', $roomId);
        $stmt->bindValue(':m', $memberId);
        $stmt->bindValue(':sec', max(30, $timeoutSeconds * 2), PDO::PARAM_INT);
        $stmt->execute();
        return (bool)$stmt->fetchColumn();
    }

    public static function getActivePartyMembers(string $roomId, int $timeoutSeconds = 60): array {
        $db = Database::getConnection();
        $driver = $db->getAttribute(PDO::ATTR_DRIVER_NAME);
        if ($driver === 'sqlite') {
            $cleanup = $db->prepare("DELETE FROM party_members WHERE datetime(last_ping) < datetime('now', :mod)");
            $sec = max(30, $timeoutSeconds * 2);
            $cleanup->execute(['mod' => "-{$sec} seconds"]);
        } else {
            $cleanup = $db->prepare("DELETE FROM party_members WHERE last_ping < DATE_SUB(NOW(), INTERVAL :sec SECOND)");
            $cleanup->bindValue(':sec', max(30, $timeoutSeconds * 2), PDO::PARAM_INT);
            $cleanup->execute();
        }

        $stmt = $db->prepare("SELECT username, member_id, role, joined_at, last_ping FROM party_members WHERE room_id = :r ORDER BY joined_at ASC");
        $stmt->execute(['r' => $roomId]);
        return $stmt->fetchAll();
    }

    public static function getPartyMembersCount(string $roomId): int {
        $members = self::getActivePartyMembers($roomId);
        return max(1, count($members));
    }
}
