<?php
/**
 * Test Suite for Migration 005 -> 006 Upgrade Pathway
 * Verifies that a system running RC baseline (001-005 applied) executes
 * ONLY 006_party_member_profile_context.sql and successfully upgrades the schema.
 */

define('TESTING_MODE', true);

require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/services/MigrationManager.php';

echo "Running Migration 005 -> 006 Upgrade Pathway Tests...\n";

// -------------------------------------------------------------------------------------------------
// 1. Verify Migration File List and Immutability of 001-005
// -------------------------------------------------------------------------------------------------
echo "  [1/3] Verifying migration list and immutability of 001-005...\n";
$migrationFiles = MigrationManager::getMigrationFiles();
assert(isset($migrationFiles['001_initial_schema.sql']), "Migration 001 must exist");
assert(isset($migrationFiles['002_foreign_keys_and_indexes.sql']), "Migration 002 must exist");
assert(isset($migrationFiles['003_party_participants.sql']), "Migration 003 must exist");
assert(isset($migrationFiles['004_security_profile_party_hardening.sql']), "Migration 004 must exist");
assert(isset($migrationFiles['005_notifications_read_state.sql']), "Migration 005 must exist");
assert(isset($migrationFiles['006_party_member_profile_context.sql']), "Migration 006 must exist");

// Ensure 001-005 do NOT contain columns introduced in 006
$sql005Content = file_get_contents($migrationFiles['005_notifications_read_state.sql']);
assert(!str_contains($sql005Content, 'is_kids'), "Migration 005 must NOT contain is_kids (must be immutable)");
assert(!str_contains($sql005Content, 'party_members'), "Migration 005 must NOT modify party_members");

$sql006Content = file_get_contents($migrationFiles['006_party_member_profile_context.sql']);
assert(str_contains($sql006Content, 'is_kids'), "Migration 006 must add is_kids to party_members");
assert(str_contains($sql006Content, 'account_username'), "Migration 006 must add account_username to party_members");
assert(str_contains($sql006Content, 'profile_id'), "Migration 006 must add profile_id to party_members");

// -------------------------------------------------------------------------------------------------
// 2. Verify Pending Migration Detection from 005 baseline
// -------------------------------------------------------------------------------------------------
echo "  [2/3] Testing pending detection when 001-005 are applied...\n";
$appliedBaseline = [
    '001_initial_schema.sql',
    '002_foreign_keys_and_indexes.sql',
    '003_party_participants.sql',
    '004_security_profile_party_hardening.sql',
    '005_notifications_read_state.sql'
];
$allAvailable = array_keys($migrationFiles);
$pending = array_values(array_diff($allAvailable, $appliedBaseline));

assert(count($pending) === 1, "Exactly one migration must be pending from 005 baseline");
assert($pending[0] === '006_party_member_profile_context.sql', "Pending migration must be 006_party_member_profile_context.sql");
echo "    ✓ Only 006 is pending after 005 baseline\n";

// -------------------------------------------------------------------------------------------------
// 3. Test Schema Upgrade from 005 baseline to 006 with real legacy data (Requires DB)
// -------------------------------------------------------------------------------------------------
try {
    $db = Database::getConnection();
} catch (Throwable $e) {
    echo "  [3/3] Upgrade execution skipped ⚠ (MySQL offline on host)\n";
    echo "✓ Migration 005 -> 006 Upgrade Tests Passed!\n";
    exit(0);
}

echo "  [3/3] Executing 006 SQL statements on isolated 005 party_members schema...\n";
$db->exec("DROP TABLE IF EXISTS test_upgrade_party_members");

// Baseline 005 schema for party_members
$db->exec("
    CREATE TABLE test_upgrade_party_members (
        id INT AUTO_INCREMENT PRIMARY KEY,
        room_id VARCHAR(64) NOT NULL,
        member_id VARCHAR(64) NOT NULL DEFAULT '',
        token_hash VARCHAR(64) NOT NULL DEFAULT '',
        role VARCHAR(32) NOT NULL DEFAULT 'viewer',
        username VARCHAR(255) NOT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_ping TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_test_pm_room (room_id),
        UNIQUE KEY uniq_test_pm_member (room_id, member_id),
        INDEX idx_test_pm_token (token_hash)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
");

// Insert legacy member row
$db->exec("
    INSERT INTO test_upgrade_party_members (room_id, member_id, token_hash, role, username)
    VALUES ('ROOM_TEST', 'mem_123', 'hash123', 'guest', 'LegacyGuest')
");

// Run 006 migration on the test table
$sqlStatements = MigrationManager::parseSqlStatements($sql006Content);
foreach ($sqlStatements as $stmt) {
    $adaptedStmt = str_replace('party_members', 'test_upgrade_party_members', $stmt);
    $db->exec($adaptedStmt);
}

// Verify columns exist
$checkCols = $db->query("SHOW COLUMNS FROM test_upgrade_party_members LIKE 'is_kids'")->fetch();
assert($checkCols !== false, "Column is_kids must exist in upgraded table");

$checkColsUser = $db->query("SHOW COLUMNS FROM test_upgrade_party_members LIKE 'account_username'")->fetch();
assert($checkColsUser !== false, "Column account_username must exist in upgraded table");

$checkColsProf = $db->query("SHOW COLUMNS FROM test_upgrade_party_members LIKE 'profile_id'")->fetch();
assert($checkColsProf !== false, "Column profile_id must exist in upgraded table");

// Verify default value for legacy rows
$row = $db->query("SELECT * FROM test_upgrade_party_members WHERE member_id = 'mem_123'")->fetch();
assert((int)$row['is_kids'] === 0, "Legacy rows must default to is_kids = 0");
assert($row['account_username'] === null, "Legacy rows must have null account_username");

// Cleanup
$db->exec("DROP TABLE IF EXISTS test_upgrade_party_members");

echo "✓ Migration 005 -> 006 Upgrade Tests Passed completely!\n";
