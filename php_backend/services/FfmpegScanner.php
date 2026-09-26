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

    public static function executeBoundedCommand(string $cmd, int $timeoutSeconds = 15): ?string {
        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w']
        ];

        $process = @proc_open($cmd, $descriptors, $pipes);
        if (!is_resource($process)) {
            return null;
        }

        fclose($pipes[0]);
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);

        $stdout = '';
        $stderr = '';
        $startTime = microtime(true);

        while (true) {
            $read = [$pipes[1], $pipes[2]];
            $write = null;
            $except = null;
            $changed = @stream_select($read, $write, $except, 0, 100000); // 100ms

            if ($changed > 0) {
                foreach ($read as $r) {
                    if ($r === $pipes[1]) {
                        $chunk = fread($pipes[1], 8192);
                        if ($chunk !== false) $stdout .= $chunk;
                    } elseif ($r === $pipes[2]) {
                        $chunk = fread($pipes[2], 8192);
                        if ($chunk !== false) $stderr .= $chunk;
                    }
                }
            }

            $status = proc_get_status($process);
            if (!$status['running']) {
                $remOut = stream_get_contents($pipes[1]);
                if ($remOut !== false) $stdout .= $remOut;
                $remErr = stream_get_contents($pipes[2]);
                if ($remErr !== false) $stderr .= $remErr;
                break;
            }

            if ((microtime(true) - $startTime) > $timeoutSeconds) {
                @proc_terminate($process, 9);
                fclose($pipes[1]);
                fclose($pipes[2]);
                proc_close($process);
                error_log("[FfmpegScanner] Proceso excedió el tiempo límite ({$timeoutSeconds}s): {$cmd}");
                return null;
            }
        }

        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($process);

        return $stdout;
    }

    public static function probeVideo(string $filepath, int $timeoutSeconds = 15): array {
        $cmd = sprintf(
            'ffprobe -v quiet -print_format json -show_format -show_streams %s',
            escapeshellarg($filepath)
        );

        $output = self::executeBoundedCommand($cmd, $timeoutSeconds);
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

    public static function extractThumbnail(string $videoPath, string $destThumbPath, float $seekSeconds = 120, int $timeoutSeconds = 15): bool {
        if (file_exists($destThumbPath) && filesize($destThumbPath) > 0) return true;
        $dir = dirname($destThumbPath);
        if (!is_dir($dir)) @mkdir($dir, 0755, true);

        $cmd = sprintf(
            'ffmpeg -y -ss %f -i %s -vframes 1 -q:v 2 %s',
            $seekSeconds,
            escapeshellarg($videoPath),
            escapeshellarg($destThumbPath)
        );
        self::executeBoundedCommand($cmd, $timeoutSeconds);
        return file_exists($destThumbPath) && filesize($destThumbPath) > 0;
    }
}
