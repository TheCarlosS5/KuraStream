<?php
define('TESTING_MODE', true);

require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/services/MigrationManager.php';

echo "Running Migration Manager & SQL Statement Parser Tests...\n";

// 1. Test Comment Stripping and Statement Splitting
$sampleSql = <<<SQL
-- Migration: Sample Migration
-- Description: Testing comment stripper
/* 
   Multi-line block comment
   spanning multiple lines
*/

CREATE TABLE sample_table_a (
    id INT PRIMARY KEY,
    name VARCHAR(255) NOT NULL -- inline comment should not break parsing
);

-- Another comment before second statement
CREATE TABLE sample_table_b (
    id INT PRIMARY KEY,
    val TEXT
);
SQL;

$statements = MigrationManager::parseSqlStatements($sampleSql);
assert(count($statements) === 2, "Expected 2 statements, found " . count($statements));
assert(str_starts_with($statements[0], 'CREATE TABLE sample_table_a'), "First statement must be CREATE TABLE sample_table_a");
assert(str_starts_with($statements[1], 'CREATE TABLE sample_table_b'), "Second statement must be CREATE TABLE sample_table_b");
echo "✓ SQL Statement Parser strips comments and extracts statements accurately\n";

// 2. Test Migration Files Discovery
$files = MigrationManager::getMigrationFiles();
assert(!empty($files), "MigrationManager::getMigrationFiles() must find migration files");
assert(isset($files['001_initial_schema.sql']), "001_initial_schema.sql must be present");
assert(isset($files['002_foreign_keys_and_indexes.sql']), "002_foreign_keys_and_indexes.sql must be present");
assert(isset($files['003_party_participants.sql']), "003_party_participants.sql must be present");

// 3. Test That All Migration Files Parse Without Empty Statements
foreach ($files as $name => $path) {
    $content = file_get_contents($path);
    $parsed = MigrationManager::parseSqlStatements($content);
    assert(!empty($parsed), "Migration file {$name} must contain at least 1 valid statement");
    foreach ($parsed as $idx => $stmt) {
        assert(!str_starts_with($stmt, '--'), "Statement {$idx} in {$name} must not start with comment marker --");
        assert(!str_starts_with($stmt, '/*'), "Statement {$idx} in {$name} must not start with block comment marker /*");
    }
}
echo "✓ All repository migration files parsed successfully with valid SQL statements\n";

echo "✓ Migration Parser Tests Passed\n";
