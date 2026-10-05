<?php
require_once __DIR__ . '/../config.php';

/**
 * Database backups with mysqldump (user data: accounts, profiles, history, favourites, comments, settings).
 * The media library itself is not part of it. Files are written atomically (temp name, then rename) and only
 * the newest BACKUP_KEEP (default 7) are kept.
 */
class BackupService {
    public static function directory(): string {
        $dir = getenv('BACKUP_DIR');
        return ($dir !== false && $dir !== '') ? rtrim($dir, '/\\') : dirname(__DIR__, 2) . '/backups';
    }

    public static function keep(): int {
        $n = (int)(getenv('BACKUP_KEEP') ?: 7);
        return max(1, min(60, $n));
    }

    public static function isAvailable(): bool {
        $out = [];
        @exec('command -v mysqldump 2>/dev/null || command -v mariadb-dump 2>/dev/null', $out);
        return !empty($out);
    }

    private static function binary(): ?string {
        $out = [];
        @exec('command -v mysqldump 2>/dev/null || command -v mariadb-dump 2>/dev/null', $out);
        return $out[0] ?? null;
    }

    /** @return array{file:string, size:int, removed:int} */
    public static function run(): array {
        $bin = self::binary();
        if ($bin === null) {
            throw new RuntimeException('mysqldump no está instalado en el servidor');
        }
        $dir = self::directory();
        if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) {
            throw new RuntimeException('No se pudo crear la carpeta de respaldos: ' . $dir);
        }
        $name = 'kurastream-' . date('Ymd-His') . '.sql.gz';
        $final = $dir . '/' . $name;
        $tmp = $final . '.part';

        $cmd = [$bin, '--single-transaction', '--quick', '--no-tablespaces', '--skip-lock-tables',
            '-h', DB_HOST, '-P', (string)DB_PORT, '-u', DB_USER, DB_NAME];
        $env = array_merge(getenv() ?: [], ['MYSQL_PWD' => (string)DB_PASS]);
        $proc = @proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $env);
        if (!is_resource($proc)) {
            throw new RuntimeException('No se pudo ejecutar mysqldump');
        }
        $gz = gzopen($tmp, 'wb6');
        if (!$gz) {
            proc_close($proc);
            throw new RuntimeException('No se pudo escribir el respaldo');
        }
        stream_set_blocking($pipes[2], false);
        $stderr = '';
        while (!feof($pipes[1])) {
            $chunk = fread($pipes[1], 65536);
            if ($chunk !== false && $chunk !== '') gzwrite($gz, $chunk);
            $stderr .= (string)fread($pipes[2], 4096);
        }
        $stderr .= (string)stream_get_contents($pipes[2]);
        gzclose($gz);
        fclose($pipes[1]); fclose($pipes[2]);
        $code = proc_close($proc);
        if ($code !== 0) {
            @unlink($tmp);
            throw new RuntimeException('mysqldump falló (' . $code . '): ' . trim(mb_substr($stderr, 0, 300)));
        }
        @chmod($tmp, 0640);
        if (!@rename($tmp, $final)) {
            @unlink($tmp);
            throw new RuntimeException('No se pudo finalizar el respaldo');
        }
        return ['file' => $name, 'size' => (int)@filesize($final), 'removed' => self::prune()];
    }

    /** @return array<int, array{file:string,size:int,modified:int}> newest first */
    public static function list(): array {
        $files = glob(self::directory() . '/kurastream-*.sql.gz') ?: [];
        rsort($files);
        return array_map(fn($f) => ['file' => basename($f), 'size' => (int)@filesize($f), 'modified' => (int)@filemtime($f)], $files);
    }

    /** Resolves a backup name from the listing to its path (never anything outside the backup folder). */
    public static function path(string $name): ?string {
        if (!preg_match('/^kurastream-\d{8}-\d{6}\.sql\.gz$/', $name)) return null;
        $path = self::directory() . '/' . $name;
        return is_file($path) ? $path : null;
    }

    public static function prune(): int {
        $removed = 0;
        foreach (array_slice(self::list(), self::keep()) as $old) {
            if (@unlink(self::directory() . '/' . $old['file'])) $removed++;
        }
        return $removed;
    }
}
