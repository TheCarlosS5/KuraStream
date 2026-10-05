<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/TmdbScraper.php';
require_once __DIR__ . '/AnimeSources.php';

/**
 * Per-season metadata for multi-season shows.
 *
 * TMDB keeps one show with numbered seasons and gives the whole show the artwork of its latest
 * season; MyAnimeList/AniList have one entry per season or cour, each with its own art. This
 * service keeps the show as a single catalogue entry and stores, per season: TMDB's season poster
 * and synopsis, the AniList banner, and which MAL entry/episode each library episode is (needed
 * for AniSkip). Episodes are matched to MAL entries by air date, which survives the usual
 * numbering differences (TMDB "Season 1" = MAL "Part 1" + "Part 2").
 */
class SeasonSync {
    /** Days before an AniList start date an episode may air and still belong to it (time zones). */
    private const START_TOLERANCE_DAYS = 3;
    /** Days after an AniList end date an episode may air and still belong to it. */
    private const END_TOLERANCE_DAYS = 30;
    private const ALLOWED_IMAGE_HOSTS = ['image.tmdb.org', 's4.anilist.co'];

    /**
     * Pure mapping step (unit-tested).
     * $airDates: TMDB season number => [episode number => 'YYYY-MM-DD'|null] (regular seasons).
     * $chain: AniList entries in watch order (AnimeSources::franchise).
     * Returns season => ['segments' => [...], 'entry' => index of the season's main entry|null].
     * A segment covers consecutive episodes of one MAL entry:
     * ['first' => ep, 'last' => ep, 'mal_id', 'anilist_id', 'mal_first' => MAL episode of `first`,
     *  'mal_episodes' => episode count of that MAL entry|null].
     */
    public static function buildSeasonMap(array $airDates, array $chain): array {
        $bounds = [];
        foreach ($chain as $i => $entry) {
            $start = AnimeSources::dateKey($entry['startDate'] ?? []);
            if ($start === '9999-12-31') continue;
            $end = AnimeSources::dateKey($entry['endDate'] ?? []);
            $bounds[$i] = [
                'from' => self::shiftDate($start, -self::START_TOLERANCE_DAYS),
                'to' => $end === '9999-12-31' ? null : self::shiftDate($end, self::END_TOLERANCE_DAYS),
            ];
        }

        uasort($bounds, fn($a, $b) => strcmp($a['from'], $b['from']));

        // Every dated regular episode, in watch order, assigned to the last entry that started before it.
        $assigned = [];
        $seasons = array_keys($airDates);
        sort($seasons);
        foreach ($seasons as $season) {
            if ($season <= 0) continue;
            $eps = $airDates[$season];
            ksort($eps);
            foreach ($eps as $ep => $date) {
                if ($ep <= 0 || empty($date)) continue;
                $owner = null;
                foreach ($bounds as $i => $b) {
                    if ($date >= $b['from']) $owner = $i;
                }
                if ($owner === null) continue;
                $to = $bounds[$owner]['to'];
                if ($to !== null && $date > $to) continue;
                $assigned[] = ['season' => $season, 'ep' => (int)$ep, 'entry' => $owner];
            }
        }

        // MAL numbering inside each entry follows TMDB's order. A prologue "episode 0" (Mushoku
        // Tensei II) is not shifted in: AniSkip numbers episodes like the streaming sites, where it
        // stays separate, even though AniList counts it in the entry (checked against the files).
        $result = [];
        $rank = [];
        foreach ($assigned as $a) {
            $i = $a['entry'];
            $rank[$i] = ($rank[$i] ?? 0) + 1;
            $mal = $rank[$i];
            $season = $a['season'];
            if (!isset($result[$season])) $result[$season] = ['segments' => [], 'entry' => $i];
            $segments = &$result[$season]['segments'];
            $lastIdx = count($segments) - 1;
            $last = $lastIdx >= 0 ? $segments[$lastIdx] : null;
            if ($last && $last['entry'] === $i
                && $a['ep'] === $last['last'] + 1
                && $mal === $last['mal_first'] + ($a['ep'] - $last['first'])) {
                $segments[$lastIdx]['last'] = $a['ep'];
            } else {
                $segments[] = [
                    'entry' => $i,
                    'first' => $a['ep'],
                    'last' => $a['ep'],
                    'mal_id' => isset($chain[$i]['idMal']) ? (int)$chain[$i]['idMal'] : null,
                    'anilist_id' => (int)$chain[$i]['id'],
                    'mal_first' => $mal,
                    'mal_episodes' => isset($chain[$i]['episodes']) ? (int)$chain[$i]['episodes'] : null,
                ];
            }
            unset($segments);
        }
        foreach ($result as &$season) {
            foreach ($season['segments'] as &$segment) unset($segment['entry']);
        }
        return $result;
    }

