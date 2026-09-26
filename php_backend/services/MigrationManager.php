<?php
/**
 * KuraStream v2.0 - Database Migration Manager
 * Applies versioned SQL migrations idempotently and tracks schema version history.
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';

class MigrationManager {
    public static function initMigrationTable(PDO $db): void {
        $db->exec("
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        ");
    }

    public static function getAppliedMigrations(PDO $db): array {
        self::initMigrationTable($db);
        $stmt = $db->query("SELECT version FROM schema_migrations ORDER BY version ASC");
        return $stmt->fetchAll(PDO::FETCH_COLUMN) ?: [];
    }

    public static function getMigrationFiles(): array {
        $dir = __DIR__ . '/../migrations';
        if (!is_dir($dir)) {
            return [];
        }

        $files = glob($dir . '/*.sql');
        sort($files);
        $migrations = [];
        foreach ($files as $file) {
            $migrations[basename($file)] = $file;
        }
        return $migrations;
    }

    /**
     * Parse SQL file content into individual executable statements,
     * stripping block comments and line comments cleanly before splitting by semicolon.
     */
    public static function parseSqlStatements(string $sql): array {
        // Strip block comments /* ... */
        $clean = preg_replace('!/\*.*?\*/!s', '', $sql);

        // Strip single line comments (-- and #)
        $lines = explode("\n", $clean);
        $filteredLines = [];
        foreach ($lines as $line) {
            $trimmed = trim($line);
            if (str_starts_with($trimmed, '--') || str_starts_with($trimmed, '#')) {
                continue;
            }
            $filteredLines[] = $line;
        }
        $clean = implode("\n", $filteredLines);

        // Split by semicolon
        $rawStatements = explode(';', $clean);
        $statements = [];
        foreach ($rawStatements as $stmt) {
            $trimmed = trim($stmt);
            if (!empty($trimmed)) {
                $statements[] = $trimmed;
            }
        }
        return $statements;
    }

    public static function getStatus(): array {
        try {
            $db = Database::getConnection();
            $applied = self::getAppliedMigrations($db);
            $available = array_keys(self::getMigrationFiles());
            $pending = array_values(array_diff($available, $applied));

            return [
                'status' => 'healthy',
                'applied' => $applied,
                'pending' => $pending,
                'total' => count($available)
            ];
        } catch (Throwable $e) {
            return [
                'status' => 'error',
                'error' => $e->getMessage(),
                'applied' => [],
                'pending' => [],
                'total' => 0
            ];
        }
    }

    public static function runPending(?PDO $customDb = null): array {
        $db = $customDb ?: Database::getConnection();
        self::initMigrationTable($db);

        $applied = self::getAppliedMigrations($db);
        $files = self::getMigrationFiles();
        $newlyApplied = [];

        foreach ($files as $version => $filePath) {
            if (in_array($version, $applied, true)) {
                continue;
            }

            $sql = file_get_contents($filePath);
            if (empty(trim($sql))) {
                continue;
            }

            $statements = self::parseSqlStatements($sql);

            foreach ($statements as $statement) {
                if (!empty($statement)) {
                    try {
                        $db->exec($statement);
                    } catch (Throwable $e) {
                        throw new RuntimeException(
                            "Database migration failed in '{$version}': " . $e->getMessage() . "\nFailed Query:\n" . $statement,
                            (int)$e->getCode(),
                            $e
                        );
                    }
                }
            }

            $recordStmt = $db->prepare("INSERT INTO schema_migrations (version) VALUES (:v)");
            $recordStmt->execute(['v' => $version]);
            $newlyApplied[] = $version;
        }

        return [
            'success' => true,
            'newly_applied' => $newlyApplied,
            'total_applied' => count($applied) + count($newlyApplied)
        ];
    }
}
