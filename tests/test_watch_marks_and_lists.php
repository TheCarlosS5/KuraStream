<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/HistoryController.php';

echo "Running watched marks and list status tests...\n";

function wm_call(callable $fn): array {
    ob_start();
    try { $fn(); } catch (ExitException $e) { ob_end_clean(); return [$e->statusCode, is_array($e->data) ? $e->data : []]; }
    ob_end_clean();
    return [null, []];
}

$db = Database::getConnection();
$sfx = bin2hex(random_bytes(3));
$user = "wm_user_$sfx";
$show = "wm_show_$sfx";
DbHelper::registerUser($user, 'wm_password_1');
$profile = DbHelper::getUserProfiles($user)[0];
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . AuthMiddleware::createToken([
    'username' => $user, 'role' => 'user', 'profile_id' => $profile['id'], 'profile_name' => $profile['name'], 'is_kids' => 0, 'exp' => time() + 600,
]);
AuthMiddleware::$strictAccounts = true;

try {
    DbHelper::saveShow(['id' => $show, 'title' => 'WM', 'synopsis' => 's', 'rating' => 7, 'year' => 2026]);
    foreach ([[1, 1], [1, 2], [2, 1]] as [$s, $e]) {
        DbHelper::saveEpisode(['id' => "{$show}_s{$s}e{$e}", 'show_id' => $show, 'season_number' => $s, 'episode_number' => $e,
            'title' => "E$e", 'filepath' => "/media/$show/$s$e.mp4", 'duration' => 1200.0]);
    }
    $hist = function () use ($db, $user, $profile) {
        $st = $db->prepare("SELECT episode_id, completed, progress_seconds FROM watch_history WHERE username = :u AND profile_name = :p");
        $st->execute(['u' => $user, 'p' => $profile['name']]);
        return array_column($st->fetchAll(), null, 'episode_id');
    };

    // Single episode watched, then a partially watched one becomes finished
    DbHelper::saveProgress($user, $profile['name'], "{$show}_s1e2", 300.0, 1200.0);
    [$code, $body] = wm_call(fn() => HistoryController::markWatched(['episode_ids' => ["{$show}_s1e1", "{$show}_s1e2", 'nope_missing'], 'watched' => true]));
    assert($code === 200 && $body['count'] === 2, 'Unknown episode ids are ignored, known ones counted');
    $h = $hist();
    assert((int)$h["{$show}_s1e1"]['completed'] === 1 && (float)$h["{$show}_s1e1"]['progress_seconds'] === 1200.0, 'Marked episode is finished at its duration');
    assert((int)$h["{$show}_s1e2"]['completed'] === 1 && (float)$h["{$show}_s1e2"]['progress_seconds'] === 1200.0, 'Partial progress is completed');

    // Unwatch one (completed must go back to 0 / row removed)
    [$code] = wm_call(fn() => HistoryController::markWatched(['episode_ids' => ["{$show}_s1e1"], 'watched' => false]));
    assert($code === 200 && !isset($hist()["{$show}_s1e1"]), 'Unwatching removes the history row');
    echo "✓ Episode marks OK\n";

    // Whole season / whole show
    [$code, $body] = wm_call(fn() => HistoryController::markWatched(['show_id' => $show, 'season' => 2]));
    assert($code === 200 && $body['count'] === 1 && isset($hist()["{$show}_s2e1"]), 'Season 2 is marked');
    [$code, $body] = wm_call(fn() => HistoryController::markWatched(['show_id' => $show]));
    assert($body['count'] === 3 && count($hist()) === 3, 'The whole show is marked');
    [$code, $body] = wm_call(fn() => HistoryController::markWatched(['show_id' => $show, 'watched' => false]));
    assert($body['count'] === 3 && count($hist()) === 0, 'The whole show is unmarked');
    [$code] = wm_call(fn() => HistoryController::markWatched(['episode_ids' => 'x']));
    assert($code === 400, 'episode_ids must be a list');
    [$code] = wm_call(fn() => HistoryController::markWatched([]));
    assert($code === 400, 'Something to mark is required');
    [$code] = wm_call(fn() => HistoryController::markWatched(['show_id' => $show, 'watched' => 'maybe']));
    assert($code === 400, 'watched must be a boolean');
    echo "✓ Season / show marks OK\n";

    // List status
    [$code] = wm_call(fn() => HistoryController::setListStatus(['show_id' => $show, 'status' => 'watching']));
    assert($code === 200, 'Setting a status works');
    [, $body] = wm_call(fn() => HistoryController::getListStatuses());
    assert(((array)$body['statuses'])[$show] === 'watching', 'The status is listed');
    [$code] = wm_call(fn() => HistoryController::setListStatus(['show_id' => $show, 'status' => 'bogus']));
    assert($code === 400, 'Unknown status is refused');
    [$code] = wm_call(fn() => HistoryController::setListStatus(['show_id' => 'no_such_show_x', 'status' => 'planned']));
    assert($code === 404, 'Unknown show is a 404');
    [$code] = wm_call(fn() => HistoryController::setListStatus(['show_id' => $show, 'status' => '']));
    [, $body] = wm_call(fn() => HistoryController::getListStatuses());
    assert($code === 200 && !isset(((array)$body['statuses'])[$show]), 'An empty status clears it');
    echo "✓ List status OK\n";

    // Renaming a profile keeps the statuses with it
    DbHelper::setListStatus($user, $profile['name'], $show, 'dropped');
    DbHelper::saveUserProfile($user, ['id' => $profile['id'], 'name' => 'Renombrado', 'avatar' => '', 'color' => '#a855f7']);
    assert((DbHelper::getListStatuses($user, 'Renombrado')[$show] ?? null) === 'dropped', 'Statuses follow a renamed profile');
    echo "✓ Profile rename keeps statuses OK\n";
} finally {
    unset($_SERVER['HTTP_AUTHORIZATION']);
    AuthMiddleware::$strictAccounts = null;
    $db->prepare("DELETE FROM episodes WHERE show_id = :s")->execute(['s' => $show]);
    $db->prepare("DELETE FROM shows WHERE id = :s")->execute(['s' => $show]);
    foreach (['watch_history', 'favorites', 'user_preferences', 'show_list_status', 'user_profiles', 'users'] as $t) {
        $db->prepare("DELETE FROM {$t} WHERE username = :u")->execute(['u' => $user]);
    }
}
echo "Watched marks and list status tests passed!\n";
