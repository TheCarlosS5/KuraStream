<?php
require_once __DIR__ . '/../config.php';

/**
 * Single place that knows how a show maps to a folder inside LIBRARY_DIR.
 *
 * Show ids reach the filesystem from URLs and form fields. An id such as "." or "..%2FMovies"
 * (decoded to "../Movies") would otherwise resolve to a whole category directory, so every path
 * is built from a validated single path segment and deletions never follow symlinks.
 */
class LibraryPaths {
    /** True when $name is a plain, single directory name (no separators, traversal or control chars). */
    public static function isSafeSegment($name): bool {
        if (!is_string($name) || $name === '' || strlen($name) > 255) {
            return false;
        }
        if ($name === '.' || $name === '..') {
            return false;
        }
        return preg_match('/[\x00-\x1f\x7f\/\\\\]/', $name) !== 1;
    }

    public static function categoryFolder(?string $mediaType): string {
        return $mediaType === 'movie' ? 'Movies' : 'Anime';
    }

    /** LIBRARY_DIR/<Anime|Movies>/<id>, or null when the id is not a safe segment. */
    public static function showDir(?string $mediaType, $showId): ?string {
        if (!self::isSafeSegment($showId)) {
            return null;
        }
        return LIBRARY_DIR . '/' . self::categoryFolder($mediaType) . '/' . $showId;
    }

    /**
     * The real path of an existing show folder, only when it is a direct child of its category
     * folder (so it can never be the category itself, the library root or anything outside).
     */
    public static function resolveExistingShowDir(?string $mediaType, $showId): ?string {
        $dir = self::showDir($mediaType, $showId);
        if ($dir === null) {
            return null;
        }
        $real = realpath($dir);
        $category = realpath(LIBRARY_DIR . '/' . self::categoryFolder($mediaType));
        if ($real === false || $category === false || !is_dir($real)) {
            return null;
        }
        return dirname($real) === $category ? $real : null;
    }

    /** Recursively removes a directory without ever following symlinks (a link is removed, not its target). */
    public static function deleteTree(string $path): bool {
        if (is_link($path)) {
            return @unlink($path) || @rmdir($path);
        }
        if (!is_dir($path)) {
            return false;
        }
        $ok = true;
        foreach (array_diff(scandir($path) ?: [], ['.', '..']) as $entry) {
            $child = $path . DIRECTORY_SEPARATOR . $entry;
            if (is_link($child) || !is_dir($child)) {
                $ok = (@unlink($child) || @rmdir($child)) && $ok;
            } else {
                $ok = self::deleteTree($child) && $ok;
            }
        }
        return @rmdir($path) && $ok;
    }
}
