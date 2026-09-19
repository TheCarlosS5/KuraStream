import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'kurastream.db');
const db = new DatabaseSync(dbPath);

function runCommand(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

async function extractThumb(videoPath, destPath) {
  try {
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await runCommand('ffmpeg', [
      '-ss', '60.0',
      '-i', videoPath,
      '-vframes', '1',
      '-q:v', '4',
      destPath,
      '-y'
    ]);
    return true;
  } catch (err) {
    try {
      await runCommand('ffmpeg', [
        '-ss', '2.0',
        '-i', videoPath,
        '-vframes', '1',
        '-q:v', '4',
        destPath,
        '-y'
      ]);
      return true;
    } catch (e) {
      console.error(`Failed for ${videoPath}:`, e.message);
      return false;
    }
  }
}

async function main() {
  console.log("Starting thumbnail generation for existing episodes...");
  const stmt = db.prepare("SELECT * FROM episodes");
  const episodes = stmt.all();
  
  for (const ep of episodes) {
    if (ep.thumbnail_path && ep.thumbnail_path.trim() !== '') {
      console.log(`Episode ${ep.id} already has a thumbnail: ${ep.thumbnail_path}`);
      continue;
    }
    
    console.log(`Processing episode ${ep.id} | File: ${ep.filepath}`);
    const showStmt = db.prepare("SELECT * FROM shows WHERE id = ?");
    const show = showStmt.get(ep.show_id);
    if (!show) {
      console.warn(`No show found for episode ${ep.id}`);
      continue;
    }
    
    const mediaTypeDir = show.media_type === 'movie' ? 'Movies' : 'Anime';
    const sanitizedTitle = show.title.replace(/[\\/:*?"<>|]/g, '_');
    const showFolder = path.join(__dirname, '../..', 'library', mediaTypeDir, sanitizedTitle);
    
    const thumbFilename = `ep_${ep.season_number}_${ep.episode_number}_thumb.jpg`;
    const thumbDest = path.join(showFolder, thumbFilename);
    
    const success = await extractThumb(ep.filepath, thumbDest);
    if (success) {
      const localThumbUrl = `/library/${mediaTypeDir}/${sanitizedTitle}/${thumbFilename}`;
      const updateStmt = db.prepare("UPDATE episodes SET thumbnail_path = ? WHERE id = ?");
      updateStmt.run(localThumbUrl, ep.id);
      console.log(`Successfully generated thumbnail for ${ep.id} -> ${localThumbUrl}`);
    }
  }
  console.log("Done!");
}

main().catch(console.error);
