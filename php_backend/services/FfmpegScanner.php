<?php
require_once __DIR__ . '/../config.php';

class FfmpegScanner {
    public static function probeVideo(string $filepath): array {
        $cmd = sprintf(
            'ffprobe -v quiet -print_format json -show_format -show_streams %s',
            escapeshellarg($filepath)
        );

        $output = shell_exec($cmd);
        if (!$output) {
            return [
                'duration' => 0,
                'resolution' => '1080p',
                'video_codec' => 'h264',
                'fps' => 24.0,
                'audio_tracks' => [],
                'subtitle_tracks' => []
            ];
        }

        $data = json_decode($output, true) ?: [];
        $format = $data['format'] ?? [];
        $streams = $data['streams'] ?? [];

        $duration = (float)($format['duration'] ?? 0);
        $videoStreams = array_values(array_filter($streams, function($s) {
            if (($s['codec_type'] ?? '') !== 'video') return false;
            if (isset($s['disposition']['attached_pic']) && $s['disposition']['attached_pic'] == 1) return false;
            return true;
        }));
        $videoStream = $videoStreams[0] ?? array_values(array_filter($streams, fn($s) => ($s['codec_type'] ?? '') === 'video'))[0] ?? [];
        
        $height = $videoStream['height'] ?? 1080;
        $resolution = "{$height}p";
        $videoCodec = $videoStream['codec_name'] ?? 'h264';
        
        $fps = 24.0;
        if (!empty($videoStream['r_frame_rate'])) {
            $parts = explode('/', $videoStream['r_frame_rate']);
            if (count($parts) === 2 && (float)$parts[1] > 0) {
                $fps = round((float)$parts[0] / (float)$parts[1], 3);
            } else {
                $fps = (float)$videoStream['r_frame_rate'] ?: 24.0;
            }
        }
        
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
                    'codec' => $s['codec_name'] ?? 'aac',
                    'language' => $lang,
                    'title' => $title
                ];
                $audioIdx++;
            } else if ($type === 'subtitle') {
                $subtitleTracks[] = [
                    'index' => $s['index'] ?? $subIdx,
                    'codec' => $s['codec_name'] ?? 'ass',
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
            'fps' => 24.0,
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
