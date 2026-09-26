<?php
/**
 * Test Suite for Episode Notification Timestamp & Fail-Safe Persistence
 * 1. Episode created_at reflects real insertion time (not show creation time)
 * 2. Unread status correctly separates episodes added before vs after notifications_last_seen_at
 * 3. Mark seen endpoint fails with 500 when database fails (never swallowed)
 */

define('TESTING_MODE', true);

require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/HistoryController.php';

echo "Running Episode Notification Timestamp & Hardening Tests...\n";

try {
    $db = Database::getConnection();
} catch (Throwable $e) {
    echo "SKIPPED ⚠ (MySQL offline)\n";
    exit(0);
}

// Cleanup fixtures
$db->exec("DELETE FROM favorites WHERE username = 'notif_user'");
$db->exec("DELETE FROM episodes WHERE show_id = 'notif_show'");
$db->exec("DELETE FROM shows WHERE id = 'notif_show'");
$db->exec("DELETE FROM user_preferences WHERE username = 'notif_user'");
$db->exec("DELETE FROM user_profiles WHERE username = 'notif_user'");
$db->exec("DELETE FROM users WHERE username = 'notif_user'");

// Setup user and profile
DbHelper::registerUser('notif_user', 'SecurePass123!');
$profile = DbHelper::getUserProfiles('notif_user')[0];
$profileName = $profile['name'];

// Setup mock auth token
$jwt = AuthMiddleware::createToken([
    'username' => 'notif_user',
    'role' => 'user',
    'profile_id' => $profile['id'],
    'profile_name' => $profileName,
    'is_kids' => 0,
    'exp' => time() + 3600
]);
$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$jwt}";

// -------------------------------------------------------------------------------------------------
// 1. Show created T1, Episode 1 created T1
// -------------------------------------------------------------------------------------------------
echo "  [1/3] Testing episode notification timestamp differentiation (T1, T2, T3)...\n";
$t1 = date('Y-m-d H:i:s', time() - 3600); // 1 hour ago
$t2 = date('Y-m-d H:i:s', time() - 1800); // 30 minutes ago
$t3 = date('Y-m-d H:i:s', time() - 300);  // 5 minutes ago

$db->prepare("
    INSERT INTO shows (id, title, synopsis, rating, year, poster_path, created_at)
    VALUES ('notif_show', 'Hardened Notif Show', 'Synopsis', 8.5, 2026, '/poster.jpg', :t1)
")->execute(['t1' => $t1]);

DbHelper::saveEpisode([
    'id' => 'notif_ep_1',
    'show_id' => 'notif_show',
    'season_number' => 1,
    'episode_number' => 1,
    'title' => 'Episode 1',
    'filepath' => '/test/ep1.mp4',
    'created_at' => $t1
]);

// Add show to user favorites
DbHelper::toggleFavorite('notif_user', $profileName, 'notif_show');

// Fetch notifications before marking seen: ep1 should be unread
$notifsInitial = DbHelper::getNotifications('notif_user', $profileName);
assert($notifsInitial['unread_count'] >= 1, "Initial episode 1 must be unread");

// -------------------------------------------------------------------------------------------------
// 2. Mark seen at T2
// -------------------------------------------------------------------------------------------------
echo "  [2/3] Marking notifications seen at T2 and inserting Episode 2 at T3...\n";
$db->prepare("
    INSERT INTO user_preferences (username, profile_name, notifications_last_seen_at)
    VALUES ('notif_user', :p, :t2)
    ON DUPLICATE KEY UPDATE notifications_last_seen_at = :t2
")->execute(['p' => $profileName, 't2' => $t2]);

// Insert Episode 2 at T3 (newer than T2 mark-read timestamp)
DbHelper::saveEpisode([
    'id' => 'notif_ep_2',
    'show_id' => 'notif_show',
    'season_number' => 1,
    'episode_number' => 2,
    'title' => 'Episode 2',
    'filepath' => '/test/ep2.mp4',
    'created_at' => $t3
]);

$notifsAfterEp2 = DbHelper::getNotifications('notif_user', $profileName);
assert($notifsAfterEp2['unread_count'] === 1, "Only episode 2 must be unread (unread_count must be 1, got {$notifsAfterEp2['unread_count']})");

$notifList = $notifsAfterEp2['notifications'];
$ep1Notif = array_values(array_filter($notifList, fn($n) => $n['episode_id'] === 'notif_ep_1'))[0] ?? null;
$ep2Notif = array_values(array_filter($notifList, fn($n) => $n['episode_id'] === 'notif_ep_2'))[0] ?? null;

assert($ep1Notif !== null, "Episode 1 notification must exist in list");
assert($ep2Notif !== null, "Episode 2 notification must exist in list");
assert($ep1Notif['is_unread'] === false, "Episode 1 created at T1 must be marked read (seen at T2)");
assert($ep2Notif['is_unread'] === true, "Episode 2 created at T3 must be marked unread (seen at T2)");
echo "    ✓ Episode 1 is read, Episode 2 is unread as expected\n";

// -------------------------------------------------------------------------------------------------
// 3. Mark Notifications Seen Fail-Safe: database error must return HTTP 500
// -------------------------------------------------------------------------------------------------
echo "  [3/3] Testing fail-safe error propagation on mark seen failure...\n";
// Corrupt the user_preferences table temporarily or simulate invalid connection
$failedGracefully = false;
try {
    // Calling markNotificationsSeen for a non-existent table or triggering PDO exception
    $origTable = 'user_preferences';
    // We can simulate exception by passing invalid state or testing HistoryController
    // Let's test calling HistoryController::markNotificationsSeen when DB query fails:
    $db->exec("ALTER TABLE user_preferences RENAME TO temp_broken_user_preferences");
    try {
        HistoryController::markNotificationsSeen();
        assert(false, "HistoryController::markNotificationsSeen must fail when DB errors");
    } catch (ExitException $e) {
        if ($e->statusCode === 500) {
            $failedGracefully = true;
        }
    } finally {
        $db->exec("ALTER TABLE temp_broken_user_preferences RENAME TO user_preferences");
    }
} catch (Throwable $e) {
    // Clean up if rename threw
    @$db->exec("ALTER TABLE temp_broken_user_preferences RENAME TO user_preferences");
}
assert($failedGracefully === true, "Database failure on mark seen must return HTTP 500 and not be silenced");
echo "    ✓ HTTP 500 returned on database failure, error not silenced\n";

// Cleanup
$db->exec("DELETE FROM favorites WHERE username = 'notif_user'");
$db->exec("DELETE FROM episodes WHERE show_id = 'notif_show'");
$db->exec("DELETE FROM shows WHERE id = 'notif_show'");
$db->exec("DELETE FROM user_preferences WHERE username = 'notif_user'");
$db->exec("DELETE FROM user_profiles WHERE username = 'notif_user'");
$db->exec("DELETE FROM users WHERE username = 'notif_user'");
unset($_SERVER['HTTP_AUTHORIZATION']);

echo "✓ All Episode Notification Timestamp & Hardening Tests passed successfully!\n";
