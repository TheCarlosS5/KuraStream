<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';

class PlayerController {
    public static function getEpisodeDetails(string $id): void {
        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM episodes WHERE id = :id");
        $stmt->execute(['id' => $id]);
        $ep = $stmt->fetch();

        if (!$ep) {
            jsonError('Episodio no encontrado', 404);
        }

        $ep['audio_tracks'] = !empty($ep['audio_tracks']) ? json_decode($ep['audio_tracks'], true) : [];
        $ep['subtitle_tracks'] = !empty($ep['subtitle_tracks']) ? json_decode($ep['subtitle_tracks'], true) : [];
        $ep['chapters'] = !empty($ep['chapters']) ? json_decode($ep['chapters'], true) : [];
        $ep['stream_url'] = "/api/stream?filepath=" . urlencode($ep['filepath']);

        jsonResponse($ep);
    }

    public static function saveTimestamps(string $id): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM episodes WHERE id = :id");
        $stmt->execute(['id' => $id]);
        $ep = $stmt->fetch();
        if (!$ep) {
            jsonError('Episodio no encontrado', 404);
        }

        DbHelper::saveEpisodeTimestamps($id, $data);
        jsonResponse(['success' => true]);
    }

    public static function streamVideo(): void {
        $filepath = $_GET['filepath'] ?? '';
        if (empty($filepath) || !file_exists($filepath)) {
            http_response_code(404);
            echo "Video file not found";
            exit();
        }

        $fileSize = filesize($filepath);
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

        header('Content-Type: video/mp4');
        header('Accept-Ranges: bytes');
        header("Content-Length: {$length}");

        $fp = fopen($filepath, 'rb');
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
