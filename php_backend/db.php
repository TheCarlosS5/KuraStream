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
                        PDO::ATTR_TIMEOUT => 2,
                        // Every timestamp is stored and read in UTC whatever the database server's own zone is
                        // (a MySQL container is UTC, a Debian host is local time); responses add the "Z".
                        PDO::MYSQL_ATTR_INIT_COMMAND => "SET time_zone = '+00:00'"
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

    private static function schemaMarkerKey(): string {
        return md5(DB_HOST . '|' . DB_PORT . '|' . DB_NAME);
    }

    /** How long a failed migration is left alone before another request may retry it. */
    private const MIGRATION_RETRY_SECONDS = 300;

    /**
     * The last migration failure for this database ({error, latest, at}), or null. /api/health reports it as
     * "degraded"; requests do not keep re-running a migration that just failed.
     */
    public static function migrationProblem(): ?array {
        $file = sys_get_temp_dir() . '/kurastream_schema_failed_' . self::schemaMarkerKey() . '.json';
        $data = is_file($file) ? json_decode((string)@file_get_contents($file), true) : null;
        return is_array($data) ? $data : null;
    }

    /**
     * Brings the schema up to date after a code update, so new columns exist before any query uses them.
     * A marker file keyed on the newest migration keeps this to a filesystem check on normal requests.
     * Nothing runs unless this process holds the migration lock, and a failure stops the attempts for a while
     * instead of repeating the same failing statement on every request.
     */
    private static function applyPendingMigrations(PDO $pdo): void {
        $files = glob(__DIR__ . '/migrations/*.sql') ?: [];
        if (empty($files)) {
            return;
        }
        sort($files);
        $latest = basename(end($files));
        $key = self::schemaMarkerKey();
        $marker = sys_get_temp_dir() . '/kurastream_schema_' . $key . '.txt';
        $failMarker = sys_get_temp_dir() . '/kurastream_schema_failed_' . $key . '.json';
        if (@file_get_contents($marker) === $latest) {
            return;
        }
        $problem = self::migrationProblem();
        if ($problem && ($problem['latest'] ?? '') === $latest && time() - (int)($problem['at'] ?? 0) < self::MIGRATION_RETRY_SECONDS) {
            return;
        }

        require_once __DIR__ . '/services/MigrationManager.php';
        // Several server workers can get here at once; only one may run the ALTER statements.
        $locked = (int)$pdo->query("SELECT GET_LOCK('kurastream_migrations', 30)")->fetchColumn() === 1;
        if (!$locked) {
            error_log('KuraStream: could not get the migration lock; migrations not run by this process');
            return;
        }
        try {
            MigrationManager::runPending($pdo);
            @file_put_contents($marker, $latest);
            @unlink($failMarker);
        } catch (Throwable $e) {
            error_log('KuraStream migration error: ' . $e->getMessage());
            @file_put_contents($failMarker, json_encode(['error' => 'Migration failed', 'detail' => mb_substr($e->getMessage(), 0, 500), 'latest' => $latest, 'at' => time()]));
        } finally {
            $pdo->query("SELECT RELEASE_LOCK('kurastream_migrations')");
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

    /** Columns the catalogue cards need. cast_members (a LONGTEXT only the detail page uses) is left out of lists. */
    private const CATALOG_COLUMNS = 'id, title, synopsis, rating, year, studio, director, writer, poster_path, backdrop_path, media_type, backdrop_loops, genres, trailer_key, age_rating, status, tmdb_id, created_at';

    /** Age ratings from 0 (everyone) to 3 (adults). Unknown or missing ratings count as 2, like the apps' default "TV-14". */
    public const RATING_LEVELS = ['G' => 0, 'TV-Y' => 0, 'TV-Y7' => 0, 'TV-G' => 0, 'PG' => 1, 'TV-PG' => 1,
        'PG-13' => 2, 'TV-14' => 2, 'R' => 3, 'TV-MA' => 3, 'NC-17' => 3, '18+' => 3, 'RX' => 3, 'R18' => 3];
    /** The caps a profile can be given, as the rating level they allow. */
    public const MAX_RATING_LEVEL = ['G' => 0, 'PG' => 1, 'PG-13' => 2];

    public static function ratingLevel(?string $rating): int {
        return self::RATING_LEVELS[strtoupper(trim((string)$rating))] ?? 2;
    }

    private static function ratingLevelSql(): string {
        $cases = '';
        foreach (self::RATING_LEVELS as $name => $level) {
            $cases .= " WHEN '" . $name . "' THEN " . $level;
        }
        return "(CASE UPPER(TRIM(COALESCE(age_rating, '')))" . $cases . " ELSE 2 END)";
    }

    /** SQL condition for "suitable for a kids profile": the same rule as ShowController::isAdultOrMaturityRestricted. */
    private const KIDS_SAFE_SQL = "UPPER(TRIM(COALESCE(age_rating, ''))) NOT IN ('R', 'TV-MA', '18+', 'NC-17', 'RX', 'R18')
        AND LOWER(COALESCE(genres, '')) NOT LIKE '%ecchi%' AND LOWER(COALESCE(genres, '')) NOT LIKE '%hentai%' AND LOWER(COALESCE(genres, '')) NOT LIKE '%erotica%'";

    /**
     * The catalogue list, filtered, sorted and paged in SQL.
     * @param array{type?:string,status?:string,sort?:string,kids?:bool,limit?:int,offset?:int} $opts
     * @return array{items: array, total: int}
     */
    public static function getCatalogShows(array $opts = []): array {
        $db = Database::getConnection();
        $where = [];
        $params = [];
        if (($opts['type'] ?? 'all') !== 'all') {
            $where[] = 'media_type = :type';
            $params['type'] = $opts['type'];
        }
        if (($opts['status'] ?? 'all') !== 'all') {
            $where[] = "COALESCE(status, 'finished') = :status";
            $params['status'] = $opts['status'];
        }
        if (!empty($opts['kids'])) {
            $where[] = '(' . self::KIDS_SAFE_SQL . ')';
        }
        if (isset($opts['max_level']) && $opts['max_level'] !== null) {
            $where[] = self::ratingLevelSql() . ' <= ' . (int)$opts['max_level'];
        }
        $whereSql = $where ? ' WHERE ' . implode(' AND ', $where) : '';
        $order = match ($opts['sort'] ?? 'default') {
            'year_desc' => 'COALESCE(year, 0) DESC, title ASC',
            'year_asc' => 'COALESCE(year, 0) ASC, title ASC',
            'rating_desc' => 'rating DESC, title ASC',
            'title_asc' => 'title ASC',
            default => 'id ASC',
        };

        $total = $db->prepare('SELECT COUNT(*) FROM shows' . $whereSql);
        $total->execute($params);

        $sql = 'SELECT ' . self::CATALOG_COLUMNS . ' FROM shows' . $whereSql . ' ORDER BY ' . $order;
        $limit = isset($opts['limit']) ? max(1, min(1000, (int)$opts['limit'])) : null;
        if ($limit !== null) {
            $sql .= ' LIMIT ' . $limit . ' OFFSET ' . max(0, (int)($opts['offset'] ?? 0));
        }
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        $items = array_map(function ($s) {
            $s['rating'] = (float)$s['rating'];
            $s['year'] = $s['year'] !== null ? (int)$s['year'] : null;
            return $s;
        }, $stmt->fetchAll());
        return ['items' => $items, 'total' => (int)$total->fetchColumn()];
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

        // Exact matches first (primary key and the title index): the usual case, and it must win over a looser
        // pattern match that happens to hit another show.
        $stmt = $db->prepare("
            SELECT * FROM shows
            WHERE id IN (:f1, :f2) OR title = :t1 OR title = :t2
            ORDER BY (id = :f3) DESC
            LIMIT 1
        ");
        $stmt->execute([
            'f1' => $folder,
            'f2' => strtolower(preg_replace('/[^A-Za-z0-9]+/', '_', $folder)),
            'f3' => $folder,
            't1' => $cleanFolder,
            't2' => $cleanTitle,
        ]);
        $show = $stmt->fetch();
        if (!$show) {
            // Looser: the folder name as a pattern inside a title or id.
            $prefix = '%' . trim(str_replace('_', '%', $folder)) . '%';
            $stmt = $db->prepare("SELECT * FROM shows WHERE title LIKE :p1 OR id LIKE :p2 ORDER BY title ASC LIMIT 1");
            $stmt->execute(['p1' => $prefix, 'p2' => $prefix]);
            $show = $stmt->fetch();
        }
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

    /**
     * Stores watch progress.
     *  - The episode id must be the canonical one (HistoryController resolves it), or the row would not join its episode.
     *  - `completed` only ever goes up: watching the first minutes of a finished episode again does not unmark it
     *    (unmarking is an explicit delete from the history).
     *  - $clientTimeMs (the device's clock) makes the newest write win: an older write, for example a phone that
     *    reconnects and uploads stale progress, is ignored for position and duration.
     */
    public static function saveProgress(string $username, string $profile, string $episodeId, float $progress, float $duration = 0, ?bool $completed = null, ?int $clientTimeMs = null): void {
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

        // A clock more than a day ahead is a wrong clock, not "newer than everything": ignore it.
        if ($clientTimeMs !== null && ($clientTimeMs <= 0 || $clientTimeMs > (time() + 86400) * 1000)) {
            $clientTimeMs = null;
        }

        // Assignments run left to right and see earlier ones, so client_updated_at is assigned last.
        $stmt = $db->prepare("
            INSERT INTO watch_history (username, profile_name, episode_id, progress_seconds, duration, completed, client_updated_at)
            VALUES (:u, :p, :e, :prog, :dur, :comp, :ts)
            ON DUPLICATE KEY UPDATE
                progress_seconds = IF(VALUES(client_updated_at) IS NULL OR client_updated_at IS NULL OR VALUES(client_updated_at) >= client_updated_at, VALUES(progress_seconds), progress_seconds),
                duration = IF(VALUES(duration) > 0 AND (VALUES(client_updated_at) IS NULL OR client_updated_at IS NULL OR VALUES(client_updated_at) >= client_updated_at), VALUES(duration), duration),
                completed = GREATEST(completed, VALUES(completed)),
                client_updated_at = IF(VALUES(client_updated_at) IS NULL, client_updated_at, GREATEST(IFNULL(client_updated_at, 0), VALUES(client_updated_at)))
        ");
        $stmt->execute([
            'u' => $username,
            'p' => $profile,
            'e' => $episodeId,
            'prog' => $progress,
            'dur' => $duration,
            'comp' => $completed ? 1 : 0,
            'ts' => $clientTimeMs
        ]);
    }

    /**
     * Marks episodes as watched (finished, progress = their duration) or not watched (history row removed, so
     * they also leave "continue watching"). Unknown ids are ignored. Returns how many episodes were affected.
     * @param string[] $episodeIds
     */
    public static function markEpisodesWatched(string $username, string $profile, array $episodeIds, bool $watched): int {
        $episodeIds = array_values(array_unique(array_filter($episodeIds, 'is_string')));
        if (!$episodeIds) {
            return 0;
        }
        $db = Database::getConnection();
        $marks = implode(',', array_fill(0, count($episodeIds), '?'));
        $st = $db->prepare("SELECT id, duration FROM episodes WHERE id IN ($marks)");
        $st->execute($episodeIds);
        $episodes = $st->fetchAll();
        if (!$episodes) {
            return 0;
        }
        self::transactional(function (PDO $db) use ($username, $profile, $episodes, $watched) {
            if ($watched) {
                $ins = $db->prepare("
                    INSERT INTO watch_history (username, profile_name, episode_id, progress_seconds, duration, completed)
                    VALUES (:u, :p, :e, :prog, :dur, 1)
                    ON DUPLICATE KEY UPDATE completed = 1,
                        progress_seconds = IF(VALUES(duration) > 0, VALUES(duration), progress_seconds),
                        duration = IF(VALUES(duration) > 0, VALUES(duration), duration)
                ");
                foreach ($episodes as $ep) {
                    $dur = (float)($ep['duration'] ?? 0);
                    $ins->execute(['u' => $username, 'p' => $profile, 'e' => $ep['id'], 'prog' => $dur, 'dur' => $dur]);
                }
            } else {
                $del = $db->prepare("DELETE FROM watch_history WHERE username = :u AND profile_name = :p AND episode_id = :e");
                foreach ($episodes as $ep) {
                    $del->execute(['u' => $username, 'p' => $profile, 'e' => $ep['id']]);
                }
            }
        });
        return count($episodes);
    }

    /** Episode ids of a show (optionally one season), for "mark the whole season". */
    public static function getEpisodeIdsForShow(string $showId, ?int $season = null): array {
        $db = Database::getConnection();
        if ($season === null) {
            $st = $db->prepare("SELECT id FROM episodes WHERE show_id = :s");
            $st->execute(['s' => $showId]);
        } else {
            $st = $db->prepare("SELECT id FROM episodes WHERE show_id = :s AND season_number = :n");
            $st->execute(['s' => $showId, 'n' => $season]);
        }
        return $st->fetchAll(PDO::FETCH_COLUMN);
    }

    /** @return array<string,int> show id => 1..5 */
    public static function getRatings(string $username, string $profile): array {
        $st = Database::getConnection()->prepare("SELECT show_id, rating FROM show_ratings WHERE username = :u AND profile_name = :p");
        $st->execute(['u' => $username, 'p' => $profile]);
        return array_map('intval', $st->fetchAll(PDO::FETCH_KEY_PAIR));
    }

    /** null clears the rating. */
    public static function setRating(string $username, string $profile, string $showId, ?int $rating): void {
        $db = Database::getConnection();
        if ($rating === null) {
            $db->prepare("DELETE FROM show_ratings WHERE username = :u AND profile_name = :p AND show_id = :s")
                ->execute(['u' => $username, 'p' => $profile, 's' => $showId]);
            return;
        }
        $db->prepare("
            INSERT INTO show_ratings (username, profile_name, show_id, rating) VALUES (:u, :p, :s, :r)
            ON DUPLICATE KEY UPDATE rating = VALUES(rating)
        ")->execute(['u' => $username, 'p' => $profile, 's' => $showId, 'r' => $rating]);
    }

    /** Genres as a lowercase list ("Acción, Fantasía" -> ['acción', 'fantasía']). */
    public static function genreList($genres): array {
        $text = is_array($genres) ? implode(',', $genres) : (string)$genres;
        $list = array_filter(array_map(fn($g) => mb_strtolower(trim($g), 'UTF-8'), preg_split('/[,;\/]/', $text) ?: []), fn($g) => $g !== '');
        return array_values(array_unique($list));
    }

    /**
     * "Porque viste X": up to two groups of shows that share genres with what the profile watched most recently
     * (or rated 4-5), leaving out what it already started and what it rated 1-2. Pure data work: the caller applies
     * the kids / rating-cap rules to the candidates.
     * @param callable $allowed fn(array $show): bool
     * @return array<int, array{because: array{id:string,title:string}, shows: array}>
     */
    public static function getRecommendations(string $username, string $profile, callable $allowed, int $perGroup = 12): array {
        $db = Database::getConnection();
        $seedRows = $db->prepare("
            SELECT e.show_id, MAX(h.updated_at) AS last_at
            FROM watch_history h JOIN episodes e ON e.id = h.episode_id
            WHERE h.username = :u AND h.profile_name = :p
            GROUP BY e.show_id ORDER BY last_at DESC LIMIT 12
        ");
        $seedRows->execute(['u' => $username, 'p' => $profile]);
        $recent = $seedRows->fetchAll(PDO::FETCH_COLUMN);

        $ratings = self::getRatings($username, $profile);
        $loved = array_keys(array_filter($ratings, fn($r) => $r >= 4));
        $seedIds = array_slice(array_values(array_unique(array_merge($loved, $recent))), 0, 3);
        if (!$seedIds) {
            return [];
        }

        $touched = $db->prepare("SELECT DISTINCT e.show_id FROM watch_history h JOIN episodes e ON e.id = h.episode_id WHERE h.username = :u AND h.profile_name = :p");
        $touched->execute(['u' => $username, 'p' => $profile]);
        $exclude = array_flip(array_merge($touched->fetchAll(PDO::FETCH_COLUMN), array_keys(array_filter($ratings, fn($r) => $r <= 2))));

        $catalog = $db->query('SELECT ' . self::CATALOG_COLUMNS . ' FROM shows')->fetchAll();
        $byId = [];
        foreach ($catalog as $row) {
            $byId[$row['id']] = $row;
        }

        $groups = [];
        foreach ($seedIds as $seedId) {
            if (!isset($byId[$seedId])) continue;
            $seed = $byId[$seedId];
            $seedGenres = self::genreList($seed['genres'] ?? '');
            if (!$seedGenres) continue;
            $scored = [];
            foreach ($byId as $id => $cand) {
                if ($id === $seedId || isset($exclude[$id]) || !$allowed($cand)) continue;
                $overlap = count(array_intersect($seedGenres, self::genreList($cand['genres'] ?? '')));
                if ($overlap === 0) continue;
                $scored[] = ['score' => $overlap * 10 + (float)$cand['rating'], 'show' => $cand];
            }
            usort($scored, fn($a, $b) => $b['score'] <=> $a['score']);
            $shows = array_map(fn($x) => $x['show'], array_slice($scored, 0, $perGroup));
            if (count($shows) >= 3) {
                $groups[] = ['because' => ['id' => $seed['id'], 'title' => $seed['title']], 'shows' => $shows];
                // Shows already offered in one group are not repeated in the next
                foreach ($shows as $sh) $exclude[$sh['id']] = true;
            }
            if (count($groups) >= 2) break;
        }
        return $groups;
    }

    public const LIST_STATUSES = ['watching', 'planned', 'completed', 'dropped'];

    /** @return array<string,string> show id => status */
    public static function getListStatuses(string $username, string $profile): array {
        $st = Database::getConnection()->prepare("SELECT show_id, status FROM show_list_status WHERE username = :u AND profile_name = :p");
        $st->execute(['u' => $username, 'p' => $profile]);
        return $st->fetchAll(PDO::FETCH_KEY_PAIR);
    }

    /** null clears the status. */
    public static function setListStatus(string $username, string $profile, string $showId, ?string $status): void {
        $db = Database::getConnection();
        if ($status === null) {
            $db->prepare("DELETE FROM show_list_status WHERE username = :u AND profile_name = :p AND show_id = :s")
                ->execute(['u' => $username, 'p' => $profile, 's' => $showId]);
            return;
        }
        $db->prepare("
            INSERT INTO show_list_status (username, profile_name, show_id, status) VALUES (:u, :p, :s, :st)
            ON DUPLICATE KEY UPDATE status = VALUES(status)
        ")->execute(['u' => $username, 'p' => $profile, 's' => $showId, 'st' => $status]);
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
            'pix_fmt' => $ep['pix_fmt'] ?? null,
            'bit_depth' => isset($ep['bit_depth']) ? (int)$ep['bit_depth'] : null,
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
            'container' => $container,
            // The file was not found by the last scans (moved, deleted, disk not mounted); see LibraryScanner.
            'availability_status' => $ep['availability_status'] ?? 'available',
            'available' => ($ep['availability_status'] ?? 'available') !== 'missing'
        ];
    }

    /** Records the pixel format and bit depth of an episode's video (separate from saveEpisode: scans and edits must not overwrite it). */
    public static function setEpisodeVideoFormat(string $episodeId, ?string $pixFmt, ?int $bitDepth): void {
        try {
            Database::getConnection()->prepare("UPDATE episodes SET pix_fmt = :p, bit_depth = :b WHERE id = :id")
                ->execute(['p' => $pixFmt, 'b' => $bitDepth, 'id' => $episodeId]);
        } catch (PDOException $e) {
            if ((int)($e->errorInfo[1] ?? 0) !== 1054) { // 1054: migration 017 not applied yet
                throw $e;
            }
        }
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

    public static function getRandomShow(bool $isKids = false, ?int $maxLevel = null): ?array {
        $db = Database::getConnection();
        $conditions = [];
        if ($isKids) $conditions[] = '(' . self::KIDS_SAFE_SQL . ')';
        if ($maxLevel !== null) $conditions[] = self::ratingLevelSql() . ' <= ' . (int)$maxLevel;
        $sql = 'SELECT * FROM shows' . ($conditions ? ' WHERE ' . implode(' AND ', $conditions) : '') . ' ORDER BY RAND() LIMIT 1';
        $show = $db->query($sql)->fetch();
        if (!$show) return null;
        $show['rating'] = (float)$show['rating'];
        $show['year'] = $show['year'] !== null ? (int)$show['year'] : null;
        return $show;
    }

    /**
     * Year in review for a profile: hours, episodes, shows started, the most watched show, the busiest month and
     * the favourite genre. Works from watch_history.updated_at (UTC), so a show rewatched later counts in the later year.
     */
    public static function getYearSummary(string $username, string $profile, int $year): array {
        $db = Database::getConnection();
        $st = $db->prepare("
            SELECT e.show_id, s.title, s.genres, MONTH(h.updated_at) AS month,
                   CASE WHEN h.completed = 1 AND h.duration > 0 THEN h.duration ELSE COALESCE(h.progress_seconds, 0) END AS seconds
            FROM watch_history h
            JOIN episodes e ON e.id = h.episode_id
            JOIN shows s ON s.id = e.show_id
            WHERE h.username = :u AND h.profile_name = :p AND YEAR(h.updated_at) = :y
        ");
        $st->execute(['u' => $username, 'p' => $profile, 'y' => $year]);
        $rows = $st->fetchAll();

        $seconds = 0.0;
        $perShow = [];
        $perMonth = [];
        $genres = [];
        foreach ($rows as $r) {
            $seconds += (float)$r['seconds'];
            $perShow[$r['show_id']] = ($perShow[$r['show_id']] ?? ['title' => $r['title'], 'episodes' => 0, 'seconds' => 0.0]);
            $perShow[$r['show_id']]['episodes']++;
            $perShow[$r['show_id']]['seconds'] += (float)$r['seconds'];
            $perMonth[(int)$r['month']] = ($perMonth[(int)$r['month']] ?? 0) + (float)$r['seconds'];
            foreach (self::genreList($r['genres'] ?? '') as $g) {
                $genres[$g] = ($genres[$g] ?? 0) + 1;
            }
        }
        uasort($perShow, fn($a, $b) => [$b['episodes'], $b['seconds']] <=> [$a['episodes'], $a['seconds']]);
        arsort($perMonth);
        arsort($genres);
        $top = $perShow ? array_slice($perShow, 0, 5, true) : [];

        return [
            'year' => $year,
            'total_time_seconds' => (int)round($seconds),
            'episodes_watched' => count($rows),
            'shows_watched' => count($perShow),
            'top_shows' => array_values(array_map(fn($id, $v) => ['id' => $id, 'title' => $v['title'], 'episodes' => $v['episodes']], array_keys($top), $top)),
            'busiest_month' => $perMonth ? (int)array_key_first($perMonth) : null,
            'top_genre' => $genres ? (string)array_key_first($genres) : null,
        ];
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
                $isUnread = (strtotime($createdAt . ' UTC') > strtotime($lastSeenAt . ' UTC'));
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

    /**
     * Account fields needed to validate a session on every request: a primary-key lookup, not LOWER(), so it
     * stays cheap. Returns null when the account does not exist. Falls back to version 0 while migration 013
     * (users.token_version) has not been applied yet, so a deployment never turns into a login outage.
     */
    public static function getAccountState(string $username): ?array {
        $db = Database::getConnection();
        try {
            $stmt = $db->prepare("SELECT username, role, token_version, disabled FROM users WHERE username = :u");
            $stmt->execute(['u' => $username]);
        } catch (PDOException $e) {
            if ((int)($e->errorInfo[1] ?? 0) !== 1054) {
                throw $e;
            }
            // Migrations 013/022 not applied yet: no token versions, no disabled accounts
            try {
                $stmt = $db->prepare("SELECT username, role, token_version, 0 AS disabled FROM users WHERE username = :u");
                $stmt->execute(['u' => $username]);
            } catch (PDOException $e2) {
                if ((int)($e2->errorInfo[1] ?? 0) !== 1054) {
                    throw $e2;
                }
                $stmt = $db->prepare("SELECT username, role, 0 AS token_version, 0 AS disabled FROM users WHERE username = :u");
                $stmt->execute(['u' => $username]);
            }
        }
        $row = $stmt->fetch();
        if (!$row) {
            return null;
        }
        $row['token_version'] = (int)$row['token_version'];
        $row['disabled'] = (int)$row['disabled'] === 1;
        return $row;
    }

    /** The profile a session token points to, as it is now (name and kids flag can change after the token was issued). */
    public static function getSessionProfile(string $username, ?string $profileId, ?string $profileName): ?array {
        $db = Database::getConnection();
        if (!empty($profileId)) {
            $where = 'id = :id AND username = :u';
            $params = ['id' => $profileId, 'u' => $username];
        } elseif (!empty($profileName)) {
            $where = 'name = :n AND username = :u';
            $params = ['n' => $profileName, 'u' => $username];
        } else {
            return null;
        }
        try {
            $stmt = $db->prepare("SELECT id, name, is_kids, max_rating, daily_limit_minutes FROM user_profiles WHERE $where");
            $stmt->execute($params);
        } catch (PDOException $e) {
            if ((int)($e->errorInfo[1] ?? 0) !== 1054) {
                throw $e;
            }
            // Migration 024 not applied yet: no parental caps
            $stmt = $db->prepare("SELECT id, name, is_kids, NULL AS max_rating, NULL AS daily_limit_minutes FROM user_profiles WHERE $where");
            $stmt->execute($params);
        }
        return $stmt->fetch() ?: null;
    }

    // ---- Screen time -------------------------------------------------------------------------------------------

    /**
     * Adds the time since the previous progress save of this profile today. Saves arrive every few seconds while
     * something plays, so a gap longer than 40 s (paused, closed, another device) counts as a short fixed slice
     * instead of the whole gap.
     */
    public static function addWatchTime(string $username, string $profile): void {
        $db = Database::getConnection();
        try {
            $db->prepare("
                INSERT INTO profile_watch_time (username, profile_name, day, seconds, last_ping)
                VALUES (:u, :p, UTC_DATE(), 5, UTC_TIMESTAMP())
                ON DUPLICATE KEY UPDATE
                    seconds = seconds + IF(last_ping IS NOT NULL AND TIMESTAMPDIFF(SECOND, last_ping, UTC_TIMESTAMP()) BETWEEN 0 AND 40,
                                           TIMESTAMPDIFF(SECOND, last_ping, UTC_TIMESTAMP()), 5),
                    last_ping = UTC_TIMESTAMP()
            ")->execute(['u' => $username, 'p' => $profile]);
        } catch (PDOException $e) {
            // Migration 024 not applied yet: tracking is off, playback is not affected
        }
    }

    public static function getWatchSecondsToday(string $username, string $profile): int {
        try {
            $st = Database::getConnection()->prepare("SELECT seconds FROM profile_watch_time WHERE username = :u AND profile_name = :p AND day = UTC_DATE()");
            $st->execute(['u' => $username, 'p' => $profile]);
            return (int)$st->fetchColumn();
        } catch (PDOException $e) {
            return 0;
        }
    }

    /** Invalidates every session token issued so far for the account. Returns the new version. */
    public static function bumpTokenVersion(string $username): int {
        $db = Database::getConnection();
        $db->prepare("UPDATE users SET token_version = token_version + 1 WHERE username = :u")->execute(['u' => $username]);
        $st = $db->prepare("SELECT token_version FROM users WHERE username = :u");
        $st->execute(['u' => $username]);
        return (int)$st->fetchColumn();
    }

    /** Stores a new password hash and revokes all existing sessions in one statement. Returns the new token version. */
    public static function replacePasswordHash(string $username, string $passwordHash): int {
        $db = Database::getConnection();
        $db->prepare("UPDATE users SET password_hash = :p, token_version = token_version + 1 WHERE username = :u")
            ->execute(['p' => $passwordHash, 'u' => $username]);
        $st = $db->prepare("SELECT token_version FROM users WHERE username = :u");
        $st->execute(['u' => $username]);
        return (int)$st->fetchColumn();
    }

    // ---- Account administration (AdminUsersController) -------------------------------------------------------

    /** Every account with the figures an administrator needs to spot abandoned or abusive ones. */
    public static function listUsersForAdmin(): array {
        $db = Database::getConnection();
        $rows = $db->query("
            SELECT u.username, u.role, u.disabled, u.created_at, u.last_login_at,
                   (SELECT COUNT(*) FROM user_profiles p WHERE p.username = u.username) AS profile_count,
                   (SELECT MAX(h.updated_at) FROM watch_history h WHERE h.username = u.username) AS last_watched_at
            FROM users u
            ORDER BY u.created_at DESC, u.username ASC
        ")->fetchAll();
        return array_map(function ($r) {
            return [
                'username' => $r['username'],
                'role' => $r['role'],
                'disabled' => (int)$r['disabled'] === 1,
                'profile_count' => (int)$r['profile_count'],
                'created_at' => $r['created_at'],
                'last_login_at' => $r['last_login_at'],
                'last_watched_at' => $r['last_watched_at'],
            ];
        }, $rows);
    }

    public static function touchLastLogin(string $username): void {
        try {
            Database::getConnection()->prepare("UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE username = :u")
                ->execute(['u' => $username]);
        } catch (PDOException $e) {
            // Migration 022 not applied yet: logging in must not depend on it
        }
    }

    /** Locks or unlocks an account. Locking also revokes its sessions. Returns false when the account does not exist. */
    public static function setUserDisabled(string $username, bool $disabled): bool {
        $db = Database::getConnection();
        $st = $db->prepare("UPDATE users SET disabled = :d, token_version = token_version + 1 WHERE username = :u");
        $st->execute(['d' => $disabled ? 1 : 0, 'u' => $username]);
        return self::userExists($username);
    }

    /** Changes the role and revokes sessions (they would pick the new role up anyway; this also ends stale ones). */
    public static function setUserRole(string $username, string $role): bool {
        $db = Database::getConnection();
        $db->prepare("UPDATE users SET role = :r, token_version = token_version + 1 WHERE username = :u")
            ->execute(['r' => $role, 'u' => $username]);
        return self::userExists($username);
    }

    public static function userExists(string $username): bool {
        $st = Database::getConnection()->prepare("SELECT 1 FROM users WHERE username = :u");
        $st->execute(['u' => $username]);
        return (bool)$st->fetchColumn();
    }

    public static function countEnabledAdmins(): int {
        try {
            return (int)Database::getConnection()->query("SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0")->fetchColumn();
        } catch (PDOException $e) {
            return (int)Database::getConnection()->query("SELECT COUNT(*) FROM users WHERE role = 'admin'")->fetchColumn();
        }
    }

    /** Deletes the account and everything it owns. Returns false when the account does not exist. */
    public static function deleteUserAccount(string $username): bool {
        $db = Database::getConnection();
        if (!self::userExists($username)) {
            return false;
        }
        $db->beginTransaction();
        try {
            foreach (['watch_history', 'favorites', 'user_preferences', 'show_list_status', 'show_ratings', 'comments', 'user_profiles'] as $table) {
                $db->prepare("DELETE FROM {$table} WHERE username = :u")->execute(['u' => $username]);
            }
            // Rooms they host end with them; memberships elsewhere just disappear
            $rooms = $db->prepare("SELECT id FROM party_rooms WHERE host_user = :u");
            $rooms->execute(['u' => $username]);
            foreach ($rooms->fetchAll(PDO::FETCH_COLUMN) as $roomId) {
                $db->prepare("DELETE FROM party_messages WHERE room_id = :r")->execute(['r' => $roomId]);
                $db->prepare("DELETE FROM party_members WHERE room_id = :r")->execute(['r' => $roomId]);
                $db->prepare("DELETE FROM party_rooms WHERE id = :r")->execute(['r' => $roomId]);
            }
            $db->prepare("DELETE FROM party_members WHERE account_username = :u")->execute(['u' => $username]);
            $db->prepare("DELETE FROM users WHERE username = :u")->execute(['u' => $username]);
            $db->commit();
        } catch (Throwable $e) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            throw $e;
        }
        return true;
    }

    /**
     * Profile avatars live under /library/avatars/. Anything else (external URLs, quotes, parentheses, "..")
     * is dropped: the value ends up in CSS `url(...)` on other people's screens (comments, profile grid).
     */
    public static function normalizeAvatarUrl($value): string {
        $v = is_string($value) ? trim($value) : '';
        if ($v === '' || strlen($v) > 500 || str_contains($v, '..')) {
            return '';
        }
        return preg_match('#^/library/avatars/[A-Za-z0-9_./-]+$#', $v) === 1 ? $v : '';
    }

    public static function isValidProfileColor($value): bool {
        return is_string($value) && preg_match('/^#[0-9a-fA-F]{6}$/', $value) === 1;
    }

    /** A stored colour that is not #RRGGBB (older rows, direct edits) is shown as the default instead of reaching CSS. */
    public static function normalizeProfileColor($value, string $fallback = '#a855f7'): string {
        return self::isValidProfileColor($value) ? $value : $fallback;
    }

    public static function sanitizeProfileForClient(array $profile): array {
        $hasPin = !empty($profile['pin']);
        unset($profile['pin']);
        $profile['has_pin'] = $hasPin;
        if (array_key_exists('avatar', $profile)) {
            $profile['avatar'] = self::normalizeAvatarUrl($profile['avatar']);
        }
        foreach (['color', 'avatar_color'] as $colorKey) {
            if (array_key_exists($colorKey, $profile)) {
                $profile[$colorKey] = self::normalizeProfileColor($profile[$colorKey]);
            }
        }
        // Raw rows carry is_kids as 0/1; typed clients (the Android app) require a JSON boolean.
        $profile['is_kids'] = (bool)($profile['is_kids'] ?? false);
        if (array_key_exists('daily_limit_minutes', $profile)) {
            $profile['daily_limit_minutes'] = $profile['daily_limit_minutes'] !== null ? (int)$profile['daily_limit_minutes'] : null;
        }
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
        } elseif ($avatar !== '') {
            $avatar = self::normalizeAvatarUrl($avatar);
        }

        $color = $data['avatar_color'] ?? $data['color'] ?? '#a855f7';
        if (!self::isValidProfileColor($color)) {
            jsonError('El color del perfil debe tener el formato #RRGGBB', 400);
        }
        $isKids = !empty($data['is_kids']) ? 1 : 0;

        // Parental caps keep their value when a client (an older app) does not send them
        $maxRating = $existing['max_rating'] ?? null;
        if (array_key_exists('max_rating', $data)) {
            $raw = is_string($data['max_rating']) ? strtoupper(trim($data['max_rating'])) : '';
            if ($raw === '' || $raw === 'NONE') {
                $maxRating = null;
            } elseif (isset(self::MAX_RATING_LEVEL[$raw])) {
                $maxRating = $raw;
            } else {
                jsonError('La clasificación máxima debe ser G, PG, PG-13 o ninguna', 400);
            }
        }
        $dailyLimit = isset($existing['daily_limit_minutes']) ? (int)$existing['daily_limit_minutes'] : null;
        if (array_key_exists('daily_limit_minutes', $data)) {
            if ($data['daily_limit_minutes'] === null || $data['daily_limit_minutes'] === '' || $data['daily_limit_minutes'] === 0) {
                $dailyLimit = null;
            } elseif (is_numeric($data['daily_limit_minutes']) && (int)$data['daily_limit_minutes'] >= 15 && (int)$data['daily_limit_minutes'] <= 1440) {
                $dailyLimit = (int)$data['daily_limit_minutes'];
            } else {
                jsonError('El límite diario debe estar entre 15 y 1440 minutos', 400);
            }
        }
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
            INSERT INTO user_profiles (id, username, name, avatar, color, is_kids, pin, max_rating, daily_limit_minutes)
            VALUES (:id, :u, :n, :a, :c, :k, :p, :mr, :dl)
            ON DUPLICATE KEY UPDATE
                name = VALUES(name),
                avatar = VALUES(avatar),
                color = VALUES(color),
                is_kids = VALUES(is_kids),
                pin = VALUES(pin),
                max_rating = VALUES(max_rating),
                daily_limit_minutes = VALUES(daily_limit_minutes)
        ");
        $stmt->execute([
            'id' => $id,
            'u' => $username,
            'n' => $name,
            'a' => $avatar,
            'c' => $color,
            'k' => $isKids,
            'p' => $pinHash,
            'mr' => $maxRating,
            'dl' => $dailyLimit
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
            'max_rating' => $maxRating,
            'daily_limit_minutes' => $dailyLimit,
            'pin' => $pinHash
        ]);
    }

    /** Tables whose rows belong to a profile through (username, profile_name). Comments stay as authored. */
    private const PROFILE_DATA_TABLES = ['watch_history', 'favorites', 'user_preferences', 'show_list_status', 'show_ratings'];

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

    /**
     * Comments of a show, newest first (at most 300). The login name never leaves the server; instead each comment
     * says whether the viewer may delete it (their own, or any for an administrator).
     */
    public static function getComments(string $showId, ?string $viewerUsername = null, bool $viewerIsAdmin = false): array {
        $db = Database::getConnection();
        $stmt = $db->prepare("
            SELECT c.id, c.show_id, c.episode_id, c.content, c.created_at, c.username AS owner,
                   COALESCE(NULLIF(c.profile_name, ''), 'Usuario') AS profile_name,
                   p.avatar, p.color as avatar_color
            FROM comments c
            LEFT JOIN user_profiles p ON p.username = c.username AND p.name = c.profile_name
            WHERE c.show_id = :s
            ORDER BY c.created_at DESC
            LIMIT 300
        ");
        $stmt->execute(['s' => $showId]);
        return array_map(function ($row) use ($viewerUsername, $viewerIsAdmin) {
            $row['avatar'] = self::normalizeAvatarUrl($row['avatar'] ?? '');
            $row['avatar_color'] = self::normalizeProfileColor($row['avatar_color'] ?? '');
            $row['can_delete'] = $viewerIsAdmin
                || ($viewerUsername !== null && $viewerUsername !== '' && strcasecmp((string)$row['owner'], $viewerUsername) === 0);
            unset($row['owner']);
            return $row;
        }, $stmt->fetchAll());
    }

    public static function getCommentOwner(string $id): ?string {
        $st = Database::getConnection()->prepare("SELECT username FROM comments WHERE id = :id");
        $st->execute(['id' => $id]);
        $owner = $st->fetchColumn();
        return $owner === false ? null : (string)$owner;
    }

    public static function deleteComment(string $id): void {
        Database::getConnection()->prepare("DELETE FROM comments WHERE id = :id")->execute(['id' => $id]);
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
            'profile_name' => $profile !== '' ? $profile : 'Usuario',
            'content' => $content,
            'created_at' => gmdate('Y-m-d H:i:s')   // the connection is UTC
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
        $allowGuests = !empty($data['allow_guests']) ? 1 : 0;
        $currentTime = (float)($data['current_time'] ?? 0.0);
        $isPlaying = !empty($data['is_playing']) ? 1 : 0;
        $nowMs = (int)(microtime(true) * 1000);

        $stmt = $db->prepare("
            INSERT INTO party_rooms (id, name, host_user, episode_id, is_playing, `current_time`, last_sync_timestamp, is_public, allow_guest_controls, allow_guests, participants_count, created_at, updated_at)
            VALUES (:id, :name, :host, :ep, :playing, :time, :sync, :pub, :ctrl, :guests, 1, NOW(), NOW())
            ON DUPLICATE KEY UPDATE 
                name = VALUES(name),
                host_user = VALUES(host_user),
                episode_id = VALUES(episode_id),
                is_playing = VALUES(is_playing),
                `current_time` = VALUES(`current_time`),
                last_sync_timestamp = VALUES(last_sync_timestamp),
                is_public = VALUES(is_public),
                allow_guest_controls = VALUES(allow_guest_controls),
                allow_guests = VALUES(allow_guests),
                version = version + 1,
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
            'ctrl' => $allowGuestControls,
            'guests' => $allowGuests
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
        $row['allow_guests'] = !empty($row['allow_guests']);
        $row['participants_count'] = (int)$row['participants_count'];
        $row['version'] = (int)($row['version'] ?? 0);
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

        $sql .= ", version = version + 1, updated_at = NOW() WHERE id = :id";

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
        if (isset($settings['allow_guests'])) {
            $fields[] = "allow_guests = :guests";
            $params['guests'] = !empty($settings['allow_guests']) ? 1 : 0;
        }

        if (empty($fields)) return true;

        $sql = "UPDATE party_rooms SET " . implode(", ", $fields) . ", version = version + 1, updated_at = NOW() WHERE id = :id";
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
            $r['allow_guests'] = !empty($r['allow_guests']);
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
            $db->exec("DELETE FROM party_members WHERE room_id NOT IN (SELECT id FROM party_rooms)");
        }

        return $deleted;
    }

    /**
     * Periodic cleanup (job queue / opportunistic): rooms idle for a day with their messages and members, and
     * members whose last ping is more than 10 minutes old (no one is going to resume those).
     * @return array{rooms: int, members: int}
     */
    public static function runPartyHousekeeping(): array {
        $db = Database::getConnection();
        $rooms = self::cleanupExpiredPartyRooms(24);
        $stmt = $db->prepare("DELETE FROM party_members WHERE last_ping < DATE_SUB(NOW(), INTERVAL 600 SECOND)");
        $stmt->execute();
        return ['rooms' => $rooms, 'members' => $stmt->rowCount()];
    }

    /**
     * One tiny query for the SSE loop: the room's change counter and its newest message id. The full room (a join
     * over episodes and shows) is only read when this changes.
     */
    public static function getPartyRoomPulse(string $roomId): ?array {
        $db = Database::getConnection();
        $stmt = $db->prepare("
            SELECT r.version, (SELECT COALESCE(MAX(m.id), 0) FROM party_messages m WHERE m.room_id = r.id) AS last_message_id
            FROM party_rooms r WHERE r.id = :id
        ");
        $stmt->execute(['id' => $roomId]);
        $row = $stmt->fetch();
        return $row ? ['version' => (int)$row['version'], 'last_message_id' => (int)$row['last_message_id']] : null;
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

    /** A guest is a room member without an account (the host always has one). */
    public static function isGuestMember(array $member): bool {
        return ($member['role'] ?? '') !== 'host' && empty($member['account_username']);
    }

    /** Removes every member without an account (used when the host stops admitting guests). */
    public static function removePartyGuests(string $roomId): void {
        $db = Database::getConnection();
        $db->prepare("DELETE FROM party_members WHERE room_id = :r AND role <> 'host' AND (account_username IS NULL OR account_username = '')")
            ->execute(['r' => $roomId]);
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
            $cleanup = $db->prepare("DELETE FROM party_members WHERE room_id = :r AND datetime(last_ping) < datetime('now', :mod)");
            $sec = max(30, $timeoutSeconds * 2);
            $cleanup->execute(['r' => $roomId, 'mod' => "-{$sec} seconds"]);
        } else {
            // Only this room: a global DELETE on every call scanned the whole table for every participant.
            $cleanup = $db->prepare("DELETE FROM party_members WHERE room_id = :r AND last_ping < DATE_SUB(NOW(), INTERVAL :sec SECOND)");
            $cleanup->bindValue(':r', $roomId);
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
