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
     * Splits a migration file into statements. A real scanner, not explode(';'): semicolons inside quoted strings,
     * backtick identifiers and comments do not end a statement, and `--`, `#` and block comments are dropped
     * (MySQL's executable `/*! ... *\/` comments are kept).
     */
    public static function parseSqlStatements(string $sql): array {
        return array_column(self::parseSqlStatementsDetailed($sql), 'sql');
    }

    /**
     * Like parseSqlStatements, but says which statements are `optional`: a `-- @optional` comment line right before a
     * statement means a failure of that statement (say a foreign key that cannot be added to a database imported from
     * a dump with different collations) is logged and skipped instead of failing the whole migration.
     * @return array<int, array{sql: string, optional: bool}>
     */
    public static function parseSqlStatementsDetailed(string $sql): array {
        $statements = [];
        $optionalNext = false;
        $current = '';
        $len = strlen($sql);
        for ($i = 0; $i < $len; $i++) {
            $c = $sql[$i];
            $next = $i + 1 < $len ? $sql[$i + 1] : '';

            if ($c === "'" || $c === '"' || $c === '`') {
                $quote = $c;
                $current .= $c;
                for ($i++; $i < $len; $i++) {
                    $ch = $sql[$i];
                    $current .= $ch;
                    if ($ch === '\\' && $quote !== '`' && $i + 1 < $len) {   // backslash escape inside a string
                        $current .= $sql[++$i];
                        continue;
                    }
                    if ($ch === $quote) {
                        if ($i + 1 < $len && $sql[$i + 1] === $quote) {      // doubled quote = literal quote
                            $current .= $sql[++$i];
                            continue;
                        }
                        break;
                    }
                }
                continue;
            }
            if (($c === '-' && $next === '-' && ($i + 2 >= $len || ctype_space($sql[$i + 2]))) || $c === '#') {
                $start = $i;
                while ($i < $len && $sql[$i] !== "\n") $i++;
                if (trim($current) === '' && preg_match('/^(?:--|#)\s*@optional\s*$/', trim(substr($sql, $start, $i - $start)))) {
                    $optionalNext = true;
                }
                $current .= "\n";
                continue;
            }
            if ($c === '/' && $next === '*' && ($i + 2 >= $len || $sql[$i + 2] !== '!')) {
                $end = strpos($sql, '*/', $i + 2);
                $i = $end === false ? $len : $end + 1;
                $current .= ' ';
                continue;
            }
            if ($c === ';') {
                $trimmed = trim($current);
                if ($trimmed !== '') {
                    $statements[] = ['sql' => $trimmed, 'optional' => $optionalNext];
                    $optionalNext = false;
                }
                $current = '';
                continue;
            }
            $current .= $c;
        }
        $trimmed = trim($current);
        if ($trimmed !== '') $statements[] = ['sql' => $trimmed, 'optional' => $optionalNext];
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

    public static function preflightMigration004(PDO $db): void {
        $driver = $db->getAttribute(PDO::ATTR_DRIVER_NAME);
        if ($driver === 'sqlite') {
            $check = $db->query("SELECT name FROM sqlite_master WHERE type='table' AND name='user_profiles'")->fetch();
        } else {
            $check = $db->query("SHOW TABLES LIKE 'user_profiles'")->fetch();
        }
        if (!$check) {
            return;
        }

        $dupStmt = $db->query("
            SELECT username, name, COUNT(*) as cnt 
            FROM user_profiles 
            GROUP BY username, name 
            HAVING cnt > 1
        ");
        $duplicates = $dupStmt->fetchAll(PDO::FETCH_ASSOC);

        if (!empty($duplicates)) {
            $details = [];
            foreach ($duplicates as $dup) {
                $details[] = "- Usuario: '{$dup['username']}', Perfil: '{$dup['name']}' ({$dup['cnt']} registros)";
            }
            $errorMsg = "Preflight Migration 004 Error:\n"
                . "Se detectaron perfiles duplicados en la base de datos previa a la aplicación de UNIQUE(username, name):\n"
                . implode("\n", $details) . "\n"
                . "Resolución: Debe fusionar o renombrar manualmente los perfiles duplicados en la tabla 'user_profiles' antes de continuar con la migración para evitar corrupción o pérdida silenciosa de datos.";
            throw new RuntimeException($errorMsg);
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

            if ($version === '004_security_profile_party_hardening.sql') {
                self::preflightMigration004($db);
            }

            $sql = file_get_contents($filePath);
            if (empty(trim($sql))) {
                continue;
            }

            $statements = self::parseSqlStatementsDetailed($sql);

            foreach ($statements as ['sql' => $statement, 'optional' => $optional]) {
                if (!empty($statement)) {
                    try {
                        $db->exec($statement);
                    } catch (Throwable $e) {
                        if ($optional) {
                            error_log("KuraStream migration {$version}: optional statement skipped: " . $e->getMessage());
                            continue;
                        }
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
