<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/AudioIntroDetector.php';
require_once __DIR__ . '/SeasonSync.php';

/**
 * Second pass after AniSkip, working only on the files (no internet needed):
 *  1. Checks each AniSkip opening against the audio the episode shares with its neighbours (the
 *     opening is the long stretch of identical audio at the start of consecutive episodes). A
 *     submission made on another cut of the episode can be 10-17 s off (seen on Mushoku Tensei
 *     S1E8, New Game!! E4, Grand Blue E11); those are corrected.
 *  2. Finds the opening of episodes AniSkip has nothing for with a known opening of the same
 *     season as reference.
 *  3. With no reference that works, uses the audio shared with neighbouring episodes.
 * Sources written: 'audio' (found/corrected here), 'aniskip_checked' (AniSkip confirmed or not
 * checkable), 'none' (nothing found; retried after a week).
 */
class AudioIntroSync {
    private const AGREE_SECONDS = 3.0;
    private const CORRECT_SECONDS = 5.0;
    private const RETRY_DAYS = 7;
    private const TRUSTED = ['manual', 'chapters'];

    private array $fp = [];
    private float $deadline;

    private function __construct(float $deadline) {
        $this->deadline = $deadline;
    }

    /** Runs the pass for one show; stops starting new work after $budgetSeconds. */
    public static function syncShow(string $showId, int $budgetSeconds = 1800): array {
        $self = new self(microtime(true) + $budgetSeconds);
        return $self->run($showId);
    }

    private function timeLeft(): bool {
        return microtime(true) < $this->deadline;
    }

    private static function isTrusted(array $ep): bool {
        $source = $ep['intro_source'] ?? null;
        return in_array($source, self::TRUSTED, true) || ($source === null && $ep['intro_start'] !== null);
    }

    private static function hasIntro(array $ep): bool {
        return $ep['intro_start'] !== null && $ep['intro_end'] !== null && (float)$ep['intro_end'] > (float)$ep['intro_start'];
    }

    private static function wantsAudio(array $ep): bool {
        if (self::hasIntro($ep)) return false;
        $source = $ep['intro_source'] ?? null;
        if ($source === null || $source === 'aniskip_none') return true;
        if ($source === 'none' && !empty($ep['intro_checked_at'])) {
            return (time() - strtotime($ep['intro_checked_at'] . ' UTC')) / 86400 >= self::RETRY_DAYS;
        }
        return false;
    }

    /** Fingerprint of the first minutes of an episode (cached per run). */
    private function hay(array $ep): ?array {
        $id = $ep['id'];
        if (!array_key_exists($id, $this->fp)) {
            $len = min(600.0, max(0.0, (float)$ep['duration'] - 60));
            $this->fp[$id] = (!empty($ep['filepath']) && is_file($ep['filepath']) && $len > 60)
                ? AudioIntroDetector::fingerprint($ep['filepath'], 0, $len) : null;
        }
        return $this->fp[$id];
    }

    /** The opening of a known episode, cut out of its cached fingerprint. */
    private function needle(array $ep): ?array {
        $hay = $this->hay($ep);
        if (!$hay || !self::hasIntro($ep)) return null;
        $from = (int)floor((float)$ep['intro_start'] / AudioIntroDetector::ITEM_SECONDS);
        $len = (int)floor(((float)$ep['intro_end'] - (float)$ep['intro_start']) / AudioIntroDetector::ITEM_SECONDS);
        if ($from + $len > count($hay) || $len < 160) return null;
        return array_slice($hay, $from, $len);
    }

    /** Opening of $target located with $ref's opening: ['start', 'end', 'error'] or null. */
    private function locateWith(array $target, array $ref): ?array {
        $hay = $this->hay($target);
        $needle = $this->needle($ref);
        if (!$hay || !$needle) return null;
        $found = AudioIntroDetector::locate($hay, $needle);
        if (!$found) return null;
        $s = AudioIntroDetector::ITEM_SECONDS;
        return [
            'start' => ($found['offset'] + $found['first']) * $s,
            'end' => ($found['offset'] + $found['last'] + 1) * $s,
            'error' => $found['error'],
        ];
    }

    private static function save(array $ep, ?array $hit, string $source): void {
        $data = ['intro_source' => $source];
        if ($hit !== null) {
            $start = max(0, (int)round($hit['start']));
            $end = (int)round($hit['end']);
            if ((float)$ep['duration'] > 0) $end = min($end, (int)floor((float)$ep['duration']));
            if ($end <= $start) return;
            $data['intro_start'] = $start;
            $data['intro_end'] = $end;
        }
        DbHelper::saveEpisodeTimestamps($ep['id'], $data);
    }

