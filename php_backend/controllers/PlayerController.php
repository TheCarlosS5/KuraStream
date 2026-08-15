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
            @header('Content-Type: text/plain; charset=utf-8');
            echo "";
            if (defined('TESTING_MODE')) throw new ExitException("Subtitle not found", 404);
            exit();
        }

        $filepath = $ep['filepath'];
        $trackIndex = -1;
        $tracks = !empty($ep['subtitle_tracks']) ? (is_array($ep['subtitle_tracks']) ? $ep['subtitle_tracks'] : json_decode($ep['subtitle_tracks'], true)) : [];
        if (is_array($tracks)) {
            $t = $tracks[(int)$trackNum] ?? null;
            if (!$t) {
                $t = array_values(array_filter($tracks, fn($x) => ($x['track_number'] ?? $x['index'] ?? -1) == (int)$trackNum))[0] ?? null;
            }
            if ($t && isset($t['index'])) {
                $trackIndex = (int)$t['index'];
            }
        }

        $mapArg = ($trackIndex !== -1) ? "-map 0:{$trackIndex}" : "-map 0:s:" . (int)$trackNum . "?";
        $cmd = sprintf('ffmpeg -y -v error -i %s %s -f ass -', escapeshellarg($filepath), $mapArg);

        @header('Content-Type: text/plain; charset=utf-8');
        @header('Access-Control-Allow-Origin: *');

        while (ob_get_level()) {
            ob_end_clean();
        }

        passthru($cmd);
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

        $ext = strtolower(pathinfo($realPath, PATHINFO_EXTENSION));
        $isMkv = ($ext === 'mkv');
        $start = isset($_GET['start']) ? (float)$_GET['start'] : 0.0;
        $audioTrack = isset($_GET['audio']) ? (int)$_GET['audio'] : -1;

        // If file is MKV (not supported natively by HTML5 video tag) or seek/audio track specified:
        if ($isMkv || $start > 0 || $audioTrack !== -1) {
            @header('Content-Type: video/mp4');
            @header('Accept-Ranges: none');
            @header('Connection: keep-alive');
            @header('Access-Control-Allow-Origin: *');
            @header('X-Content-Type-Options: nosniff');

            $cmd = 'ffmpeg -v error ';
            if ($start > 0) {
                $cmd .= '-noaccurate_seek -ss ' . escapeshellarg(strval($start)) . ' ';
            }
            $cmd .= '-i ' . escapeshellarg($realPath) . ' ';
            $cmd .= '-map 0:v:0 ';
            
            // Map selected audio track or default to first audio stream
            $mappedAudio = false;
            if ($audioTrack >= 0 && !empty($episodeId)) {
                $epData = DbHelper::getEpisode($episodeId);
                $tracks = !empty($epData['audio_tracks']) ? (is_array($epData['audio_tracks']) ? $epData['audio_tracks'] : json_decode($epData['audio_tracks'], true)) : [];
                $targetTrack = $tracks[$audioTrack] ?? null;
                if (!$targetTrack) {
                    $targetTrack = array_values(array_filter($tracks, fn($x) => ($x['track_number'] ?? $x['index'] ?? -1) == $audioTrack))[0] ?? null;
                }
                if ($targetTrack && isset($targetTrack['index'])) {
                    $cmd .= "-map 0:" . intval($targetTrack['index']) . "? ";
                    $mappedAudio = true;
                }
            }
            if (!$mappedAudio) {
                $cmd .= '-map 0:a:0? ';
            }

            // Remux video copy, audio aac for universal browser support, fast fragmented MP4 stream
            $cmd .= '-c:v copy -avoid_negative_ts make_zero -c:a aac -b:a 128k -af aresample=async=1 -f mp4 -movflags frag_keyframe+empty_moov+default_base_moof -';

            if (defined('TESTING_MODE')) {
                throw new ExitException("Stream remux success", 200);
            }

            while (ob_get_level()) {
                ob_end_clean();
            }

            // Stream chunks in real-time with immediate flushing to browser
            $fp = popen($cmd, 'r');
            if ($fp) {
                while (!feof($fp) && !connection_aborted()) {
                    $buffer = fread($fp, 65536);
                    if ($buffer !== false && strlen($buffer) > 0) {
                        echo $buffer;
                        flush();
                    }
                }
                pclose($fp);
            }
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
        $mimeTypes = [
            'mp4' => 'video/mp4',
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
