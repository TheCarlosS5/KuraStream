<?php
require_once __DIR__ . '/../config.php';

/**
 * Public download of the Android app. The APK is not secret and has to be reachable before an
 * account exists (the app is installed first, then it connects to this server).
 */
class AppDownloadController {
    private const DOWNLOAD_NAME = 'KuraStream.apk';

    public static function apkPath(): string {
        return getenv('ANDROID_APK_PATH') ?: ROOT_DIR . '/KuraStream-debug.apk';
    }

    /** versionName from the Android Gradle script shipped next to the server, if present. */
    private static function versionName(): ?string {
        $gradle = ROOT_DIR . '/android/app/build.gradle.kts';
        if (!is_readable($gradle)) {
            return null;
        }
        if (preg_match('/versionName\s*=\s*"([^"]+)"/', (string)file_get_contents($gradle), $m)) {
            return $m[1];
        }
        return null;
    }

    public static function info(): void {
        $path = self::apkPath();
        if (!is_file($path) || !is_readable($path)) {
            jsonResponse(['success' => true, 'available' => false]);
        }
        jsonResponse([
            'success' => true,
            'available' => true,
            'version' => self::versionName(),
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
