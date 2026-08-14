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

    public static function streamSubtitle(string $episodeId, $trackNum = 0): void {
        $ep = DbHelper::getEpisode($episodeId);
        if (!$ep || empty($ep['filepath']) || !file_exists($ep['filepath'])) {
            @header('Content-Type: text/vtt; charset=utf-8');
            echo "WEBVTT\n\n";
            if (defined('TESTING_MODE')) throw new ExitException("Subtitle not found", 404);
            exit();
        }

        $filepath = $ep['filepath'];
        // Check if external .vtt or .srt exists next to file
        $baseNoExt = preg_replace('/\.[^.]+$/', '', $filepath);
        $vttCandidate = $baseNoExt . '.vtt';
        $srtCandidate = $baseNoExt . '.srt';

        if (file_exists($vttCandidate)) {
            @header('Content-Type: text/vtt; charset=utf-8');
            readfile($vttCandidate);
            if (defined('TESTING_MODE')) throw new ExitException("VTT delivered", 200);
            exit();
        }

        // Extract subtitle track to WebVTT via ffmpeg
        $trackIndex = (int)$trackNum;
        $cmd = sprintf('ffmpeg -y -v error -i %s -map 0:s:%d? -f webvtt -', escapeshellarg($filepath), $trackIndex);
        $vttOutput = @shell_exec($cmd);

        @header('Content-Type: text/vtt; charset=utf-8');
        if (!empty($vttOutput) && str_starts_with(trim($vttOutput), 'WEBVTT')) {
            echo $vttOutput;
        } else {
            echo "WEBVTT\n\n";
        }

        if (defined('TESTING_MODE')) throw new ExitException("Subtitle stream success", 200);
        exit();
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
            @http_response_code(404);
            echo "Video file not specified or episode not found";
            if (defined('TESTING_MODE')) throw new ExitException("Video file not specified", 404);
            exit();
        }

        // Security check: validate file path traversal strictly against LIBRARY_DIR
        $realPath = realpath($filepath);
        $realLibrary = realpath(LIBRARY_DIR);

        if (!$realPath || !file_exists($realPath) || !is_file($realPath)) {
            @http_response_code(404);
            echo "Video file not found";
            if (defined('TESTING_MODE')) throw new ExitException("Video file not found", 404);
            exit();
        }

        // Ensure the path is strictly within the library directory
        $libraryPrefix = rtrim($realLibrary, '/\\') . DIRECTORY_SEPARATOR;
        if (!$realLibrary || ($realPath !== $realLibrary && !str_starts_with($realPath, $libraryPrefix))) {
            @http_response_code(403);
            echo "Access denied: File must reside within the library directory";
            if (defined('TESTING_MODE')) throw new ExitException("Access denied: File must reside within the library directory", 403);
            exit();
        }

        $fileSize = filesize($realPath);
        $offset = 0;
        $length = $fileSize;
        $isPartial = false;

        if (isset($_SERVER['HTTP_RANGE']) && preg_match('/bytes=(\d+)-(\d+)?/', $_SERVER['HTTP_RANGE'], $matches)) {
            $startRange = intval($matches[1]);
            $endRange = isset($matches[2]) && !empty($matches[2]) ? intval($matches[2]) : ($fileSize - 1);

            if ($startRange <= $endRange && $startRange < $fileSize) {
                $offset = $startRange;
                $end = min($endRange, $fileSize - 1);
                $length = $end - $offset + 1;
                $isPartial = true;

                @header('HTTP/1.1 206 Partial Content');
                @header("Content-Range: bytes {$offset}-{$end}/{$fileSize}");
            } else {
                @http_response_code(416);
                @header('HTTP/1.1 416 Requested Range Not Satisfiable');
                @header("Content-Range: bytes */{$fileSize}");
                if (defined('TESTING_MODE')) throw new ExitException("416 Range Not Satisfiable", 416);
                exit();
            }
        } else {
            @header('HTTP/1.1 200 OK');
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

        @header("Content-Type: {$mime}");
        @header('Accept-Ranges: bytes');
        @header("Content-Length: {$length}");

        if (defined('TESTING_MODE')) {
            throw new ExitException("Stream success", $isPartial ? 206 : 200);
        }

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