    /**
     * MAL entry + episode of a library episode, from its season's segments. Episodes just outside
     * the mapped range (a prologue "episode 0", or one TMDB has not listed yet) extend the nearest
     * segment while the number stays valid for that MAL entry.
     */
    public static function malEpisode(array $segments, int $episode): ?array {
        if (empty($segments)) return null;
        $pick = null;
        foreach ($segments as $s) {
            if ($episode >= $s['first'] && $episode <= $s['last']) {
                $pick = $s;
                break;
            }
        }
        if ($pick === null) {
            $first = $segments[0];
            $last = $segments[count($segments) - 1];
            if ($episode < $first['first']) $pick = $first;
            else if ($episode > $last['last']) $pick = $last;
            else return null; // a gap between segments: unknown
        }
        $mal = (int)$pick['mal_first'] + ($episode - (int)$pick['first']);
        if ($mal < 1 || empty($pick['mal_id'])) return null;
        if (!empty($pick['mal_episodes']) && $mal > (int)$pick['mal_episodes']) return null;
        return ['mal_id' => (int)$pick['mal_id'], 'episode' => $mal];
    }

    private static function shiftDate(string $date, int $days): string {
        $ts = strtotime($date . ' 00:00:00 UTC');
        if ($ts === false) return $date;
        return gmdate('Y-m-d', $ts + $days * 86400);
    }

    /** Library folder of a show ("Anime/<folder>"), from where its episode files live. */
    private static function showFolder(array $show, array $episodes): ?array {
        $root = realpath(LIBRARY_DIR);
        if (!$root) return null;
        foreach ($episodes as $ep) {
            $real = !empty($ep['filepath']) ? realpath($ep['filepath']) : false;
            if (!$real || !str_starts_with($real, $root . DIRECTORY_SEPARATOR)) continue;
            $parts = explode('/', str_replace('\\', '/', substr($real, strlen($root) + 1)));
            if (count($parts) >= 3) {
                return ['abs' => $root . '/' . $parts[0] . '/' . $parts[1], 'url' => '/library/' . $parts[0] . '/' . $parts[1]];
            }
        }
        foreach (['Anime', 'Movies'] as $cat) {
            if (is_dir($root . '/' . $cat . '/' . $show['id'])) {
                return ['abs' => $root . '/' . $cat . '/' . $show['id'], 'url' => '/library/' . $cat . '/' . $show['id']];
            }
        }
        return null;
    }

    /** Season subfolder ("Season 02", "Temporada 2", "S2", "Specials") of a show, if any. */
    private static function seasonFolder(string $showDir, int $season): ?string {
        foreach (@scandir($showDir) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..' || !is_dir($showDir . '/' . $entry)) continue;
            $num = null;
            if (preg_match('/(?:Season|Temporada|Temp\.?)\s*(\d+)/i', $entry, $m)) $num = (int)$m[1];
            else if (preg_match('/^(?:S|T)(\d+)$/i', trim($entry), $m)) $num = (int)$m[1];
            else if (preg_match('/^(?:Specials|Especiales|OVAs?|SP)$/i', trim($entry))) $num = 0;
            if ($num === $season) return $showDir . '/' . $entry;
        }
        return null;
    }

