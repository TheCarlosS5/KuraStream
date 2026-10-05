<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/controllers/HistoryController.php';

echo "Running Continue Watching Tests...\n";

function ep(string $show, int $season, int $number, float $duration = 1440.0): array {
    return [
        'id' => "{$show}_S{$season}_E{$number}", 'show_id' => $show, 'season_number' => $season,
        'episode_number' => $number, 'title' => "Ep {$number}", 'thumbnail_path' => '', 'duration' => $duration,
    ];
}

function hist(array $episode, float $progress, string $updatedAt, bool $completed = false): array {
    return [
        'episode_id' => $episode['id'], 'show_id' => $episode['show_id'], 'season_number' => $episode['season_number'],
        'episode_number' => $episode['episode_number'], 'episode_title' => $episode['title'], 'thumbnail_path' => '',
        'progress_seconds' => $progress, 'duration' => $episode['duration'], 'ep_duration' => $episode['duration'],
        'completed' => $completed ? 1 : 0, 'updated_at' => $updatedAt, 'outro_start' => null,
        'show_title' => $episode['show_id'], 'poster_path' => '', 'backdrop_path' => '', 'media_type' => 'anime',
    ];
}

$episodes = [];
for ($i = 1; $i <= 12; $i++) $episodes[] = ep('Frieren', 1, $i);
$episodes[] = ep('Frieren', 0, 1);
$loader = function (array $showIds) use ($episodes) {
    return array_values(array_filter($episodes, fn($e) => in_array($e['show_id'], $showIds, true)));
};

// The reported bug: episode 9 left half-watched, then 10-12 finished -> the series must disappear.
$rows = [];
for ($i = 1; $i <= 12; $i++) {
    $rows[] = hist($episodes[$i - 1], $i === 9 ? 700.0 : 1440.0, sprintf('2026-10-03 20:%02d:00', $i), $i !== 9);
}
$result = HistoryController::buildContinueWatching($rows, $loader);
assert($result === [], 'A series watched to its last episode must leave "Continuar viendo" (specials do not count)');

// Mid-series and finished the episode -> the next one, flagged as up next.
$rows = [hist($episodes[0], 1440.0, '2026-10-03 20:00:00', true), hist($episodes[1], 1400.0, '2026-10-03 20:30:00', false)];
$result = HistoryController::buildContinueWatching($rows, $loader);
assert(count($result) === 1 && $result[0]['episode_id'] === 'Frieren_S1_E3', 'Finishing episode 2 (credits) must suggest episode 3');
assert($result[0]['up_next'] === true && $result[0]['progress_seconds'] === 0.0, 'Next episode starts from zero');

// Mid-episode -> that episode with its progress.
$rows[] = hist($episodes[2], 300.0, '2026-10-03 21:00:00');
$result = HistoryController::buildContinueWatching($rows, $loader);
assert($result[0]['episode_id'] === 'Frieren_S1_E3' && $result[0]['progress_seconds'] === 300.0 && $result[0]['up_next'] === false, 'In-progress episode resumes');

// Same-second tie between auto-advanced episodes: the later episode wins.
$rows = [hist($episodes[4], 1440.0, '2026-10-03 22:00:00', true), hist($episodes[5], 15.0, '2026-10-03 22:00:00')];
$result = HistoryController::buildContinueWatching($rows, $loader);
assert($result[0]['episode_id'] === 'Frieren_S1_E6', 'Tie on updated_at resolves to the later episode');

// Outro mark counts as finished even before 90 %.
$row = hist($episodes[0], 1300.0, '2026-10-03 20:00:00');
$row['outro_start'] = 1290;
assert(HistoryController::isFinishedWatching($row) === true, 'Reaching the credits marks the episode as watched');
assert(HistoryController::isFinishedWatching(hist($episodes[0], 600.0, 'x')) === false, 'Half an episode is not finished');

// Ordering: specials after every regular season.
$ordered = HistoryController::orderEpisodes([ep('X', 0, 1), ep('X', 2, 1), ep('X', 1, 2), ep('X', 1, 1)]);
assert(array_column($ordered, 'id') === ['X_S1_E1', 'X_S1_E2', 'X_S2_E1', 'X_S0_E1'], 'Specials sort last');

echo "✓ Continue watching tests passed\n";
