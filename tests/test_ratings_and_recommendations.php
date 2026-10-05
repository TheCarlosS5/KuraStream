<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/ShowController.php';
require_once __DIR__ . '/../php_backend/controllers/HistoryController.php';

echo "Running ratings and recommendations tests...\n";

function rr_call(callable $fn): array {
    ob_start();
    try { $fn(); } catch (ExitException $e) { ob_end_clean(); return [$e->statusCode, is_array($e->data) ? $e->data : []]; }
    ob_end_clean();
    return [null, []];
}

$db = Database::getConnection();
$sfx = bin2hex(random_bytes(3));
$user = "rr_user_$sfx";
$ids = [];
DbHelper::registerUser($user, 'rr_password_1');
$profile = DbHelper::getUserProfiles($user)[0];
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . AuthMiddleware::createToken([
    'username' => $user, 'role' => 'user', 'profile_id' => $profile['id'], 'profile_name' => $profile['name'], 'exp' => time() + 600,
]);
AuthMiddleware::$strictAccounts = true;

try {
    // seed show (watched) + 4 candidates with different genre overlap + one disliked + one restricted
    $defs = [
        'seed'  => ['Seed', 'Acción, Fantasía', 8.0, 'TV-14'],
        'best'  => ['Best', 'Acción, Fantasía', 9.0, 'TV-14'],
        'good'  => ['Good', 'Acción', 7.0, 'TV-14'],
        'ok'    => ['Ok', 'Fantasía', 6.0, 'PG'],
        'other' => ['Other', 'Fantasía', 5.0, 'TV-14'],
        'none'  => ['NoOverlap', 'Comedia', 9.5, 'TV-14'],
        'hated' => ['Hated', 'Acción, Fantasía', 9.9, 'TV-14'],
        'adult' => ['Adult', 'Acción, Fantasía', 9.8, 'TV-MA'],
    ];
    foreach ($defs as $key => [$title, $genres, $rating, $age]) {
        $ids[$key] = "rr_{$key}_$sfx";
        DbHelper::saveShow(['id' => $ids[$key], 'title' => $title, 'synopsis' => 's', 'rating' => $rating, 'year' => 2026, 'genres' => $genres, 'age_rating' => $age]);
    }
    DbHelper::saveEpisode(['id' => "{$ids['seed']}_e1", 'show_id' => $ids['seed'], 'season_number' => 1, 'episode_number' => 1,
        'title' => 'E1', 'filepath' => '/media/rr_seed.mp4', 'duration' => 1200.0]);
    DbHelper::saveProgress($user, $profile['name'], "{$ids['seed']}_e1", 600.0, 1200.0);

    // Ratings
    [$code] = rr_call(fn() => HistoryController::setRating(['show_id' => $ids['hated'], 'rating' => 1]));
    assert($code === 200, 'Rating 1 is stored');
    [$code] = rr_call(fn() => HistoryController::setRating(['show_id' => $ids['best'], 'rating' => 6]));
    assert($code === 400, 'Ratings above 5 are refused');
    [$code] = rr_call(fn() => HistoryController::setRating(['show_id' => $ids['best'], 'rating' => 2.5]));
    assert($code === 400, 'Fractions are refused');
    [$code] = rr_call(fn() => HistoryController::setRating(['show_id' => 'nope_missing', 'rating' => 3]));
    assert($code === 404, 'Unknown show is a 404');
    [, $body] = rr_call(fn() => HistoryController::getRatings());
    assert(((array)$body['ratings'])[$ids['hated']] === 1, 'Ratings are listed');
    [$code] = rr_call(fn() => HistoryController::setRating(['show_id' => $ids['hated'], 'rating' => null]));
    [, $body] = rr_call(fn() => HistoryController::getRatings());
    assert(!isset(((array)$body['ratings'])[$ids['hated']]), 'A null rating clears it');
    DbHelper::setRating($user, $profile['name'], $ids['hated'], 1);
    echo "✓ Ratings OK\n";

    // Recommendations: the seed's genres, best overlap first, no watched, no disliked, no unrelated
    $own = array_values($ids);
    [$code, $body] = rr_call(fn() => HistoryController::getRecommendations());
    assert($code === 200 && !empty($body['groups']), 'There is a recommendation group: ');
    $group = $body['groups'][0];
    assert($group['because']['id'] === $ids['seed'], 'It is explained by the show that was watched');
    $got = array_column($group['shows'], 'id');
    assert($got[0] === $ids['adult'] || $got[0] === $ids['best'], 'Highest overlap and rating first');
    assert(!in_array($ids['seed'], $got, true), 'The seed itself is not recommended');
    assert(!in_array($ids['hated'], $got, true), 'A show rated 1-2 is not recommended');
    assert(!in_array($ids['none'], $got, true), 'A show with no shared genre is not recommended');
    assert(in_array($ids['good'], $got, true) && in_array($ids['ok'], $got, true), 'Partial overlaps are included');
    echo "✓ Recommendations OK\n";

    // A profile capped at PG never sees the adult show
    $db->prepare("UPDATE user_profiles SET max_rating = 'PG-13' WHERE id = :id")->execute(['id' => $profile['id']]);
    [, $body] = rr_call(fn() => HistoryController::getRecommendations());
    $got = array_column($body['groups'][0]['shows'] ?? [], 'id');
    assert(!in_array($ids['adult'], $got, true), 'The rating cap applies to recommendations');
    echo "✓ Restrictions apply OK\n";
} finally {
    unset($_SERVER['HTTP_AUTHORIZATION']);
    AuthMiddleware::$strictAccounts = null;
    foreach ($ids as $id) {
        $db->prepare("DELETE FROM episodes WHERE show_id = :s")->execute(['s' => $id]);
        $db->prepare("DELETE FROM shows WHERE id = :s")->execute(['s' => $id]);
    }
    foreach (['watch_history', 'favorites', 'user_preferences', 'show_list_status', 'show_ratings', 'user_profiles', 'users'] as $t) {
        $db->prepare("DELETE FROM {$t} WHERE username = :u")->execute(['u' => $user]);
    }
}
echo "Ratings and recommendations tests passed!\n";