    /**
     * Artwork of one season as a /library URL: a file the admin dropped in the season folder wins
     * (poster.jpg/folder.jpg, backdrop.jpg/fanart.jpg, as Jellyfin/Kodi name them), then the copy
     * downloaded earlier, then a fresh download.
     */
    private static function seasonImage(?array $folder, int $season, string $kind, array $remoteUrls, bool $force): string {
        if (!$folder) {
            foreach ($remoteUrls as $url) if (!empty($url)) return $url;
            return '';
        }
        $seasonDir = self::seasonFolder($folder['abs'], $season);
        if ($seasonDir) {
            $names = $kind === 'poster' ? ['poster', 'folder', 'cover'] : ['backdrop', 'fanart', 'banner'];
            foreach ($names as $name) {
                foreach (['jpg', 'jpeg', 'png', 'webp'] as $ext) {
                    $file = $seasonDir . '/' . $name . '.' . $ext;
                    if (is_file($file)) {
                        return $folder['url'] . '/' . basename($seasonDir) . '/' . $name . '.' . $ext . '?v=' . filemtime($file);
                    }
                }
            }
        }
        $fileName = "season_{$season}_{$kind}.jpg";
        $local = $folder['abs'] . '/' . $fileName;
        if (!$force && is_file($local) && filesize($local) > 0) {
            return $folder['url'] . '/' . $fileName . '?v=' . filemtime($local);
        }
        foreach ($remoteUrls as $url) {
            if (empty($url)) continue;
            if (TmdbScraper::downloadFile($url, $local, 15728640, self::ALLOWED_IMAGE_HOSTS)) {
                return $folder['url'] . '/' . $fileName . '?v=' . filemtime($local);
            }
        }
        if (is_file($local) && filesize($local) > 0) {
            return $folder['url'] . '/' . $fileName . '?v=' . filemtime($local);
        }
        foreach ($remoteUrls as $url) if (!empty($url)) return $url;
        return '';
    }

    private static function seasonStatus(array $segments, array $chain, ?string $lastAirDate): ?string {
        $statuses = [];
        foreach ($segments as $s) {
            foreach ($chain as $entry) {
                if ((int)$entry['id'] === (int)$s['anilist_id']) $statuses[] = $entry['status'] ?? '';
            }
        }
        if (in_array('RELEASING', $statuses, true)) return 'airing';
        if (!empty($statuses) && count(array_unique($statuses)) === 1 && $statuses[0] === 'NOT_YET_RELEASED') return 'upcoming';
        if (!empty($statuses)) return 'finished';
        if ($lastAirDate) {
            $days = (time() - strtotime($lastAirDate)) / 86400;
            if ($days < -1) return 'upcoming';
            return $days <= 35 ? 'airing' : 'finished';
        }
        return null;
    }

