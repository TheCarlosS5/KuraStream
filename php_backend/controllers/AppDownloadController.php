<?php
require_once __DIR__ . '/../config.php';

/**
 * Public download of the Android app. The APK is not secret and has to be reachable before an
 * account exists (the app is installed first, then it connects to this server).
 */
class AppDownloadController {
    private const DOWNLOAD_NAME = 'KuraStream.apk';

    public static function apkPath(): string {
        $configured = getenv('ANDROID_APK_PATH');
        if ($configured) {
            return $configured;
        }
        // KuraStream.apk is the signed release build; the debug name is kept for servers set up before it existed.
        foreach (['KuraStream.apk', 'KuraStream-debug.apk'] as $name) {
            if (is_file(ROOT_DIR . '/' . $name)) {
                return ROOT_DIR . '/' . $name;
            }
        }
        return ROOT_DIR . '/KuraStream.apk';
    }

    /** versionName from the Android Gradle script shipped next to the server, if present. */
    private static function versionName(): ?string {
        return self::gradleValue('/versionName\s*=\s*"([^"]+)"/');
    }

    private static function versionCode(): ?int {
        $value = self::gradleValue('/versionCode\s*=\s*(\d+)/');
        return $value !== null ? (int)$value : null;
    }

    private static function gradleValue(string $pattern): ?string {
        $gradle = ROOT_DIR . '/android/app/build.gradle.kts';
        if (!is_readable($gradle)) {
            return null;
        }
        return preg_match($pattern, (string)file_get_contents($gradle), $m) ? $m[1] : null;
    }

    /**
     * Release facts written next to the APK by the build (scripts/generate_app_release.mjs): version name/code,
     * build variant and notes. Every field is validated and anything unexpected is ignored; the checksum is never
     * taken from here (see fileSha256()), so a stale or edited file cannot vouch for a different APK.
     */
    public static function releaseMetadata(string $apkPath): array {
        $file = getenv('ANDROID_APP_RELEASE_JSON') ?: dirname($apkPath) . '/app-release.json';
        if (!is_file($file) || !is_readable($file) || filesize($file) > 65536) {
            return [];
        }
        $raw = json_decode((string)file_get_contents($file), true);
        if (!is_array($raw)) {
            return [];
        }
        $meta = [];
        if (isset($raw['version_name']) && is_string($raw['version_name']) && preg_match('/^[0-9A-Za-z.+_-]{1,32}$/', $raw['version_name'])) {
            $meta['version_name'] = $raw['version_name'];
        }
        if (isset($raw['version_code']) && is_int($raw['version_code']) && $raw['version_code'] > 0) {
            $meta['version_code'] = $raw['version_code'];
        }
        if (isset($raw['variant']) && in_array($raw['variant'], ['release', 'debug'], true)) {
            $meta['variant'] = $raw['variant'];
        }
        if (isset($raw['notes']) && is_string($raw['notes'])) {
            $meta['notes'] = mb_substr(trim(strip_tags($raw['notes'])), 0, 1000, 'UTF-8');
        }
        return $meta;
    }

    /** SHA-256 of the APK that is actually served, cached by size and modification time. */
    public static function fileSha256(string $path): string {
        $size = filesize($path);
        $mtime = filemtime($path);
        $cacheFile = sys_get_temp_dir() . '/kura_apk_sha_' . md5($path) . '.json';
        $cached = is_file($cacheFile) ? json_decode((string)@file_get_contents($cacheFile), true) : null;
        if (is_array($cached) && ($cached['size'] ?? null) === $size && ($cached['mtime'] ?? null) === $mtime && !empty($cached['sha256'])) {
            return $cached['sha256'];
        }
        $sha = hash_file('sha256', $path) ?: '';
        if ($sha !== '') {
            @file_put_contents($cacheFile, json_encode(['size' => $size, 'mtime' => $mtime, 'sha256' => $sha]));
        }
        return $sha;
    }

    public static function info(): void {
        $path = self::apkPath();
        if (!is_file($path) || !is_readable($path)) {
            jsonResponse(['success' => true, 'available' => false]);
        }
        $meta = self::releaseMetadata($path);
        jsonResponse([
            'success' => true,
            'available' => true,
            'version' => $meta['version_name'] ?? self::versionName(),
            'version_code' => $meta['version_code'] ?? self::versionCode(),
            'variant' => $meta['variant'] ?? null,
            'notes' => $meta['notes'] ?? null,
            'sha256' => self::fileSha256($path),
            'size_bytes' => filesize($path),
            'updated_at' => date('c', filemtime($path)),
            'download_url' => '/api/app/android/download',
        ]);
    }

    public static function download(string $method): void {
        $path = self::apkPath();
        if (!is_file($path) || !is_readable($path)) {
            jsonError('La app de Android no está disponible en este servidor', 404);
        }

        $size = filesize($path);
        $mtime = filemtime($path);
        $etag = '"' . dechex($mtime) . '-' . dechex($size) . '"';

        header('Content-Type: application/vnd.android.package-archive');
        header('Content-Disposition: attachment; filename="' . self::DOWNLOAD_NAME . '"');
        header('Content-Length: ' . $size);
        header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
        header('ETag: ' . $etag);
        header('Cache-Control: no-cache');
        // Lets the installer (or a careful user) check the file against the value shown on the download page.
        $sha = self::fileSha256($path);
        if ($sha !== '') {
            header('X-Content-SHA256: ' . $sha);
        }

        if ($method === 'HEAD') {
            exit();
        }
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        readfile($path);
        exit();
    }
}
