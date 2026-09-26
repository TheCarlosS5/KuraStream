<?php
/**
 * Test Suite for Migration 004 -> 005 Upgrade Pathway
 * Verifies that a system running the previous RC (001-004 applied) executes
 * ONLY 005_notifications_read_state.sql and successfully upgrades the schema.
 */

define('TESTING_MODE', true);

require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/services/MigrationManager.php';

echo "Running Migration 004 -> 005 Upgrade Pathway Tests...\n";

// -------------------------------------------------------------------------------------------------
// 1. Verify Migration File List and Invariant
// -------------------------------------------------------------------------------------------------
echo "  [1/3] Verifying migration list and immutability of 001-004...\n";
$migrationFiles = MigrationManager::getMigrationFiles();
assert(isset($migrationFiles['001_initial_schema.sql']), "Migration 001 must exist");
assert(isset($migrationFiles['002_foreign_keys_and_indexes.sql']), "Migration 002 must exist");
assert(isset($migrationFiles['003_party_participants.sql']), "Migration 003 must exist");
assert(isset($migrationFiles['004_security_profile_party_hardening.sql']), "Migration 004 must exist");
assert(isset($migrationFiles['005_notifications_read_state.sql']), "Migration 005 must exist");

// Ensure 004 does NOT contain notifications_last_seen_at
$sql004Content = file_get_contents($migrationFiles['004_security_profile_party_hardening.sql']);
assert(!str_contains($sql004Content, 'notifications_last_seen_at'), "Migration 004 must NOT contain notifications_last_seen_at (must be immutable)");

// -------------------------------------------------------------------------------------------------
// 2. Verify Pending Migration Detection from 4bdcaeae baseline (001-004 applied)
// -------------------------------------------------------------------------------------------------
echo "  [2/3] Testing pending detection when 001-004 are applied...\n";
$appliedBaseline = [
    '001_initial_schema.sql',
    '002_foreign_keys_and_indexes.sql',
    '003_party_participants.sql',
    '004_security_profile_party_hardening.sql'
];
$allAvailable = array_keys($migrationFiles);
$pending = array_values(array_diff($allAvailable, $appliedBaseline));

assert(count($pending) === 1, "Exactly one migration must be pending from 4bdcaeae baseline");
assert($pending[0] === '005_notifications_read_state.sql', "Pending migration must be 005_notifications_read_state.sql");
echo "    ✓ Only 005 is pending after 004 baseline\n";

// -------------------------------------------------------------------------------------------------
// 3. Test Schema Upgrade from 004 baseline to 005 with real legacy data (Requires DB)
// -------------------------------------------------------------------------------------------------
try {
    $db = Database::getConnection();
} catch (Throwable $e) {
    echo "  [3/3] Upgrade execution skipped ⚠ (MySQL offline on host)\n";
    exit(0);
}

echo "  [3/3] Executing 005 SQL statements on isolated 004 schema tables...\n";
$db->exec("DROP TABLE IF EXISTS test_upgrade_episodes");
$db->exec("DROP TABLE IF EXISTS test_upgrade_shows");
$db->exec("DROP TABLE IF EXISTS test_upgrade_user_preferences");

// Baseline 004 schema for user_preferences
$db->exec("
    CREATE TABLE test_upgrade_user_preferences (
        username VARCHAR(255) NOT NULL,
        profile_name VARCHAR(255) NOT NULL DEFAULT 'Principal',
        auto_skip_intro TINYINT(1) DEFAULT 0,
        auto_play_next TINYINT(1) DEFAULT 1,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (username, profile_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
");

// Baseline 004 schema for shows
$db->exec("
    CREATE TABLE test_upgrade_shows (
        id VARCHAR(255) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        synopsis TEXT,
        rating DOUBLE DEFAULT 0.0,
        year INT NULL,
        created_at TIMESTAMP DEFAULT '2025-01-01 10:00:00'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
");

// Baseline 004 schema for episodes (NO created_at, NO availability_status, NO file_mtime)
$db->exec("
    CREATE TABLE test_upgrade_episodes (
        id VARCHAR(255) PRIMARY KEY,
        show_id VARCHAR(255) NOT NULL,
        season_number INT NOT NULL DEFAULT 1,
        episode_number INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        filepath VARCHAR(500) NOT NULL,
        duration DOUBLE DEFAULT 0.0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
");

// Insert legacy data prior to 005
$db->exec("INSERT INTO test_upgrade_shows (id, title, created_at) VALUES ('show_frieren', 'Frieren', '2025-06-15 12:00:00')");
$db->exec("INSERT INTO test_upgrade_episodes (id, show_id, episode_number, title, filepath) VALUES ('ep_frieren_1', 'show_frieren', 1, 'The Journey', '/mock/ep1.mp4')");
$db->exec("INSERT INTO test_upgrade_user_preferences (username, profile_name) VALUES ('alice', 'Principal')");

// Adapt 005 SQL to isolated test tables
$sql005 = file_get_contents($migrationFiles['005_notifications_read_state.sql']);
$sql005Adapted = str_replace(
    ['user_preferences', 'episodes', 'shows'],
    ['test_upgrade_user_preferences', 'test_upgrade_episodes', 'test_upgrade_shows'],
    $sql005
);

$statements = MigrationManager::parseSqlStatements($sql005Adapted);
foreach ($statements as $stmt) {
    $db->exec($stmt);
}

// Verification 1: user_preferences.notifications_last_seen_at exists
$colsPrefs = $db->query("SHOW COLUMNS FROM test_upgrade_user_preferences")->fetchAll(PDO::FETCH_COLUMN, 0);
assert(in_array('notifications_last_seen_at', $colsPrefs, true), "notifications_last_seen_at column must exist on user_preferences");

// Verification 2: episodes.created_at exists and was backfilled from show
$colsEp = $db->query("SHOW COLUMNS FROM test_upgrade_episodes")->fetchAll(PDO::FETCH_COLUMN, 0);
assert(in_array('created_at', $colsEp, true), "created_at column must exist on episodes");
assert(in_array('availability_status', $colsEp, true), "availability_status column must exist on episodes");
assert(in_array('missing_scan_count', $colsEp, true), "missing_scan_count column must exist on episodes");
assert(in_array('file_mtime', $colsEp, true), "file_mtime column must exist on episodes");

$backfilledEp = $db->query("SELECT created_at, availability_status FROM test_upgrade_episodes WHERE id = 'ep_frieren_1'")->fetch(PDO::FETCH_ASSOC);
assert(!empty($backfilledEp['created_at']), "Episode created_at must be populated");
assert($backfilledEp['created_at'] === '2025-06-15 12:00:00', "Episode created_at must be backfilled from show created_at");
assert($backfilledEp['availability_status'] === 'available', "Episode availability_status must default to 'available'");

// Verification 3: shows.tmdb_id exists
$colsShows = $db->query("SHOW COLUMNS FROM test_upgrade_shows")->fetchAll(PDO::FETCH_COLUMN, 0);
assert(in_array('tmdb_id', $colsShows, true), "tmdb_id column must exist on shows");

// Cleanup test tables
$db->exec("DROP TABLE IF EXISTS test_upgrade_episodes");
$db->exec("DROP TABLE IF EXISTS test_upgrade_shows");
$db->exec("DROP TABLE IF EXISTS test_upgrade_user_preferences");

echo "    ✓ Migration 005 applied cleanly and backfilled legacy data\n";
echo "✓ All Migration 004 -> 005 upgrade tests passed successfully!\n";
