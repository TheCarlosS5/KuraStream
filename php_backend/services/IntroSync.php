<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/AnimeSources.php';
require_once __DIR__ . '/SeasonSync.php';

/**
 * Fills the opening (intro_start/intro_end) and the ending credits (outro_start/outro_end) from
 * AniSkip, each with its own source column, so an opening the audio pass corrected does not stop
 * the ending from being filled. Timings an admin set, or that came from the file's own chapters,
 * are never touched. Episodes AniSkip has nothing for are asked again after RETRY_DAYS, since the
 * community keeps adding submissions. One request per episode answers both.
 */
class IntroSync {
    private const RETRY_DAYS = 7;
    private const PROTECTED_SOURCES = ['manual', 'chapters'];
    /** Sources whose ending mark this sync (or the audio pass) wrote, so it may replace it. */
    private const OWN_SOURCES = ['aniskip', 'aniskip_checked', 'aniskip_none', 'none', 'audio'];

    /** Opening set by an admin or the file's chapters: no automatic pass may replace it. */
    public static function introLocked(array $ep): bool {
        $source = $ep['intro_source'] ?? null;
        if (in_array($source, self::PROTECTED_SOURCES, true)) return true;
        // Timings from before sources were recorded were set by an admin.
        return $source === null && isset($ep['intro_start']) && $ep['intro_start'] !== null;
    }

    /** Ending set by an admin or the file's chapters (same rule, with the older shared source). */
    public static function outroLocked(array $ep): bool {
        $source = $ep['outro_source'] ?? null;
        if ($source !== null) return in_array($source, self::PROTECTED_SOURCES, true);
        // Before endings had their own source they followed the opening's.
        $introSource = $ep['intro_source'] ?? null;
        $hasOutro = isset($ep['outro_start']) && $ep['outro_start'] !== null;
        if (in_array($introSource, self::PROTECTED_SOURCES, true)) return $hasOutro;
        return $introSource === null && ($hasOutro || (isset($ep['intro_start']) && $ep['intro_start'] !== null));
    }

    /** Whether this episode's opening should be (re)looked up. */
    public static function needsLookup(array $ep, bool $force = false): bool {
        $source = $ep['intro_source'] ?? null;
        if (self::introLocked($ep)) return false;
        // Found by the audio pass (AudioIntroSync), which is more exact than a mismatched submission.
        if ($source === 'audio') return false;
        if ($source === 'aniskip' || $source === 'aniskip_checked') return $force;
        return $force || self::retryDue($source, $ep['intro_checked_at'] ?? null);
    }

    /** Whether this episode's ending credits should be (re)looked up. */
    public static function needsOutroLookup(array $ep, bool $force = false): bool {
        $source = $ep['outro_source'] ?? null;
        if (self::outroLocked($ep)) return false;
        if ($source === null) return true;
        if ($source === 'audio') return false;
        if ($source === 'aniskip' || $source === 'aniskip_checked') return $force;
        return $force || self::retryDue($source, $ep['outro_checked_at'] ?? null);
    }

    private static function retryDue(?string $source, ?string $checkedAt): bool {
        if (in_array($source, ['aniskip_none', 'none'], true) && !empty($checkedAt)) {
            return (time() - strtotime($checkedAt . ' UTC')) / 86400 >= self::RETRY_DAYS;
        }
        return true;
    }

    /** AniSkip opening => opening columns to store (pure, unit-tested). */
    public static function timingsFromSkip(array $ep, array $skip): array {
        $duration = (float)($ep['duration'] ?? 0);
        $data = [];
        $op = $skip['op'] ?? null;
        if ($op) {
            $start = max(0, (int)round($op[0]));
            $end = (int)round($op[1]);
            if ($duration > 0) $end = min($end, (int)floor($duration));
            if ($end > $start) {
                $data['intro_start'] = $start;
                $data['intro_end'] = $end;
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

    /** AniSkip ending => ending columns to store (pure, unit-tested). */
    public static function outroTimingsFromSkip(array $ep, array $skip): array {
        $duration = (float)($ep['duration'] ?? 0);
        $ed = $skip['ed'] ?? null;
        // An "ending" in the first half is a bad submission (seen: 4-95 s); the players would
        // treat the whole episode as credits.
        if ($ed && ($duration <= 0 || $ed[0] >= $duration * 0.5)) {
            $start = max(0, (int)floor($ed[0]));
            $end = (int)round($ed[1]);
            if ($duration > 0) $end = min($end, (int)floor($duration));
            if ($end > $start) return ['outro_start' => $start, 'outro_end' => $end, 'outro_source' => 'aniskip'];
        }
        $data = ['outro_source' => 'aniskip_none'];
        $source = $ep['outro_source'] ?? null;
        $ours = $source !== null ? in_array($source, ['aniskip', 'aniskip_checked', 'aniskip_none', 'none'], true)
            : in_array($ep['intro_source'] ?? null, self::OWN_SOURCES, true);
        if ($ours) {
            // A mark this sync stored before (or a bad one) goes away with the submission.
            $data['outro_start'] = null;
            $data['outro_end'] = null;
        }
        return $data;
    }

    /**
     * Looks up the episodes of one show. Returns counts:
     * found / missing (opening stored / AniSkip has none yet), outros_found / outros_missing (same
     * for the ending), unmapped (no MAL episode known), skipped (already done or protected),
     * offline (stopped because AniSkip was unreachable).
     */
    public static function syncShow(string $showId, bool $force = false): array {
        $summary = ['show_id' => $showId, 'found' => 0, 'missing' => 0, 'outros_found' => 0, 'outros_missing' => 0,
            'unmapped' => 0, 'skipped' => 0, 'offline' => false];
        $segmentsBySeason = [];
        foreach (DbHelper::getShowSeasons($showId) as $row) {
            $segmentsBySeason[(int)$row['season_number']] = json_decode($row['mal_map'] ?? '[]', true) ?: [];
        }

        foreach (DbHelper::getEpisodesForShow($showId) as $ep) {
            $season = (int)$ep['season_number'];
            $wantIntro = self::needsLookup($ep, $force);
            $wantOutro = self::needsOutroLookup($ep, $force);
            if ($season <= 0 || (float)($ep['duration'] ?? 0) <= 0 || (!$wantIntro && !$wantOutro)) {
                $summary['skipped']++;
                continue;
            }
            $target = SeasonSync::malEpisode($segmentsBySeason[$season] ?? [], (int)$ep['episode_number']);
            if ($target === null) {
                $data = [];
                if ($wantIntro) $data['intro_source'] = 'aniskip_none';
                if ($wantOutro) $data['outro_source'] = 'aniskip_none';
                DbHelper::saveEpisodeTimestamps($ep['id'], $data);
                $summary['unmapped']++;
                continue;
            }
            $skip = AnimeSources::skipTimes($target['mal_id'], $target['episode'], (float)$ep['duration']);
            if ($skip === null) {
                $summary['offline'] = true;
                break;
            }
            $data = [];
            if ($wantIntro) {
                $data = self::timingsFromSkip($ep, $skip);
                $summary[$data['intro_source'] === 'aniskip' ? 'found' : 'missing']++;
            }
            if ($wantOutro) {
                $outro = self::outroTimingsFromSkip($ep, $skip);
                $data += $outro;
                $summary[$outro['outro_source'] === 'aniskip' ? 'outros_found' : 'outros_missing']++;
            }
            DbHelper::saveEpisodeTimestamps($ep['id'], $data);
            usleep(150000);
        }
        return $summary;
    }
}
