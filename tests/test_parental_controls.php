<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/../php_backend/controllers/ShowController.php';
require_once __DIR__ . '/../php_backend/controllers/HistoryController.php';
require_once __DIR__ . '/../php_backend/controllers/PlayerController.php';

echo "Running parental controls tests...\n";

function pc_call(callable $fn): array {
    ob_start();
    try { $fn(); } catch (ExitException $e) { ob_end_clean(); return [$e->statusCode, is_array($e->data) ? $e->data : (json_decode($e->getMessage(), true) ?: [])]; }
    ob_end_clean();
    return [null, []];
}

$db = Database::getConnection();
$sfx = bin2hex(random_bytes(3));
$user = "pc_user_$sfx";
$shows = ['g' => "pc_g_$sfx", 'pg13' => "pc_pg13_$sfx", 'r' => "pc_r_$sfx"];
DbHelper::registerUser($user, 'pc_password_1');
AuthMiddleware::$strictAccounts = true;

$token = function (array $profile) use ($user) {
    return AuthMiddleware::createToken([
        'username' => $user, 'role' => 'user', 'profile_id' => $profile['id'], 'profile_name' => $profile['name'],
        'exp' => time() + 600,
    ]);
};

try {
    foreach (['g' => 'G', 'pg13' => 'PG-13', 'r' => 'TV-MA'] as $key => $rating) {
        DbHelper::saveShow(['id' => $shows[$key], 'title' => "PC $rating", 'synopsis' => 's', 'rating' => 7, 'year' => 2026, 'age_rating' => $rating]);
        DbHelper::saveEpisode(['id' => $shows[$key] . '_e1', 'show_id' => $shows[$key], 'season_number' => 1, 'episode_number' => 1,
            'title' => 'E1', 'filepath' => '/media/' . $shows[$key] . '.mp4', 'duration' => 1200.0]);
    }
    $main = DbHelper::getUserProfiles($user)[0];

    // The cap is validated and kept when a client does not send it
    [$code] = pc_call(fn() => DbHelper::saveUserProfile($user, ['id' => $main['id'], 'name' => $main['name'], 'max_rating' => 'XXL']));
    assert($code === 400, 'An unknown rating cap is refused');
    [$code] = pc_call(fn() => DbHelper::saveUserProfile($user, ['id' => $main['id'], 'name' => $main['name'], 'daily_limit_minutes' => 5]));
    assert($code === 400, 'A limit under 15 minutes is refused');
    $saved = DbHelper::saveUserProfile($user, ['id' => $main['id'], 'name' => $main['name'], 'max_rating' => 'PG', 'daily_limit_minutes' => 30]);
    assert($saved['max_rating'] === 'PG' && $saved['daily_limit_minutes'] === 30, 'Cap and limit are stored');
    $again = DbHelper::saveUserProfile($user, ['id' => $main['id'], 'name' => $main['name'], 'color' => '#a855f7']);
    assert($again['max_rating'] === 'PG' && $again['daily_limit_minutes'] === 30, 'An edit that does not mention them keeps them (older clients)');
    echo "✓ Profile fields validated and preserved OK\n";

    $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $token($main);

    // Catalogue is filtered by the cap
    $_GET = [];
    [, $list] = pc_call(fn() => ShowController::getShows());
    $ids = array_column($list['items'] ?? $list, 'id');
    assert(in_array($shows['g'], $ids, true), 'A G show stays visible under a PG cap');
    assert(!in_array($shows['pg13'], $ids, true) && !in_array($shows['r'], $ids, true), 'PG-13 and TV-MA shows are hidden under a PG cap');
    [$code] = pc_call(fn() => ShowController::getShowDetails($shows['pg13']));
    assert($code === 403, 'Opening a PG-13 show is refused under a PG cap');
    [$code] = pc_call(fn() => ShowController::getShowDetails($shows['g']));
    assert($code === 200, 'A G show opens');
    [$code] = pc_call(fn() => PlayerController::checkKidsModeAccess($shows['r'], false));
    assert($code === 403, 'Playback of a TV-MA show is refused');
    echo "✓ Rating cap applies to the catalogue, details and playback OK\n";

    // Without a cap everything is visible
    $db->prepare("UPDATE user_profiles SET max_rating = NULL WHERE id = :id")->execute(['id' => $main['id']]);
    [$code] = pc_call(fn() => ShowController::getShowDetails($shows['pg13']));
    assert($code === 200, 'Removing the cap restores access');
    $db->prepare("UPDATE user_profiles SET max_rating = 'PG' WHERE id = :id")->execute(['id' => $main['id']]);

    // Screen time
    $db->prepare("DELETE FROM profile_watch_time WHERE username = :u")->execute(['u' => $user]);
    assert(PlayerController::screenTimeStatus()['limit_seconds'] === 1800, 'The limit is 30 minutes');
    // A progress save counts time and reports the remaining budget
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $GLOBALS['_MOCKED_JSON_INPUT'] = ['progress' => 60, 'duration' => 1200];
    [$code, $body] = pc_call(fn() => HistoryController::saveProgress($shows['g'] . '_e1'));
    assert($code === 200 && isset($body['screen_time']) && $body['screen_time']['limit_reached'] === false, 'A save reports the screen-time status');
    assert(DbHelper::getWatchSecondsToday($user, $main['name']) >= 5, 'A save adds time');

    $db->prepare("UPDATE profile_watch_time SET seconds = 1800 WHERE username = :u")->execute(['u' => $user]);
    [$code, $body] = pc_call(fn() => PlayerController::checkKidsModeAccess($shows['g']));
    assert($code === 403 && ($body['code'] ?? '') === 'SCREEN_TIME_LIMIT', 'Opening a stream after the budget is spent is refused');
    [$code, $body] = pc_call(fn() => HistoryController::saveProgress($shows['g'] . '_e1'));
    assert($code === 200 && $body['screen_time']['limit_reached'] === true, 'The last position is still saved, flagged as limit reached');
    echo "✓ Screen time is counted and enforced OK\n";

    // A profile with no limit costs nothing
    $other = DbHelper::saveUserProfile($user, ['name' => 'Libre_' . $sfx, 'color' => '#a855f7']);
    $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $token($other);
    assert(PlayerController::screenTimeStatus() === null, 'No limit, no tracking');
    echo "✓ Unlimited profiles are untouched OK\n";
} finally {
    unset($_SERVER['HTTP_AUTHORIZATION'], $_SERVER['REQUEST_METHOD'], $GLOBALS['_MOCKED_JSON_INPUT']);
    AuthMiddleware::$strictAccounts = null;
    foreach ($shows as $id) {
        $db->prepare("DELETE FROM episodes WHERE show_id = :s")->execute(['s' => $id]);
        $db->prepare("DELETE FROM shows WHERE id = :s")->execute(['s' => $id]);
    }
    foreach (['watch_history', 'favorites', 'user_preferences', 'show_list_status', 'profile_watch_time', 'user_profiles', 'users'] as $t) {
        $db->prepare("DELETE FROM {$t} WHERE username = :u")->execute(['u' => $user]);
    }
}
echo "Parental controls tests passed!\n";
