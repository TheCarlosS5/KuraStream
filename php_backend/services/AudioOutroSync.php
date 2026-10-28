<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/AudioIntroDetector.php';
require_once __DIR__ . '/AudioIntroSync.php';
require_once __DIR__ . '/IntroSync.php';
require_once __DIR__ . '/SeasonSync.php';

/**
 * The ending-credits counterpart of AudioIntroSync, on the last minutes of each episode (the
 * ending song repeats from episode to episode the way the opening does):
 *  1. Checks each AniSkip ending against the audio the episode shares with its neighbours and
 *     corrects it when it is off.
 *  2. Finds the ending of episodes AniSkip has nothing for, with a known ending of the same season
 *     as reference, else with the audio shared with neighbouring episodes.
 * Knowing where the song stops matters: a scene after it is what the players must not skip.
 * Sources written to outro_source: 'audio', 'aniskip_checked', 'none' (retried after a week).
 * Decodes up to TAIL_SECONDS of audio per episode: run it on a PC, not on the home server.
 */
class AudioOutroSync {
    private const TAIL_SECONDS = 480.0;
    private const AGREE_SECONDS = 3.0;
    private const CORRECT_SECONDS = 5.0;
    private const RETRY_DAYS = 7;

    /** Per episode: ['base' => second the fingerprint starts at, 'fp' => items] or null. */
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

    public static function hasOutro(array $ep): bool {
        return ($ep['outro_start'] ?? null) !== null && ($ep['outro_end'] ?? null) !== null
            && (float)$ep['outro_end'] > (float)$ep['outro_start'];
    }

    /** Episodes whose ending is still unknown and may be looked for (pure, unit-tested). */
    public static function wantsAudio(array $ep): bool {
        if (IntroSync::outroLocked($ep) || self::hasOutro($ep)) return false;
        $source = $ep['outro_source'] ?? null;
        if ($source === null || $source === 'aniskip_none') return true;
        if ($source === 'none' && !empty($ep['outro_checked_at'])) {
            return (time() - strtotime($ep['outro_checked_at'] . ' UTC')) / 86400 >= self::RETRY_DAYS;
        }
        return false;
    }

    /** First second of the analysed tail of an episode lasting $duration seconds. */
    public static function tailStart(float $duration): float {
        return max($duration * 0.5, $duration - self::TAIL_SECONDS);
    }

    private function timeLeft(): bool {
        return microtime(true) < $this->deadline;
    }

    private function tail(array $ep): ?array {
        $id = $ep['id'];
        if (!array_key_exists($id, $this->fp)) {
            $duration = (float)$ep['duration'];
            $base = self::tailStart($duration);
            $fp = (!empty($ep['filepath']) && is_file($ep['filepath']) && $duration > 300)
                ? AudioIntroDetector::fingerprint($ep['filepath'], $base, $duration - $base) : null;
            $this->fp[$id] = $fp ? ['base' => $base, 'fp' => $fp] : null;
        }
        return $this->fp[$id];
    }

    /** The ending of a known episode, cut out of its tail fingerprint. */
    private function needle(array $ep): ?array {
        $tail = $this->tail($ep);
        if (!$tail || !self::hasOutro($ep)) return null;
        $s = AudioIntroDetector::ITEM_SECONDS;
        $from = (int)floor(((float)$ep['outro_start'] - $tail['base']) / $s);
        $len = (int)floor(((float)$ep['outro_end'] - (float)$ep['outro_start']) / $s);
        if ($from < 0 || $from + $len > count($tail['fp']) || $len < 160) return null;
        return array_slice($tail['fp'], $from, $len);
    }

    private function locateWith(array $target, array $ref): ?array {
        $tail = $this->tail($target);
        $needle = $this->needle($ref);
        if (!$tail || !$needle) return null;
        $found = AudioIntroDetector::locate($tail['fp'], $needle);
        if (!$found) return null;
        $s = AudioIntroDetector::ITEM_SECONDS;
        return [
            'start' => $tail['base'] + ($found['offset'] + $found['first']) * $s,
            'end' => $tail['base'] + ($found['offset'] + $found['last'] + 1) * $s,
            'error' => $found['error'],
        ];
    }