    private function run(string $showId): array {
        $summary = ['show_id' => $showId, 'checked' => 0, 'corrected' => 0, 'found' => 0, 'found_unreferenced' => 0, 'none' => 0, 'timed_out' => false];
        if (!FfmpegScanner::getFfmpegPath()) return $summary + ['error' => 'ffmpeg'];

        $segments = [];
        foreach (DbHelper::getShowSeasons($showId) as $row) {
            $segments[(int)$row['season_number']] = json_decode($row['mal_map'] ?? '[]', true) ?: [];
        }
        $bySeason = [];
        foreach (DbHelper::getEpisodesForShow($showId) as $ep) {
            if ((float)($ep['duration'] ?? 0) <= 120) continue;
            $bySeason[(int)$ep['season_number']][] = $ep;
        }

        foreach ($bySeason as $season => $eps) {
            // Episodes sharing a MAL entry share an opening; unmapped ones are their own group.
            $groupOf = function (array $ep) use ($segments, $season) {
                $mal = SeasonSync::malEpisode($segments[$season] ?? [], (int)$ep['episode_number']);
                return $mal ? 'mal' . $mal['mal_id'] : 'x';
            };
            usort($eps, fn($a, $b) => (int)$a['episode_number'] <=> (int)$b['episode_number']);

            // 1. Check AniSkip openings against the audio shared with neighbouring episodes.
            foreach ($eps as $k => $ep) {
                if (($ep['intro_source'] ?? '') !== 'aniskip' || !self::hasIntro($ep)) continue;
                if (!$this->timeLeft()) { $summary['timed_out'] = true; return $summary; }
                $shared = $this->sharedOpening($ep, $this->neighbours($eps, $k, $groupOf));
                if ($shared && abs($shared['start'] - (float)$ep['intro_start']) > self::CORRECT_SECONDS) {
                    self::save($ep, $shared, 'audio');
                    $eps[$k]['intro_start'] = (int)round($shared['start']);
                    $eps[$k]['intro_end'] = (int)round($shared['end']);
                    $summary['corrected']++;
                } else {
                    self::save($ep, ['start' => $ep['intro_start'], 'end' => $ep['intro_end']], 'aniskip_checked');
                    $summary['checked']++;
                }
                $eps[$k]['intro_source'] = 'checked';
            }
            $references = array_values(array_filter($eps, fn($e) => self::hasIntro($e)));
            // Typical opening length of the season (openings run ~90 s).
            $lengths = array_map(fn($e) => (float)$e['intro_end'] - (float)$e['intro_start'], $references);
            sort($lengths);
            $typical = $lengths ? $lengths[intdiv(count($lengths), 2)] : 90.0;

            // 2. Episodes without an opening: references of their own group first, then the rest.
            $pending = [];
            foreach ($eps as $ep) {
                if (!self::wantsAudio($ep)) continue;
                if (!$this->timeLeft()) { $summary['timed_out'] = true; return $summary; }
                $own = $groupOf($ep);
                // Same MAL entry first (same opening song), then the closest episodes.
                $ordered = $references;
                usort($ordered, fn($a, $b) => ($groupOf($a) === $own ? 0 : 1) <=> ($groupOf($b) === $own ? 0 : 1)
                    ?: abs((int)$a['episode_number'] - (int)$ep['episode_number']) <=> abs((int)$b['episode_number'] - (int)$ep['episode_number']));
                $hit = null;
                foreach (array_slice($ordered, 0, 4) as $ref) {
                    $try = $this->locateWith($ep, $ref);
                    if ($try && ($hit === null || $try['error'] < $hit['error'])) $hit = $try;
                    if ($hit && $hit['error'] < 0.12) break;
                }
                if ($hit) {
                    self::save($ep, self::fullLength($hit, $typical), 'audio');
                    $summary['found']++;
                } else {
                    $pending[] = $ep;
                }
            }

            // 3. No reference worked: audio shared with neighbouring episodes.
            $position = array_flip(array_column($eps, 'id'));
            foreach ($pending as $ep) {
                if (!$this->timeLeft()) { $summary['timed_out'] = true; return $summary; }
                $hit = $this->sharedOpening($ep, $this->neighbours($eps, $position[$ep['id']], $groupOf));
                if ($hit) {
                    self::save($ep, self::fullLength($hit, $typical), 'audio');
                    $summary['found_unreferenced']++;
                } else {
                    self::save($ep, null, 'none');
                    $summary['none']++;
                }
            }
        }
        return $summary;
    }

    /**
     * A match much shorter than the season's openings found where the opening starts, but the
     * song changes later on (a variant): the end is the usual length after that start.
     */
    public static function fullLength(array $hit, float $typical): array {
        if ($typical > 0 && $hit['end'] - $hit['start'] < $typical * 0.8) {
            $hit['end'] = $hit['start'] + $typical;
        }
        return $hit;
    }

    /**
     * Other episodes of the season to compare with: same MAL entry first (same opening song), then
     * those with a known opening (an episode without one shares nothing), then the closest.
     */
    private function neighbours(array $eps, int $index, callable $groupOf): array {
        $own = $groupOf($eps[$index]);
        $number = (int)$eps[$index]['episode_number'];
        $others = $eps;
        unset($others[$index]);
        usort($others, fn($a, $b) => ($groupOf($a) === $own ? 0 : 1) <=> ($groupOf($b) === $own ? 0 : 1)
            ?: (self::hasIntro($a) ? 0 : 1) <=> (self::hasIntro($b) ? 0 : 1)
            ?: abs((int)$a['episode_number'] - $number) <=> abs((int)$b['episode_number'] - $number));
        return array_slice($others, 0, 6);
    }

    /**
     * Opening of $ep as the long stretch of audio it shares with other episodes. Accepted when two
     * episodes put it at the same place, or one does with a long, clean match.
     */
    private function sharedOpening(array $ep, array $others): ?array {
        $hay = $this->hay($ep);
        if (!$hay) return null;
        $s = AudioIntroDetector::ITEM_SECONDS;
        $found = [];
        foreach ($others as $other) {
            if (count($found) >= 2) break;
            $otherHay = $this->hay($other);
            if (!$otherHay) continue;
            $r = AudioIntroDetector::commonSegment($hay, $otherHay, 60, 150);
            if ($r) $found[] = ['start' => $r['a'] * $s, 'end' => ($r['a'] + $r['length']) * $s, 'error' => $r['error']];
        }
        if (count($found) === 2 && abs($found[0]['start'] - $found[1]['start']) <= self::AGREE_SECONDS) {
            return $found[0]['error'] <= $found[1]['error'] ? $found[0] : $found[1];
        }
        usort($found, fn($a, $b) => $a['error'] <=> $b['error']);
        $f = $found[0] ?? null;
        return ($f && $f['end'] - $f['start'] >= 70 && $f['error'] < 0.10) ? $f : null;
    }
}
