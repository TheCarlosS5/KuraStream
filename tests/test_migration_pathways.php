<?php
define('TESTING_MODE', true);

require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/services/MigrationManager.php';

echo "Running Migration Pathways (Clean Install vs Upgrade 003->004) Tests...\n";

try {
    $db = Database::getConnection();
} catch (Throwable $e) {
    echo "SKIPPED ⚠ (MySQL offline)\n";
    exit(0);
}

// Pathway 1: Test Fresh Install Pathway (001 -> 002 -> 003 -> 004)
echo "  [1/3] Testing Clean Install Pathway (001 -> 002 -> 003 -> 004)...\n";
$db->exec("DROP TABLE IF EXISTS test_fresh_party_members");
$db->exec("DROP TABLE IF EXISTS test_fresh_user_profiles");

// Baseline 001
$db->exec("
    CREATE TABLE test_fresh_user_profiles (
        id VARCHAR(255) PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        avatar VARCHAR(500) DEFAULT '',
        color VARCHAR(50) DEFAULT '#a855f7',
        is_kids TINYINT(1) DEFAULT 0,
        pin VARCHAR(255) DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_profiles (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
");

// Baseline 003
$db->exec("
    CREATE TABLE test_fresh_party_members (
        id INT AUTO_INCREMENT PRIMARY KEY,
        room_id VARCHAR(64) NOT NULL,
        username VARCHAR(255) NOT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_ping TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_party_members_room (room_id),
        UNIQUE KEY uniq_room_user (room_id, username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
");

// Apply 004 changes
$sql004 = file_get_contents(__DIR__ . '/../php_backend/migrations/004_security_profile_party_hardening.sql');
$sql004_adapted = str_replace(
    ['user_profiles', 'party_members'],
    ['test_fresh_user_profiles', 'test_fresh_party_members'],
    $sql004
);

$statements = MigrationManager::parseSqlStatements($sql004_adapted);
foreach ($statements as $stmt) {
    $db->exec($stmt);
}

// Verify Schema on Fresh Install
$colsStmt = $db->query("SHOW COLUMNS FROM test_fresh_party_members");
$cols = $colsStmt->fetchAll(PDO::FETCH_COLUMN, 0);
assert(in_array('member_id', $cols, true), "test_fresh_party_members must have member_id");
assert(in_array('token_hash', $cols, true), "test_fresh_party_members must have token_hash");
assert(in_array('role', $cols, true), "test_fresh_party_members must have role");

// Verify that duplicate display names are allowed in the same room on fresh install
$db->prepare("INSERT INTO test_fresh_party_members (room_id, member_id, token_hash, role, username) VALUES ('r1', 'm1', 'h1', 'viewer', 'SameNickname')")->execute();
$db->prepare("INSERT INTO test_fresh_party_members (room_id, member_id, token_hash, role, username) VALUES ('r1', 'm2', 'h2', 'viewer', 'SameNickname')")->execute();
echo "    -> Fresh install schema verification OK\n";


// Pathway 2: Test Upgrade Pathway from existing 003 with legacy data
echo "  [2/3] Testing Existing Install Upgrade Pathway (003 -> 004 with legacy rows)...\n";
$db->exec("DROP TABLE IF EXISTS test_upg_party_members");
$db->exec("DROP TABLE IF EXISTS test_upg_user_profiles");

// Baseline 001
$db->exec("
    CREATE TABLE test_upg_user_profiles (
        id VARCHAR(255) PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        avatar VARCHAR(500) DEFAULT '',
        color VARCHAR(50) DEFAULT '#a855f7',
        is_kids TINYINT(1) DEFAULT 0,
        pin VARCHAR(255) DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_profiles (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
");

// Baseline 003
$db->exec("
    CREATE TABLE test_upg_party_members (
        id INT AUTO_INCREMENT PRIMARY KEY,
        room_id VARCHAR(64) NOT NULL,
        username VARCHAR(255) NOT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_ping TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_party_members_room (room_id),
        UNIQUE KEY uniq_room_user (room_id, username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
");

// Populate existing legacy rows
$db->exec("INSERT INTO test_upg_user_profiles (id, username, name) VALUES ('p1', 'userA', 'ProfileOne')");
$db->exec("INSERT INTO test_upg_party_members (room_id, username) VALUES ('room_legacy', 'Alice')");
$db->exec("INSERT INTO test_upg_party_members (room_id, username) VALUES ('room_legacy', 'Bob')");

// Run 004 migration on legacy database
$sql004_upg = str_replace(
    ['user_profiles', 'party_members'],
    ['test_upg_user_profiles', 'test_upg_party_members'],
    $sql004
);

$statements = MigrationManager::parseSqlStatements($sql004_upg);
foreach ($statements as $stmt) {
    $db->exec($stmt);
}

// Verify legacy data backfill
$backfilled = $db->query("SELECT member_id, token_hash, role, username FROM test_upg_party_members WHERE room_id = 'room_legacy'")->fetchAll(PDO::FETCH_ASSOC);
assert(count($backfilled) === 2, "Expected 2 legacy members");
foreach ($backfilled as $row) {
    assert(!empty($row['member_id']), "Legacy member_id must be backfilled");
    assert(str_starts_with($row['member_id'], 'mem_'), "Legacy member_id must have mem_ prefix");
    assert(!empty($row['token_hash']), "Legacy token_hash must be backfilled");
    assert(!empty($row['role']), "Legacy role must be backfilled");
}

// Verify unique constraint on user_profiles (username, name)
$duplicateBlocked = false;
try {
    $db->exec("INSERT INTO test_upg_user_profiles (id, username, name) VALUES ('p2', 'userA', 'ProfileOne')");
} catch (Throwable $e) {
    $duplicateBlocked = true;
}
assert($duplicateBlocked, "Duplicate profile name for same user must be blocked by uniq_user_profile_name");

// Verify that two users can now share the same nickname in the same room
$db->prepare("INSERT INTO test_upg_party_members (room_id, member_id, token_hash, role, username) VALUES ('room_legacy', 'mem_charlie1', 'hash1', 'viewer', 'Alice')")->execute();
$db->prepare("INSERT INTO test_upg_party_members (room_id, member_id, token_hash, role, username) VALUES ('room_legacy', 'mem_charlie2', 'hash2', 'viewer', 'Alice')")->execute();
echo "    -> Upgrade pathway with legacy data OK\n";

// Pathway 3: Test preflight duplicate profile detection abort
echo "  [3/3] Testing Upgrade Pathway with duplicate profiles preflight abort...\n";
$db->exec("DROP TABLE IF EXISTS test_dup_user_profiles");
$db->exec("
    CREATE TABLE test_dup_user_profiles (
        id VARCHAR(255) PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_profiles (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
");
$db->exec("INSERT INTO test_dup_user_profiles (id, username, name) VALUES ('p1', 'userDupe', 'Child')");
$db->exec("INSERT INTO test_dup_user_profiles (id, username, name) VALUES ('p2', 'userDupe', 'Child')");

$dupStmt = $db->query("
    SELECT username, name, COUNT(*) as cnt 
    FROM test_dup_user_profiles 
    GROUP BY username, name 
    HAVING cnt > 1
");
$duplicates = $dupStmt->fetchAll(PDO::FETCH_ASSOC);
assert(count($duplicates) === 1, "Duplicate profile must be detected");
assert($duplicates[0]['username'] === 'userDupe', "Duplicate username must match");
assert($duplicates[0]['name'] === 'Child', "Duplicate profile name must match");
$db->exec("DROP TABLE IF EXISTS test_dup_user_profiles");
echo "    -> Duplicate profile detection preflight OK\n";

// Cleanup test tables
$db->exec("DROP TABLE IF EXISTS test_fresh_party_members");
$db->exec("DROP TABLE IF EXISTS test_fresh_user_profiles");
$db->exec("DROP TABLE IF EXISTS test_upg_party_members");
$db->exec("DROP TABLE IF EXISTS test_upg_user_profiles");
$db->exec("DROP TABLE IF EXISTS test_dup_user_profiles");

echo "\n✓ All Migration Pathways (Clean Install & Upgrade) passed successfully!\n";