    private static function save(array $ep, ?array $hit, string $source): void {
        $data = ['outro_source' => $source];
        if ($hit !== null) {
            $start = max(0, (int)floor($hit['start']));
            $end = min((int)round($hit['end']), (int)floor((float)$ep['duration']));
            if ($end <= $start) return;
            $data['outro_start'] = $start;
            $data['outro_end'] = $end;
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
            if ((float)($ep['duration'] ?? 0) <= 300) continue;
            $bySeason[(int)$ep['season_number']][] = $ep;
        }

        foreach ($bySeason as $season => $eps) {
            // Episodes of one MAL entry (one cour) usually share the ending song.
            $groupOf = function (array $ep) use ($segments, $season) {
                $mal = SeasonSync::malEpisode($segments[$season] ?? [], (int)$ep['episode_number']);
                return $mal ? 'mal' . $mal['mal_id'] : 'x';
            };
            usort($eps, fn($a, $b) => (int)$a['episode_number'] <=> (int)$b['episode_number']);

            // 1. Check AniSkip endings against the audio shared with neighbouring episodes.
            foreach ($eps as $k => $ep) {
                if (($ep['outro_source'] ?? '') !== 'aniskip' || !self::hasOutro($ep)) continue;
                if (!$this->timeLeft()) { $summary['timed_out'] = true; return $summary; }
                $shared = $this->sharedEnding($ep, $this->neighbours($eps, $k, $groupOf));
                if ($shared && abs($shared['start'] - (float)$ep['outro_start']) > self::CORRECT_SECONDS) {
                    self::save($ep, $shared, 'audio');
                    $eps[$k]['outro_start'] = (int)floor($shared['start']);
                    $eps[$k]['outro_end'] = (int)round($shared['end']);
                    $summary['corrected']++;
                } else {
                    self::save($ep, ['start' => $ep['outro_start'], 'end' => $ep['outro_end']], 'aniskip_checked');
                    $summary['checked']++;
                }
                $eps[$k]['outro_source'] = 'checked';
            }
            $references = array_values(array_filter($eps, fn($e) => self::hasOutro($e)));
            $lengths = array_map(fn($e) => (float)$e['outro_end'] - (float)$e['outro_start'], $references);
            sort($lengths);
            $typical = $lengths ? $lengths[intdiv(count($lengths), 2)] : 90.0;

            // 2. Episodes without an ending: references of their own group first, then the closest.
            $pending = [];
            foreach ($eps as $ep) {
                if (!self::wantsAudio($ep)) continue;
                if (!$this->timeLeft()) { $summary['timed_out'] = true; return $summary; }
                $own = $groupOf($ep);
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
                    self::save($ep, self::clampToEpisode(AudioIntroSync::fullLength($hit, $typical), $ep), 'audio');
                    $summary['found']++;
                } else {
                    $pending[] = $ep;
                }
            }

            // 3. No reference worked: audio shared with neighbouring episodes.
            $position = array_flip(array_column($eps, 'id'));
            foreach ($pending as $ep) {
                if (!$this->timeLeft()) { $summary['timed_out'] = true; return $summary; }
                $hit = $this->sharedEnding($ep, $this->neighbours($eps, $position[$ep['id']], $groupOf));
                if ($hit) {
                    self::save($ep, self::clampToEpisode(AudioIntroSync::fullLength($hit, $typical), $ep), 'audio');
                    $summary['found_unreferenced']++;
                } else {
                    self::save($ep, null, 'none');
                    $summary['none']++;
                }
            }
        }
        return $summary;
    }

    /** fullLength() can push a cut-short ending past the end of the file. */
    private static function clampToEpisode(array $hit, array $ep): array {
        $hit['end'] = min($hit['end'], (float)$ep['duration']);
        return $hit;
    }

    /** Other episodes to compare with: same MAL entry, then with a known ending, then closest. */
    private function neighbours(array $eps, int $index, callable $groupOf): array {
        $own = $groupOf($eps[$index]);
        $number = (int)$eps[$index]['episode_number'];
        $others = $eps;
        unset($others[$index]);
        usort($others, fn($a, $b) => ($groupOf($a) === $own ? 0 : 1) <=> ($groupOf($b) === $own ? 0 : 1)
            ?: (self::hasOutro($a) ? 0 : 1) <=> (self::hasOutro($b) ? 0 : 1)
            ?: abs((int)$a['episode_number'] - $number) <=> abs((int)$b['episode_number'] - $number));
        return array_slice($others, 0, 6);
    }

    /**
     * Ending of $ep as the long stretch of audio its tail shares with other episodes. Accepted when
     * two episodes put it at the same place, or one does with a long, clean match.
     */
    private function sharedEnding(array $ep, array $others): ?array {
        $tail = $this->tail($ep);
        if (!$tail) return null;
        $s = AudioIntroDetector::ITEM_SECONDS;
        $found = [];
        foreach ($others as $other) {
            if (count($found) >= 2) break;
            $otherTail = $this->tail($other);
            if (!$otherTail) continue;
            $r = AudioIntroDetector::commonSegment($tail['fp'], $otherTail['fp'], 60, 150);
            if ($r) $found[] = ['start' => $tail['base'] + $r['a'] * $s, 'end' => $tail['base'] + ($r['a'] + $r['length']) * $s, 'error' => $r['error']];
        }
        if (count($found) === 2 && abs($found[0]['start'] - $found[1]['start']) <= self::AGREE_SECONDS) {
            return $found[0]['error'] <= $found[1]['error'] ? $found[0] : $found[1];
        }
        usort($found, fn($a, $b) => $a['error'] <=> $b['error']);
        $f = $found[0] ?? null;
        return ($f && $f['end'] - $f['start'] >= 70 && $f['error'] < 0.10) ? $f : null;
    }
}
