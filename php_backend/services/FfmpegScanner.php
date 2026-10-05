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

    /**
     * @param bool $mergeStderr false for binary stdout (raw PCM, images): stderr text would corrupt it.
     */
    public static function executeBoundedCommand(string $cmd, int $timeoutSeconds = 15, bool $mergeStderr = true): ?string {
        $cmdWithRedirect = $mergeStderr ? $cmd . ' 2>&1' : $cmd;
        $descriptors = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w']
        ];

        $process = @proc_open($cmdWithRedirect, $descriptors, $pipes);
        if (!is_resource($process)) {
            return null;
        }

        fclose($pipes[0]);
        stream_set_blocking($pipes[1], false);

        $stdout = '';
        $startTime = microtime(true);

        while (true) {
            $chunk = fread($pipes[1], 8192);
            if ($chunk !== false && strlen($chunk) > 0) {
                $stdout .= $chunk;
            }

            $status = proc_get_status($process);
            if (!$status['running']) {
                $remOut = stream_get_contents($pipes[1]);
                if ($remOut !== false) $stdout .= $remOut;
                break;
            }

            if ((microtime(true) - $startTime) > $timeoutSeconds) {
                @proc_terminate($process, 9);
                fclose($pipes[1]);
                proc_close($process);
                error_log("[FfmpegScanner] Proceso excedió el tiempo límite ({$timeoutSeconds}s): {$cmd}");
                return null;
            }

            usleep(10000); // 10ms
        }

        fclose($pipes[1]);
        proc_close($process);

        return $stdout;
    }

    public static function probeVideo(string $filepath, int $timeoutSeconds = 15): array {
        $cmd = sprintf(
            'ffprobe -v quiet -print_format json -show_format -show_streams -show_chapters %s',
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
        $attachments = [];
        $audioIdx = 0;
        $subIdx = 0;

        $bitmapCodecs = ['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub', 'pgssub'];

        foreach ($streams as $s) {
            $type = $s['codec_type'] ?? '';
            $tags = $s['tags'] ?? [];
            $lang = $tags['language'] ?? 'und';
            $title = $tags['title'] ?? ($lang !== 'und' ? strtoupper($lang) : "Pista " . ($type === 'audio' ? $audioIdx + 1 : $subIdx + 1));
            $isDefault = isset($s['disposition']['default']) && (int)$s['disposition']['default'] === 1;

            if ($type === 'audio') {
                $channels = isset($s['channels']) ? (int)$s['channels'] : 2;
                $channelLayout = $s['channel_layout'] ?? ($channels === 1 ? 'mono' : ($channels === 2 ? 'stereo' : "{$channels}ch"));
                $sampleRate = isset($s['sample_rate']) ? (int)$s['sample_rate'] : 44100;
                $bitRate = isset($s['bit_rate']) ? (int)$s['bit_rate'] : null;

                $audioTracks[] = [
                    'index' => $s['index'] ?? $audioIdx,
                    'track_number' => $audioIdx,
                    'codec' => $s['codec_name'] ?? 'unknown',
                    'language' => $lang,
                    'title' => $title,
                    'channels' => $channels,
                    'channel_layout' => $channelLayout,
                    'sample_rate' => $sampleRate,
                    'bit_rate' => $bitRate,
                    'disposition' => [
                        'default' => $isDefault
                    ]
                ];
                $audioIdx++;
            } else if ($type === 'subtitle') {
                $codecName = strtolower($s['codec_name'] ?? 'unknown');
                $isBitmap = in_array($codecName, $bitmapCodecs, true);

                $subtitleTracks[] = [
                    'index' => $s['index'] ?? $subIdx,
                    'track_number' => $subIdx,
                    'codec' => $codecName,
                    'language' => $lang,
                    'title' => $title,
                    'is_bitmap' => $isBitmap,
                    'disposition' => [
                        'default' => $isDefault
                    ]
                ];
                $subIdx++;
            } else if ($type === 'attachment') {
                $filename = $tags['filename'] ?? ($tags['FILENAME'] ?? '');
                if (!empty($filename)) {
                    $cleanFilename = preg_replace('/[^a-zA-Z0-9_\-\.]/', '', basename($filename));
                    $attachments[] = [
                        'index' => $s['index'] ?? null,
                        'filename' => $cleanFilename,
                        'mimetype' => $tags['mimetype'] ?? ($tags['MIMETYPE'] ?? ''),
                        'codec' => $s['codec_name'] ?? ''
                    ];
                }
            }
        }

        // Parse chapters
        $rawChapters = $data['chapters'] ?? [];
        $chapters = [];
        foreach ($rawChapters as $c) {
            $cTags = $c['tags'] ?? [];
            $chapTitle = $cTags['title'] ?? ($cTags['TITLE'] ?? 'Chapter ' . (count($chapters) + 1));
            $startTime = round((float)($c['start_time'] ?? 0.0), 3);
            $endTime = round((float)($c['end_time'] ?? 0.0), 3);
            $chapters[] = [
                'title' => trim($chapTitle),
                'start' => $startTime,
                'start_time' => $startTime,
                'end' => $endTime,
                'end_time' => $endTime
            ];
        }

        return [
            'duration' => $duration,
            'resolution' => $resolution,
            'video_codec' => $videoCodec,
            'fps' => $fps,
            'audio_tracks' => $audioTracks,
            'subtitle_tracks' => $subtitleTracks,
            'chapters' => $chapters,
            'attachments' => $attachments
        ];
    }

    public static function extractFonts(string $videoPath, string $destDir): array {
        if (!file_exists($videoPath) || !is_file($videoPath)) return [];
        if (!is_dir($destDir)) @mkdir($destDir, 0755, true);

        $cmd = sprintf(
            'ffmpeg -y -v error -dump_attachment:t "" -i %s',
            escapeshellarg($videoPath)
        );

        $cwd = getcwd();
        @chdir($destDir);
        self::executeBoundedCommand($cmd, 15);
        if ($cwd) @chdir($cwd);

        $extracted = [];
        if (is_dir($destDir)) {
            $files = glob($destDir . '/*.{ttf,otf,woff,woff2,TTF,OTF}', GLOB_BRACE) ?: [];
            foreach ($files as $f) {
                $base = basename($f);
                $clean = preg_replace('/[^a-zA-Z0-9_\-\.]/', '', $base);
                if ($clean !== $base) {
                    @rename($f, $destDir . '/' . $clean);
                    $f = $destDir . '/' . $clean;
                }
                if (file_exists($f) && filesize($f) > 0) {
                    $extracted[] = basename($f);
                }
            }
        }
        return $extracted;
    }

    public static function extractThumbnail(string $videoPath, string $destThumbPath, float $seekSeconds = 120, int $timeoutSeconds = 15): bool {
        if (file_exists($destThumbPath) && filesize($destThumbPath) > 0) return true;
        $dir = dirname($destThumbPath);
        if (!is_dir($dir)) @mkdir($dir, 0755, true);

        // thumbnail=120 picks the most representative of ~5 s of frames, so a title card or a
        // fade to white/black at the seek point no longer becomes the episode's image. Scaling
        // first keeps that buffer small and the JPEG light (cards never show it above ~400px).
        $cmd = sprintf(
            'ffmpeg -y -ss %f -i %s -vf "scale=640:-2,thumbnail=120" -frames:v 1 -q:v 3 %s',
            $seekSeconds,
            escapeshellarg($videoPath),
            escapeshellarg($destThumbPath)
        );
        self::executeBoundedCommand($cmd, $timeoutSeconds);
        return file_exists($destThumbPath) && filesize($destThumbPath) > 0;
    }

    public static function getFfmpegPath(): ?string {
        if (defined('FFMPEG_PATH') && FFMPEG_PATH !== '') {
            return FFMPEG_PATH;
        }
        $cmd = DIRECTORY_SEPARATOR === '\\' ? 'where.exe ffmpeg 2>NUL' : 'which ffmpeg 2>/dev/null';
        $out = @shell_exec($cmd);
        if ($out) {
            $lines = array_filter(array_map('trim', explode("\n", $out)));
            if (!empty($lines)) {
                return reset($lines);
            }
        }
        $test = @shell_exec('ffmpeg -version 2>&1');
        if ($test && str_contains($test, 'ffmpeg version')) {
            return 'ffmpeg';
        }
        return null;
    }

    public static function getFfprobePath(): ?string {
        if (defined('FFPROBE_PATH') && FFPROBE_PATH !== '') {
            return FFPROBE_PATH;
        }
        $cmd = DIRECTORY_SEPARATOR === '\\' ? 'where.exe ffprobe 2>NUL' : 'which ffprobe 2>/dev/null';
        $out = @shell_exec($cmd);
        if ($out) {
            $lines = array_filter(array_map('trim', explode("\n", $out)));
            if (!empty($lines)) {
                return reset($lines);
            }
        }
        $test = @shell_exec('ffprobe -version 2>&1');
        if ($test && str_contains($test, 'ffprobe version')) {
            return 'ffprobe';
        }
        return null;
    }
}
