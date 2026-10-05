<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/AnimeSources.php';
require_once __DIR__ . '/SeasonSync.php';

/**
 * Fills intro_start/intro_end (and outro_start when missing) from AniSkip. Timings an admin set,
 * or that came from the file's own chapters, are never touched. Episodes AniSkip has nothing for
 * are asked again after RETRY_DAYS, since the community keeps adding submissions.
 */
class IntroSync {
    private const RETRY_DAYS = 7;
    private const PROTECTED_SOURCES = ['manual', 'chapters'];

    /** Whether this episode should be (re)looked up. */
    public static function needsLookup(array $ep, bool $force = false): bool {
        $source = $ep['intro_source'] ?? null;
        if (in_array($source, self::PROTECTED_SOURCES, true)) return false;
        // Timings from before sources were recorded were set by an admin.
        if ($source === null && isset($ep['intro_start']) && $ep['intro_start'] !== null) return false;
        // Found by the audio pass (AudioIntroSync), which is more exact than a mismatched submission.
        if ($source === 'audio') return false;
        if ($source === 'aniskip' || $source === 'aniskip_checked') return $force;
        if ($force) return true;
        if (in_array($source, ['aniskip_none', 'none'], true) && !empty($ep['intro_checked_at'])) {
            return (time() - strtotime($ep['intro_checked_at'])) / 86400 >= self::RETRY_DAYS;
        }
        return true;
    }

    /** AniSkip result => columns to store (pure, unit-tested). */
    public static function timingsFromSkip(array $ep, array $skip): array {
        $duration = (float)($ep['duration'] ?? 0);
        $data = [];
        $op = $skip['op'] ?? null;
        $ed = $skip['ed'] ?? null;
        if ($op) {
            $start = max(0, (int)round($op[0]));
            $end = (int)round($op[1]);
            if ($duration > 0) $end = min($end, (int)floor($duration));
            if ($end > $start) {
                $data['intro_start'] = $start;
                $data['intro_end'] = $end;
            }
        }
        $outroIsOurs = in_array($ep['intro_source'] ?? null, ['aniskip', 'aniskip_checked', 'aniskip_none', 'none', 'audio'], true);
        if (($ep['outro_start'] ?? null) === null || $outroIsOurs) {
            // An "ending" in the first half is a bad submission (seen: 4-95 s); the players would
            // treat the whole episode as credits.
            if ($ed && ($duration <= 0 || $ed[0] >= $duration * 0.5)) {
                $data['outro_start'] = max(0, (int)floor($ed[0]));
                $data['outro_end'] = (int)round($ed[1]);
                if ($duration > 0) $data['outro_end'] = min($data['outro_end'], (int)floor($duration));
            } else if ($ed && $outroIsOurs) {
                $data['outro_start'] = null;
                $data['outro_end'] = null;
            }
        }
        $data['intro_source'] = isset($data['intro_start']) ? 'aniskip' : 'aniskip_none';
        if (!isset($data['intro_start']) && in_array($ep['intro_source'] ?? null, ['aniskip', 'aniskip_checked'], true)) {
            // A forced re-check that no longer finds the opening clears the one it stored before.
            $data['intro_start'] = null;
            $data['intro_end'] = null;
        }
        return $data;
    }

    /**
     * Looks up the episodes of one show. Returns counts:
     * found (opening stored), missing (AniSkip has none yet), unmapped (no MAL episode known),
     * skipped (already done or protected), offline (stopped because AniSkip was unreachable).
     */
    public static function syncShow(string $showId, bool $force = false): array {
        $summary = ['show_id' => $showId, 'found' => 0, 'missing' => 0, 'unmapped' => 0, 'skipped' => 0, 'offline' => false];
        $segmentsBySeason = [];
        foreach (DbHelper::getShowSeasons($showId) as $row) {
            $segmentsBySeason[(int)$row['season_number']] = json_decode($row['mal_map'] ?? '[]', true) ?: [];
        }

        foreach (DbHelper::getEpisodesForShow($showId) as $ep) {
            $season = (int)$ep['season_number'];
            if ($season <= 0 || (float)($ep['duration'] ?? 0) <= 0 || !self::needsLookup($ep, $force)) {
                $summary['skipped']++;
                continue;
            }
            $target = SeasonSync::malEpisode($segmentsBySeason[$season] ?? [], (int)$ep['episode_number']);
            if ($target === null) {
                DbHelper::saveEpisodeTimestamps($ep['id'], ['intro_source' => 'aniskip_none']);
                $summary['unmapped']++;
                continue;
            }
            $skip = AnimeSources::skipTimes($target['mal_id'], $target['episode'], (float)$ep['duration']);
            if ($skip === null) {
                $summary['offline'] = true;
                break;
            }
            $data = self::timingsFromSkip($ep, $skip);
            DbHelper::saveEpisodeTimestamps($ep['id'], $data);
            $summary[$data['intro_source'] === 'aniskip' ? 'found' : 'missing']++;
            usleep(150000);
        }
        return $summary;
    }
}