    /**
     * Refreshes the seasons of one show. Returns a summary; never throws for network problems.
     * Data that cannot be fetched now keeps its previous value.
     */
    public static function syncShow(string $showId, bool $force = false): array {
        $show = DbHelper::getShow($showId);
        if (!$show) return ['show_id' => $showId, 'error' => 'not_found'];
        if (($show['media_type'] ?? 'anime') === 'movie') return ['show_id' => $showId, 'skipped' => 'movie'];

        $episodes = DbHelper::getEpisodesForShow($showId);
        $librarySeasons = array_values(array_unique(array_map(fn($e) => (int)$e['season_number'], $episodes)));
        sort($librarySeasons);
        if (empty($librarySeasons)) return ['show_id' => $showId, 'skipped' => 'no_episodes'];

        $tmdbId = (int)($show['tmdb_id'] ?? 0);
        $tmdbSeasons = $tmdbId > 0 ? TmdbScraper::getSeasonList($tmdbId) : [];
        $seasonDetails = [];
        $airDates = [];
        foreach (array_keys($tmdbSeasons) as $num) {
            $detail = TmdbScraper::getSeasonDetail($tmdbId, (int)$num);
            if (!$detail) continue;
            $seasonDetails[$num] = $detail;
            if ($num > 0) $airDates[$num] = $detail['episodes'];
        }

        $chain = [];
        if (AnimeSources::isOnline()) {
            $aniListId = AnimeSources::findAniListId($tmdbId, (string)$show['title'], $show['year'] ?? null);
            if ($aniListId) $chain = AnimeSources::franchise($aniListId);
        }
        if (empty($tmdbSeasons) && empty($chain)) {
            // Offline (or unknown to both sources): saving now would mark the seasons as fresh.
            return ['show_id' => $showId, 'seasons' => [], 'franchise_entries' => 0, 'tmdb_seasons' => 0, 'online' => false];
        }
        $map = self::buildSeasonMap($airDates, $chain);
        $folder = self::showFolder($show, $episodes);

        $saved = [];
        foreach ($librarySeasons as $season) {
            $existing = DbHelper::getShowSeason($showId, $season) ?? [];
            $tmdb = $seasonDetails[$season] ?? ($tmdbSeasons[$season] ?? []);
            $mapping = $map[$season] ?? ['segments' => [], 'entry' => null];
            $entry = $mapping['entry'] !== null ? ($chain[$mapping['entry']] ?? null) : null;

            if (empty($tmdb) && $entry === null && !empty($existing)) {
                $saved[] = $season; // nothing new reachable: keep what we have
                continue;
            }

            $dates = array_filter($tmdb['episodes'] ?? []);
            $airDate = $tmdb['air_date'] ?? ($dates ? min($dates) : null);
            $year = $airDate ? (int)substr($airDate, 0, 4) : (int)($entry['startDate']['year'] ?? 0);
            $titles = $entry['title'] ?? [];
            $segments = $mapping['segments'];
            if (empty($segments) && !empty($existing['mal_map'])) {
                $segments = json_decode($existing['mal_map'], true) ?: [];
            }

            $poster = self::seasonImage($folder, $season, 'poster', [
                $tmdb['poster_path'] ?? ($tmdbSeasons[$season]['poster_path'] ?? ''),
                $entry['coverImage']['extraLarge'] ?? ($entry['coverImage']['large'] ?? ''),
            ], $force);
            $backdrop = self::seasonImage($folder, $season, 'backdrop', [
                $entry['bannerImage'] ?? '',
            ], $force);

            DbHelper::saveShowSeason([
                'show_id' => $showId,
                'season_number' => $season,
                'name' => $season === 0 ? 'Especiales' : (($tmdb['name'] ?? '') !== '' ? $tmdb['name'] : "Temporada {$season}"),
                // Romaji tells seasons apart ("Mushoku Tensei II", "NEW GAME!!"); English often just appends "Season 2".
                'title' => $season === 0 ? '' : (($titles['romaji'] ?? '') ?: (($titles['english'] ?? '') ?: ($existing['title'] ?? ''))),
                // Spanish only: without one the apps show the show's (Spanish) synopsis, which reads
                // better than an English one in a Spanish interface.
                'synopsis' => !empty($tmdb) ? ($tmdb['overview'] ?? '') : ($existing['synopsis'] ?? ''),
                'year' => $year > 0 ? $year : ($existing['year'] ?? null),
                'air_date' => $airDate ?: ($existing['air_date'] ?? null),
                'episode_count' => $tmdbSeasons[$season]['episode_count'] ?? ($existing['episode_count'] ?? null),
                'status' => $season === 0 ? null : (self::seasonStatus($mapping['segments'], $chain, $dates ? max($dates) : null) ?? ($existing['status'] ?? null)),
                'poster_path' => $poster !== '' ? $poster : ($existing['poster_path'] ?? ''),
                'backdrop_path' => $backdrop !== '' ? $backdrop : ($existing['backdrop_path'] ?? ''),
                'anilist_id' => $entry ? (int)$entry['id'] : ($existing['anilist_id'] ?? null),
                'mal_id' => $entry && !empty($entry['idMal']) ? (int)$entry['idMal'] : ($existing['mal_id'] ?? null),
                'mal_map' => $segments,
            ]);
            $saved[] = $season;
        }

        return [
            'show_id' => $showId,
            'seasons' => $saved,
            'franchise_entries' => count($chain),
            'tmdb_seasons' => count($tmdbSeasons),
            'online' => AnimeSources::isOnline(),
        ];
    }

    /**
     * Shows whose season data is missing or old: never synced, a library season without a row,
     * or synced more than $maxAgeDays ago (airing shows: one day).
     */
    public static function staleShowIds(int $maxAgeDays = 14): array {
        $ids = [];
        foreach (DbHelper::getShows('anime') as $show) {
            $episodes = DbHelper::getEpisodesForShow($show['id']);
            if (empty($episodes)) continue;
            $rows = [];
            foreach (DbHelper::getShowSeasons($show['id']) as $row) $rows[(int)$row['season_number']] = $row;
            $limit = ($show['status'] ?? '') === 'airing' ? 1 : $maxAgeDays;
            foreach ($episodes as $ep) {
                $row = $rows[(int)$ep['season_number']] ?? null;
                $age = $row && !empty($row['synced_at']) ? (time() - strtotime($row['synced_at'])) / 86400 : INF;
                if ($age > $limit) {
                    $ids[] = $show['id'];
                    break;
                }
            }
        }
        return $ids;
    }
}
