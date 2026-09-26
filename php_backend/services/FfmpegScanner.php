<?php
require_once __DIR__ . '/../config.php';

class FfmpegScanner {
    public static function parseFrameRate(?string $value): float {
        if ($value === null) return 0.0;
        $value = trim($value);
        if ($value === '') return 0.0;

        if (!preg_match('/^([+]?(?:\d+(?:\.\d*)?|\.\d+))(?:\/([+]?(?:\d+(?:\.\d*)?|\.\d+)))?$/', $value, $matches)) {
            return 0.0;
        }

        $numerator = (float)$matches[1];
        $denominator = isset($matches[2]) ? (float)$matches[2] : 1.0;
        if ($numerator <= 0 || $denominator <= 0) return 0.0;

        $fps = $numerator / $denominator;
        if (!is_finite($fps) || $fps <= 0) return 0.0;

        $fps = round($fps, 3);
        return $fps > 0 ? $fps : 0.0;
    }

    public static function probeVideo(string $filepath): array {
        $cmd = sprintf(
            'ffprobe -v quiet -print_format json -show_format -show_streams %s',
            escapeshellarg($filepath)
        );

        $output = shell_exec($cmd);
        if (!$output) {
            throw new RuntimeException("FFprobe error: No se pudo leer el archivo multimedia o ffprobe fallo para: " . basename($filepath));
        }

        $data = json_decode($output, true);
        if (!is_array($data)) {
            throw new RuntimeException("FFprobe error: Respuesta JSON invalida para: " . basename($filepath));
        }

        $format = $data['format'] ?? [];
        $streams = $data['streams'] ?? [];

        $duration = (float)($format['duration'] ?? 0);
        $videoStreams = array_values(array_filter($streams, function($s) {
            if (($s['codec_type'] ?? '') !== 'video') return false;
            if (isset($s['disposition']['attached_pic']) && $s['disposition']['attached_pic'] == 1) return false;
            return true;
        }));
        
        if (empty($videoStreams)) {
            throw new RuntimeException("FFprobe error: No se encontro ningun flujo de video en: " . basename($filepath));
        }
        $videoStream = $videoStreams[0];
        
        $height = isset($videoStream['height']) ? (int)$videoStream['height'] : 0;
        $resolution = $height > 0 ? "{$height}p" : 'unknown';
        $videoCodec = (string)($videoStream['codec_name'] ?? 'unknown');
        
        $fps = self::parseFrameRate((string)($videoStream['r_frame_rate'] ?? ''));
        
        $audioTracks = [];
        $subtitleTracks = [];
        $audioIdx = 0;
        $subIdx = 0;

        foreach ($streams as $s) {
            $type = $s['codec_type'] ?? '';
            $tags = $s['tags'] ?? [];
            $lang = $tags['language'] ?? 'und';
            $title = $tags['title'] ?? ($lang !== 'und' ? strtoupper($lang) : "Pista " . ($type === 'audio' ? $audioIdx + 1 : $subIdx + 1));

            if ($type === 'audio') {
                $audioTracks[] = [
                    'index' => $s['index'] ?? $audioIdx,
                    'codec' => $s['codec_name'] ?? 'unknown',
                    'language' => $lang,
                    'title' => $title
                ];
                $audioIdx++;
            } else if ($type === 'subtitle') {
                $subtitleTracks[] = [
                    'index' => $s['index'] ?? $subIdx,
                    'codec' => $s['codec_name'] ?? 'unknown',
                    'language' => $lang,
                    'title' => $title
                ];
                $subIdx++;
            }
        }

        return [
            'duration' => $duration,
            'resolution' => $resolution,
            'video_codec' => $videoCodec,
            'fps' => $fps,
            'audio_tracks' => $audioTracks,
            'subtitle_tracks' => $subtitleTracks
        ];
    }

    public static function extractThumbnail(string $videoPath, string $destThumbPath, float $seekSeconds = 120): bool {
        if (file_exists($destThumbPath) && filesize($destThumbPath) > 0) return true;
        $dir = dirname($destThumbPath);
        if (!is_dir($dir)) @mkdir($dir, 0755, true);

        $cmd = sprintf(
            'ffmpeg -y -ss %f -i %s -vframes 1 -q:v 2 %s 2>/dev/null',
            $seekSeconds,
            escapeshellarg($videoPath),
            escapeshellarg($destThumbPath)
        );
        @shell_exec($cmd);
        return file_exists($destThumbPath) && filesize($destThumbPath) > 0;
    }
}
