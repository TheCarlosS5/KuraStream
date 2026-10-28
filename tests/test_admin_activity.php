<?php
/**
 * GET /api/admin/activity data: who is watching now (saved in the last 45 s), recent history, biggest shows on disk
 * with the days since anyone watched them, and how many more episodes fit.
 */
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/controllers/AdminController.php';

echo "Running admin activity tests...\n";

$db = Database::getConnection();
Database::initializeSchema($db);

$suffix = bin2hex(random_bytes(3));
$big = "act_big_{$suffix}";
$small = "act_small_{$suffix}";
$user = "act_user_{$suffix}";
$episodeIds = [];

try {
    $insertShow = $db->prepare("INSERT INTO shows (id, title, media_type) VALUES (:id, :title, 'anime')");
    $insertShow->execute(['id' => $big, 'title' => 'Serie grande']);
    $insertShow->execute(['id' => $small, 'title' => 'Serie chica']);
    $insertEp = $db->prepare("INSERT INTO episodes (id, show_id, season_number, episode_number, title, filepath, duration, size)
        VALUES (:id, :show, 1, :n, :title, :path, 1440, :size)");
    foreach ([[$big, 1, 9000000000], [$big, 2, 9000000000], [$small, 1, 300000000]] as [$show, $n, $size]) {
        $id = "{$show}_S1_E{$n}";
        $episodeIds[] = $id;
        $insertEp->execute(['id' => $id, 'show' => $show, 'n' => $n, 'title' => "Ep {$n}", 'path' => "/x/{$id}.mkv", 'size' => $size]);
    }

    $hist = $db->prepare("INSERT INTO watch_history (username, profile_name, episode_id, progress_seconds, duration, completed, updated_at)
        VALUES (:u, :p, :e, :pr, 1440, 0, :at)");
    $hist->execute(['u' => $user, 'p' => 'Peques', 'e' => "{$small}_S1_E1", 'pr' => 600, 'at' => date('Y-m-d H:i:s')]);
    $hist->execute(['u' => $user, 'p' => 'Calos', 'e' => "{$big}_S1_E1", 'pr' => 100, 'at' => date('Y-m-d H:i:s', time() - 3 * 86400)]);

    $data = AdminController::activity();

    $now = array_values(array_filter($data['watching_now'], fn($r) => $r['username'] === $user));
    assert(count($now) === 1, 'Only the save from the last 45 s counts as watching now');
    assert($now[0]['profile_name'] === 'Peques' && $now[0]['show_title'] === 'Serie chica' && $now[0]['episode_number'] === 1);

    $recent = array_values(array_filter($data['recent'], fn($r) => $r['username'] === $user));
    assert(count($recent) === 2 && $recent[0]['profile_name'] === 'Peques', 'Recent history is newest first');

    $byId = array_column($data['biggest_shows'], null, 'show_id');
    assert(isset($byId[$big]) && $byId[$big]['bytes'] === 18000000000 && $byId[$big]['episodes'] === 2, 'Show size is the sum of its episodes');
    assert($byId[$big]['days_since_watched'] === 3, 'Days since the last time anyone watched it');
    $positions = array_flip(array_column($data['biggest_shows'], 'show_id'));
    assert(!isset($positions[$small]) || $positions[$big] < $positions[$small], 'Biggest first');

    assert(array_key_exists('episodes_that_fit', $data['capacity']) && $data['capacity']['average_episode_bytes'] > 0);

    echo "Admin activity tests passed.\n";
} finally {
    $db->prepare("DELETE FROM watch_history WHERE username = :u")->execute(['u' => $user]);
    foreach ($episodeIds as $id) {
        $db->prepare("DELETE FROM episodes WHERE id = :id")->execute(['id' => $id]);
    }
    $db->prepare("DELETE FROM shows WHERE id IN (:a, :b)")->execute(['a' => $big, 'b' => $small]);
}
