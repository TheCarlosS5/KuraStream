<?php
require_once __DIR__ . '/config.php';

class Database {
    private static ?PDO $pdo = null;

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
                        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
                    ]
                );
            } catch (PDOException $e) {
                if (defined('TESTING_MODE')) {
                    throw $e;
                }
                jsonError("Database Connection Failed: " . $e->getMessage(), 500);
            }
        }
        return self::$pdo;
    }

    public static function initializeSchema(?PDO $customPdo = null) {
        $db = $customPdo ?: self::getConnection();

        $db->exec("
            CREATE TABLE IF NOT EXISTS shows (
                id VARCHAR(255) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                synopsis TEXT,
                rating DOUBLE DEFAULT 0.0,
                year INT NULL,
                studio VARCHAR(255) DEFAULT '',
                director VARCHAR(255) DEFAULT '',
                writer VARCHAR(255) DEFAULT '',
                cast_members LONGTEXT,
                poster_path VARCHAR(500) DEFAULT '',
                backdrop_path VARCHAR(500) DEFAULT '',
                media_type VARCHAR(50) NOT NULL DEFAULT 'anime',
                backdrop_loops LONGTEXT,
                genres VARCHAR(500) DEFAULT '',
                trailer_key VARCHAR(255) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                age_rating VARCHAR(50) DEFAULT 'TV-14',
                status VARCHAR(50) DEFAULT 'finished'
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

            CREATE TABLE IF NOT EXISTS episodes (
                id VARCHAR(255) PRIMARY KEY,
                show_id VARCHAR(255) NOT NULL,
                season_number INT NOT NULL,
                episode_number INT NOT NULL,
                title VARCHAR(255) DEFAULT '',
                synopsis TEXT,
                filepath VARCHAR(500) NOT NULL,
                duration DOUBLE DEFAULT 0,
                size BIGINT DEFAULT 0,
                video_codec VARCHAR(100) DEFAULT '',
                resolution VARCHAR(100) DEFAULT '',
                fps DOUBLE DEFAULT 0,
                audio_tracks LONGTEXT,
                subtitle_tracks LONGTEXT,
                thumbnail_path VARCHAR(500) DEFAULT '',
                intro_start INT NULL,
                intro_end INT NULL,
                outro_start INT NULL,
                chapters LONGTEXT NULL,
                INDEX idx_episodes_show (show_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

            CREATE TABLE IF NOT EXISTS user_preferences (
                username VARCHAR(255) NOT NULL,
                profile_name VARCHAR(255) NOT NULL DEFAULT 'Principal',
                auto_skip_intro TINYINT(1) DEFAULT 0,
                auto_play_next TINYINT(1) DEFAULT 1,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (username, profile_name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

            CREATE TABLE IF NOT EXISTS watch_history (
                username VARCHAR(255) NOT NULL,
                profile_name VARCHAR(255) NOT NULL DEFAULT 'Principal',
                episode_id VARCHAR(255) NOT NULL,
                progress_seconds DOUBLE NOT NULL DEFAULT 0,
                duration DOUBLE NOT NULL DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (username, profile_name, episode_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

            CREATE TABLE IF NOT EXISTS favorites (
                username VARCHAR(255) NOT NULL,
                profile_name VARCHAR(255) NOT NULL DEFAULT 'Principal',
                show_id VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (username, profile_name, show_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

            CREATE TABLE IF NOT EXISTS staged_imports (
                id VARCHAR(255) PRIMARY KEY,
                original_filename VARCHAR(500) NOT NULL,
                filepath VARCHAR(500) NOT NULL,
                media_type VARCHAR(50) DEFAULT 'anime',
                clean_title VARCHAR(255) DEFAULT '',
                season INT DEFAULT 1,
                episode INT DEFAULT 1,
                filesize BIGINT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

            CREATE TABLE IF NOT EXISTS users (
                username VARCHAR(255) PRIMARY KEY,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(50) NOT NULL DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

            CREATE TABLE IF NOT EXISTS user_profiles (
                id VARCHAR(255) PRIMARY KEY,
                username VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                avatar VARCHAR(500) DEFAULT '',
                color VARCHAR(50) DEFAULT '#a855f7',
                is_kids TINYINT(1) DEFAULT 0,
                pin VARCHAR(10) DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_user_profiles (username)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

            CREATE TABLE IF NOT EXISTS comments (
                id VARCHAR(255) PRIMARY KEY,
                show_id VARCHAR(255) NOT NULL,
                episode_id VARCHAR(255) DEFAULT '',
                username VARCHAR(255) NOT NULL,
                profile_name VARCHAR(255) NOT NULL DEFAULT 'Principal',
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_comments_show (show_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        ");

        try {
            $checkCol = $db->query("SHOW COLUMNS FROM episodes LIKE 'chapters'");
            if ($checkCol && $checkCol->rowCount() === 0) {
                $db->exec("ALTER TABLE episodes ADD COLUMN chapters LONGTEXT NULL");
            }
        } catch (Throwable $e) {
            // Ignore if check or alter column fails
        }
    }
}

class DbHelper {
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

        $stmt = $db->prepare("
            INSERT INTO shows (id, title, synopsis, rating, year, studio, director, writer, cast_members, poster_path, backdrop_path, media_type, backdrop_loops, genres, trailer_key, age_rating, status)
            VALUES (:id, :title, :synopsis, :rating, :year, :studio, :director, :writer, :cast_members, :poster_path, :backdrop_path, :media_type, :backdrop_loops, :genres, :trailer_key, :age_rating, :status)
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
                status = VALUES(status)
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
            'status' => $show['status'] ?? 'finished'
        ]);
    }

    public static function deleteShow($id): void {
        $db = Database::getConnection();
        $db->prepare("DELETE FROM watch_history WHERE episode_id IN (SELECT id FROM episodes WHERE show_id = :id)")->execute(['id' => $id]);
        $db->prepare("DELETE FROM episodes WHERE show_id = :id")->execute(['id' => $id]);
        $db->prepare("DELETE FROM favorites WHERE show_id = :id")->execute(['id' => $id]);
        $db->prepare("DELETE FROM shows WHERE id = :id")->execute(['id' => $id]);
    }

    public static function getUserPreferences(string $username, string $profile = 'Principal'): array {
        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM user_preferences WHERE username = :u AND profile_name = :p");
        $stmt->execute(['u' => $username, 'p' => $profile]);
        $row = $stmt->fetch();
        if (!$row) {
            return ['auto_skip_intro' => false, 'auto_play_next' => true];
        }
        return [
            'auto_skip_intro' => (bool)$row['auto_skip_intro'],
            'auto_play_next' => (bool)$row['auto_play_next']
        ];
    }

    public static function saveUserPreferences(string $username, string $profile, array $data): void {
        $db = Database::getConnection();
        $existing = self::getUserPreferences($username, $profile);
        $autoSkip = isset($data['auto_skip_intro']) ? (int)(bool)$data['auto_skip_intro'] : (int)$existing['auto_skip_intro'];
        $autoPlay = isset($data['auto_play_next']) ? (int)(bool)$data['auto_play_next'] : (int)$existing['auto_play_next'];

        $stmt = $db->prepare("
            INSERT INTO user_preferences (username, profile_name, auto_skip_intro, auto_play_next)
            VALUES (:u, :p, :skip, :play)
            ON DUPLICATE KEY UPDATE auto_skip_intro = VALUES(auto_skip_intro), auto_play_next = VALUES(auto_play_next)
        ");
        $stmt->execute(['u' => $username, 'p' => $profile, 'skip' => $autoSkip, 'play' => $autoPlay]);
    }

    public static function getEpisode($id): ?array {
        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM episodes WHERE id = :id");
        $stmt->execute(['id' => $id]);
        $ep = $stmt->fetch();
        if (!$ep) return null;
        $ep['audio_tracks'] = !empty($ep['audio_tracks']) ? json_decode($ep['audio_tracks'], true) : [];
        $ep['subtitle_tracks'] = !empty($ep['subtitle_tracks']) ? json_decode($ep['subtitle_tracks'], true) : [];
        $ep['chapters'] = !empty($ep['chapters']) ? json_decode($ep['chapters'], true) : [];
        return $ep;
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

        $stmt = $db->prepare("
            UPDATE episodes
            SET intro_start = :intro_start,
                intro_end = :intro_end,
                outro_start = :outro_start,
                chapters = :chapters
            WHERE id = :id
        ");

        $stmt->execute([
            'id' => $id,
            'intro_start' => $introStart,
            'intro_end' => $introEnd,
            'outro_start' => $outroStart,
            'chapters' => $chaptersJson
        ]);
        return true;
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

    public static function saveEpisode(array $ep): void {
        $db = Database::getConnection();
        $stmt = $db->prepare("
            INSERT INTO episodes (id, show_id, season_number, episode_number, title, synopsis, filepath, duration, size, video_codec, resolution, fps, audio_tracks, subtitle_tracks, thumbnail_path, intro_start, intro_end, outro_start, chapters)
            VALUES (:id, :show_id, :season_number, :episode_number, :title, :synopsis, :filepath, :duration, :size, :video_codec, :resolution, :fps, :audio_tracks, :subtitle_tracks, :thumbnail_path, :intro_start, :intro_end, :outro_start, :chapters)
            ON DUPLICATE KEY UPDATE
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
                intro_start = VALUES(intro_start),
                intro_end = VALUES(intro_end),
                outro_start = VALUES(outro_start),
                chapters = VALUES(chapters)
        ");

        $stmt->execute([
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
            'audio_tracks' => json_encode($ep['audio_tracks'] ?? []),
            'subtitle_tracks' => json_encode($ep['subtitle_tracks'] ?? []),
            'thumbnail_path' => $ep['thumbnail_path'] ?? '',
            'intro_start' => $ep['intro_start'] ?? null,
            'intro_end' => $ep['intro_end'] ?? null,
            'outro_start' => $ep['outro_start'] ?? null,
            'chapters' => json_encode($ep['chapters'] ?? [])
        ]);
    }

    public static function getRandomShow(): ?array {
        $db = Database::getConnection();
        $stmt = $db->query("SELECT * FROM shows ORDER BY RAND() LIMIT 1");
        $show = $stmt->fetch();
        if (!$show) return null;
        $show['rating'] = (float)$show['rating'];
        $show['year'] = $show['year'] !== null ? (int)$show['year'] : null;
        return $show;
    }

    public static function getUserStats(string $username, string $profile = 'Principal'): array {
        $db = Database::getConnection();

        $stmt = $db->prepare("
            SELECT SUM(progress_seconds) as total_time, COUNT(DISTINCT episode_id) as watched_eps
            FROM watch_history
            WHERE username = :u AND profile_name = :p
        ");
        $stmt->execute(['u' => $username, 'p' => $profile]);
        $row = $stmt->fetch() ?: [];
        $totalTime = (int)($row['total_time'] ?? 0);
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
        $stmt = $db->prepare("
            SELECT e.id as episode_id, e.season_number, e.episode_number, e.title as episode_title, s.id as show_id, s.title as show_title, s.poster_path
            FROM favorites f
            JOIN shows s ON f.show_id = s.id
            JOIN episodes e ON e.show_id = s.id
            WHERE f.username = :u AND f.profile_name = :p
            ORDER BY e.season_number DESC, e.episode_number DESC
            LIMIT 20
        ");
        $stmt->execute(['u' => $username, 'p' => $profile]);
        $rows = $stmt->fetchAll();

        return array_map(function($r) {
            return [
                'id' => 'notif_' . $r['episode_id'],
                'show_id' => $r['show_id'],
                'show_title' => $r['show_title'],
                'poster_path' => $r['poster_path'] ?? '',
                'episode_id' => $r['episode_id'],
                'season_number' => (int)$r['season_number'],
                'episode_number' => (int)$r['episode_number'],
                'title' => $r['episode_title'] ?? '',
                'message' => "¡Nuevo episodio disponible! S{$r['season_number']} E{$r['episode_number']}: {$r['show_title']}",
                'created_at' => date('Y-m-d H:i:s')
            ];
        }, $rows);
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
        $ins->execute(['u' => $username, 'p' => $hash, 'r' => $role]);

        // Create default profile
        self::saveUserProfile($username, [
            'id' => 'profile_' . uniqid(),
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
        $stmt = $db->prepare("SELECT * FROM users WHERE username = :u");
        $stmt->execute(['u' => $username]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public static function getUserProfiles(string $username): array {
        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM user_profiles WHERE username = :u ORDER BY created_at ASC");
        $stmt->execute(['u' => $username]);
        return $stmt->fetchAll();
    }

    public static function saveUserProfile(string $username, array $data): array {
        $db = Database::getConnection();
        $id = $data['id'] ?? ('prof_' . uniqid());
        $name = trim($data['name'] ?? 'Perfil');
        $avatar = $data['avatar'] ?? '';
        $color = $data['color'] ?? '#a855f7';
        $isKids = !empty($data['is_kids']) ? 1 : 0;
        $pin = $data['pin'] ?? '';

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
            'p' => $pin
        ]);

        return [
            'id' => $id,
            'username' => $username,
            'name' => $name,
            'avatar' => $avatar,
            'color' => $color,
            'is_kids' => (bool)$isKids,
            'pin' => $pin
        ];
    }

    public static function deleteUserProfile(string $username, string $id): bool {
        $db = Database::getConnection();
        $stmt = $db->prepare("DELETE FROM user_profiles WHERE username = :u AND id = :id");
        return $stmt->execute(['u' => $username, 'id' => $id]);
    }

    public static function getComments(string $showId): array {
        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM comments WHERE show_id = :s ORDER BY created_at DESC");
        $stmt->execute(['s' => $showId]);
        return $stmt->fetchAll();
    }

    public static function addComment(string $showId, string $username, string $profile, string $content, string $episodeId = ''): array {
        $db = Database::getConnection();
        $id = 'comm_' . uniqid();
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
}

