<?php
/**
 * KuraStream v2.0 - Database Migration Manager
 * Applies versioned SQL migrations idempotently and tracks schema version history.
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';

class MigrationManager {
    private static function initMigrationTable(PDO $db): void {
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

    public static function runPending(): array {
        $db = Database::getConnection();
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

            // Split into individual SQL statements separated by semicolon
            $statements = array_filter(
                array_map('trim', explode(';', $sql)),
                fn($s) => !empty($s) && !str_starts_with($s, '--')
            );

            foreach ($statements as $statement) {
                if (!empty($statement)) {
                    $db->exec($statement);
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
