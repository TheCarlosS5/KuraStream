import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';

if (process.env.PATH && !process.env.PATH.includes('/home/dserver-calos/bin')) {
  process.env.PATH = `${process.env.PATH}:/home/dserver-calos/bin:/usr/local/bin:/usr/bin`;
}

// Helper to run execFile as a promise
function runCommand(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

const FFMPEG_CMD = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE_CMD = process.env.FFPROBE_PATH || 'ffprobe';

// Extract technical details of a video file using ffprobe
export async function probeVideo(filePath) {
  try {
    const { stdout } = await runCommand(FFPROBE_CMD, [
      '-v', 'error',
      '-show_format',
      '-show_streams',
      '-print_format', 'json',
      filePath
    ]);
    
    const data = JSON.parse(stdout);
    const format = data.format || {};
    const streams = data.streams || [];
    
    const duration = parseFloat(format.duration || 0);
    const size = parseInt(format.size || 0);
    
    // Video stream details: filter out attached cover pictures/thumbnails
    const videoStream = streams.find(s => s.codec_type === 'video' && (!s.disposition || s.disposition.attached_pic !== 1)) ||
                        streams.find(s => s.codec_type === 'video');
    let videoCodec = '';
    let resolution = '';
    let fps = 0;
    
    if (videoStream) {
      videoCodec = videoStream.codec_name?.toUpperCase() || '';
      resolution = `${videoStream.width || 0}x${videoStream.height || 0}`;
      
      // Calculate FPS
      if (videoStream.r_frame_rate) {
        const parts = videoStream.r_frame_rate.split('/');
        if (parts.length === 2 && parseFloat(parts[1]) > 0) {
          fps = parseFloat((parseFloat(parts[0]) / parseFloat(parts[1])).toFixed(3));
        } else {
          fps = parseFloat(videoStream.r_frame_rate) || 0;
        }
      }
    }
    
    // Audio streams details
    const audioTracks = [];
    let audioIdx = 0;
    
    // Subtitle streams details
    const subtitleTracks = [];
    let subIdx = 0;
    
    // Attachments
    const attachments = [];
    
    for (const s of streams) {
      if (s.codec_type === 'audio') {
        const lang = s.tags?.language || s.tags?.LANGUAGE || 'und';
        const title = s.tags?.title || s.tags?.TITLE || `Audio Track ${audioIdx + 1}`;
        audioTracks.push({
          index: s.index, // The absolute stream index in ffmpeg
          track_number: audioIdx++, // Track index for UI selection
          codec: s.codec_name || '',
          channels: s.channels || 2,
          sample_rate: s.sample_rate || 48000,
          language: lang,
          title: title
        });
      } else if (s.codec_type === 'subtitle') {
        const lang = s.tags?.language || s.tags?.LANGUAGE || 'und';
        const title = s.tags?.title || s.tags?.TITLE || `Subtitle Track ${subIdx + 1}`;
        subtitleTracks.push({
          index: s.index,
          track_number: subIdx++,
          codec: s.codec_name || '',
          language: lang,
          title: title
        });
      } else if (s.codec_type === 'attachment') {
        const filename = s.tags?.filename || s.tags?.FILENAME || '';
        attachments.push({
          index: s.index,
          filename: filename,
          mime_type: s.codec_name
        });
      }
    }
    
    return {
      duration,
      size,
      video_codec: videoCodec,
      resolution,
      fps,
      audio_tracks: audioTracks,
      subtitle_tracks: subtitleTracks,
      attachments
    };
  } catch (err) {
    console.warn(`[Scanner] Warning probing file ${filePath}:`, err.message);
    let fileSize = 0;
    try {
      const stat = await fs.stat(filePath);
      fileSize = stat.size;
    } catch (e) {}
    return {
      duration: 1440,
      size: fileSize,
      video_codec: 'h264',
      resolution: '1080p',
      fps: 24,
      audio_tracks: [],
      subtitle_tracks: [],
      attachments: []
    };
  }
}

// Extract embedded cover from MKV or capture thumbnail
export async function extractCover(filePath, destDir, attachments = []) {
  try {
    await fs.mkdir(destDir, { recursive: true });
    
    // Try to find a cover in attachments
    const coverAttachment = attachments.find(a => 
      a.filename.toLowerCase().includes('cover') || 
      a.filename.toLowerCase().includes('poster') ||
      a.filename.toLowerCase().includes('folder')
    );
    
    if (coverAttachment) {
      const filename = coverAttachment.filename;
      // ffmpeg -dump_attachment:t "filename" -i "filePath" -y
      // We run in destDir so the file is saved directly there
      await runCommand(FFMPEG_CMD, [
        '-dump_attachment:t', filename,
        '-i', filePath,
        '-y'
      ], { cwd: destDir });
      
      const ext = path.extname(filename).toLowerCase();
      const destPoster = path.join(destDir, 'poster' + ext);
      const tempPath = path.join(destDir, filename);
      
      // Rename to poster.jpg/png
      await fs.rename(tempPath, destPoster);
      return path.basename(destPoster);
    }
  } catch (err) {
    console.warn(`Failed to extract embedded cover from ${filePath}:`, err);
  }
  
  // Fallback: extract thumbnail at 10% of video (e.g. at 60s or 120s)
  try {
    const destPoster = path.join(destDir, 'poster.jpg');
    // Extract thumbnail at 60 seconds (or 5 seconds if short video)
    await runCommand(FFMPEG_CMD, [
      '-ss', '60.0',
      '-i', filePath,
      '-vframes', '1',
      '-q:v', '2',
      destPoster,
      '-y'
    ]);
    return path.basename(destPoster);
  } catch (err) {
    // If 60s failed (short video), try 2s
    try {
      const destPoster = path.join(destDir, 'poster.jpg');
      await runCommand(FFMPEG_CMD, [
        '-ss', '2.0',
        '-i', filePath,
        '-vframes', '1',
        '-q:v', '2',
        destPoster,
        '-y'
      ]);
      return path.basename(destPoster);
    } catch (e) {
      console.error(`Failed to capture thumbnail fallback for ${filePath}:`, e);
      return '';
    }
  }
}

// Generate an intro loop video (30 seconds silent mp4)
export async function generateIntroLoop(videoPath, startSeconds, destPath) {
  try {
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    // ffmpeg -ss [start] -i [video] -t 30 -c:v libx264 -an -f mp4 [destPath] -y
    await runCommand('ffmpeg', [
      '-ss', String(startSeconds),
      '-i', videoPath,
      '-t', '30',
      '-c:v', 'libx264',
      '-an', // No audio
      '-f', 'mp4',
      destPath,
      '-y'
    ]);
    return true;
  } catch (err) {
    console.error(`Failed to generate intro loop from ${videoPath} starting at ${startSeconds}:`, err);
    return false;
  }
}

// Extract a frame from the video to use as an episode thumbnail
export async function extractEpisodeThumbnail(videoPath, destPath) {
  try {
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    // Try timestamps (300s = 5m, 180s = 3m, 60s = 1m, 5s) to get actual episode content past opening song
    const timestamps = ['300.0', '180.0', '60.0', '5.0'];
    for (const ts of timestamps) {
      try {
        await runCommand('ffmpeg', [
          '-ss', ts,
          '-i', videoPath,
          '-vframes', '1',
          '-q:v', '3',
          destPath,
          '-y'
        ]);
        return true;
      } catch (e) {
        // Try next timestamp if video is shorter than current timestamp
      }
    }
    return false;
  } catch (err) {
    console.error(`Failed to capture episode thumbnail for ${videoPath}:`, err);
    return false;
  }
}
