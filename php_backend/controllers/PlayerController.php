<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';

class PlayerController {
    public static function getEpisodeDetails(string $id): void {
        $ep = DbHelper::getEpisode($id);
        if (!$ep) {
            jsonError('Episodio no encontrado', 404);
        }
        $ep['stream_url'] = "/api/stream?filepath=" . urlencode($ep['filepath']);
        jsonResponse($ep);
    }

    public static function saveTimestamps(string $id): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $success = DbHelper::saveEpisodeTimestamps($id, $data);
        if (!$success) {
            jsonError('Episodio no encontrado', 404);
        }

        jsonResponse(['success' => true]);
    }

    public static function streamVideo(?string $episodeId = null): void {
        $filepath = $_GET['filepath'] ?? '';

        // If episode ID is provided (e.g. GET /api/stream/{episodeId}), fetch filepath from DB
        if (!empty($episodeId) && empty($filepath)) {
            $ep = DbHelper::getEpisode($episodeId);
            if ($ep && !empty($ep['filepath'])) {
                $filepath = $ep['filepath'];
            }
        }

        if (empty($filepath)) {
            http_response_code(404);
            echo "Video file not specified or episode not found";
            exit();
        }

        // Security check: validate file path traversal
        $realPath = realpath($filepath);
        $realRoot = realpath(ROOT_DIR);
        $realLibrary = realpath(LIBRARY_DIR);

        if (!$realPath || !file_exists($realPath) || !is_file($realPath)) {
            http_response_code(404);
            echo "Video file not found";
            exit();
        }

        // Ensure the path is within the project root directory
        if ($realRoot && !str_starts_with($realPath, $realRoot)) {
            http_response_code(403);
            echo "Access denied: Invalid file path";
            exit();
        }

        $fileSize = filesize($realPath);
        $offset = 0;
        $length = $fileSize;

        if (isset($_SERVER['HTTP_RANGE'])) {
            preg_match('/bytes=(\d+)-(\d+)?/', $_SERVER['HTTP_RANGE'], $matches);
            $offset = intval($matches[1]);
            if (isset($matches[2]) && !empty($matches[2])) {
                $end = intval($matches[2]);
            } else {
                $end = $fileSize - 1;
            }
            $length = $end - $offset + 1;

            header('HTTP/1.1 206 Partial Content');
            header("Content-Range: bytes {$offset}-{$end}/{$fileSize}");
        } else {
            header('HTTP/1.1 200 OK');
        }

        // Detect correct video MIME type
        $ext = strtolower(pathinfo($realPath, PATHINFO_EXTENSION));
        $mimeTypes = [
            'mp4' => 'video/mp4',
            'mkv' => 'video/x-matroska',
            'webm' => 'video/webm',
            'avi' => 'video/x-msvideo',
            'mov' => 'video/quicktime',
            'm4v' => 'video/mp4'
        ];
        $mime = $mimeTypes[$ext] ?? (@mime_content_type($realPath) ?: 'video/mp4');

        header("Content-Type: {$mime}");
        header('Accept-Ranges: bytes');
        header("Content-Length: {$length}");

        $fp = fopen($realPath, 'rb');
        fseek($fp, $offset);

        $bufferSize = 1024 * 64; // 64KB chunks
        while (!feof($fp) && $length > 0) {
            $readSize = min($bufferSize, $length);
            $buffer = fread($fp, $readSize);
            echo $buffer;
            flush();
            $length -= $readSize;
        }
        fclose($fp);
        exit();
    }
}
