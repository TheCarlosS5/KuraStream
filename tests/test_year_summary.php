<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';

echo "Running year summary tests...\n";
$db = Database::getConnection();
$sfx = bin2hex(random_bytes(3));
$user = "ys_user_$sfx";
$showA = "ys_a_$sfx"; $showB = "ys_b_$sfx";
DbHelper::registerUser($user, 'ys_password_1');
$profile = DbHelper::getUserProfiles($user)[0]['name'];
try {
    DbHelper::saveShow(['id' => $showA, 'title' => 'Show A', 'synopsis' => 's', 'rating' => 7, 'year' => 2026, 'genres' => 'Acción, Drama']);
    DbHelper::saveShow(['id' => $showB, 'title' => 'Show B', 'synopsis' => 's', 'rating' => 7, 'year' => 2026, 'genres' => 'Comedia']);
    foreach ([[$showA, 1], [$showA, 2], [$showB, 1]] as [$show, $n]) {
        DbHelper::saveEpisode(['id' => "{$show}_e$n", 'show_id' => $show, 'season_number' => 1, 'episode_number' => $n, 'title' => "E$n", 'filepath' => "/m/{$show}$n.mp4", 'duration' => 1200.0]);
        DbHelper::saveProgress($user, $profile, "{$show}_e$n", 1200.0, 1200.0);
    }
    // One watched in a different year
    $db->prepare("UPDATE watch_history SET updated_at = '2024-03-10 10:00:00' WHERE username = :u AND episode_id = :e")->execute(['u' => $user, 'e' => "{$showB}_e1"]);

    $year = (int)gmdate('Y');
    $s = DbHelper::getYearSummary($user, $profile, $year);
    assert($s['episodes_watched'] === 2 && $s['shows_watched'] === 1, 'Only this year\'s activity counts');
    assert($s['total_time_seconds'] === 2400, 'Two finished 20-minute episodes');
    assert($s['top_shows'][0]['title'] === 'Show A' && $s['top_shows'][0]['episodes'] === 2, 'Top show');
    assert($s['top_genre'] === 'acción' || $s['top_genre'] === 'drama', 'Favourite genre comes from the shows watched');
    assert($s['busiest_month'] === (int)gmdate('n'), 'Busiest month');
    $old = DbHelper::getYearSummary($user, $profile, 2024);
    assert($old['episodes_watched'] === 1 && $old['top_shows'][0]['title'] === 'Show B', 'Another year is summarised separately');
    $none = DbHelper::getYearSummary($user, $profile, 2010);
    assert($none['episodes_watched'] === 0 && $none['busiest_month'] === null && $none['top_shows'] === [], 'An empty year is empty, not an error');
    echo "✓ Year summary OK\n";
} finally {
    foreach ([$showA, $showB] as $id) {
        $db->prepare("DELETE FROM episodes WHERE show_id = :s")->execute(['s' => $id]);
        $db->prepare("DELETE FROM shows WHERE id = :s")->execute(['s' => $id]);
    }
    foreach (['watch_history', 'favorites', 'user_preferences', 'show_list_status', 'show_ratings', 'user_profiles', 'users'] as $t) {
        $db->prepare("DELETE FROM {$t} WHERE username = :u")->execute(['u' => $user]);
    }
}
echo "Year summary tests passed!\n";
