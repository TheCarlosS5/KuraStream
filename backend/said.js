import { execFile } from 'node:child_process';
import { db } from './db.js';

function runCommand(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error && !stdout) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function parseSrt(srtText) {
  const blocks = srtText.replace(/\r\n/g, '\n').split('\n\n');
  const subs = [];
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    if (lines.length >= 3) {
      const timeLine = lines[1];
      const match = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s-->\s(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
      if (match) {
        const start = parseInt(match[1])*3600 + parseInt(match[2])*60 + parseInt(match[3]) + parseInt(match[4])/1000;
        const end = parseInt(match[5])*3600 + parseInt(match[6])*60 + parseInt(match[7]) + parseInt(match[8])/1000;
        const text = lines.slice(2).join(' ').replace(/<[^>]+>/g, '').toLowerCase().replace(/[^\w\s]/g, '').trim();
        if (text) subs.push({ start, end, text });
      }
    }
  }
  return subs;
}

const FFMPEG_CMD = process.env.FFMPEG_PATH || 'ffmpeg';

export async function detectIntrosForSeason(showId, seasonNumber) {
  const episodes = db.prepare('SELECT * FROM episodes WHERE show_id = ? AND season_number = ? ORDER BY episode_number').all(showId, seasonNumber);
  if (episodes.length < 2) return { success: false, message: 'No hay suficientes episodios para detectar similitudes.' };

  const subsByEp = [];
  for (const ep of episodes) {
    try {
      const { stdout } = await runCommand(FFMPEG_CMD, [
        '-i', ep.filepath,
        '-map', '0:s:0',
        '-f', 'srt',
        '-'
      ], { maxBuffer: 10 * 1024 * 1024 });
      subsByEp.push({ ep, subs: parseSrt(stdout) });
    } catch (e) {
      console.warn('Could not extract subs for', ep.filepath, e.message);
    }
  }

  if (subsByEp.length < 2) return { success: false, message: 'No se pudieron extraer subtitulos de suficientes episodios.' };

  const countOccurrences = (lineText, allSubs) => {
    let count = 0;
    for (const epSubs of allSubs) {
      if (epSubs.subs.some(s => s.text === lineText)) count++;
    }
    return count;
  };

  const threshold = Math.ceil(subsByEp.length * 0.6);

  for (const epData of subsByEp) {
    const { ep, subs } = epData;
    
    // Intro: first 4 mins (240s)
    const introSubs = subs.filter(s => s.start < 240);
    let introStart = null;
    let introEnd = null;

    for (let i = 0; i < introSubs.length; i++) {
      if (introSubs[i].text.length < 4) continue;
      if (countOccurrences(introSubs[i].text, subsByEp) >= threshold) {
        if (introStart === null) introStart = introSubs[i].start;
        introEnd = introSubs[i].end;
      }
    }
    
    if (introStart !== null && introEnd !== null) {
      // Small refinement: add/subtract a few seconds to bound it better? Or just use raw bounds
      db.prepare('UPDATE episodes SET intro_start = ?, intro_end = ? WHERE id = ?').run(introStart, introEnd, ep.id);
    }

    // Outro: last 5 mins (duration - 300)
    let outroStart = null;
    if (ep.duration) {
      const outroSubs = subs.filter(s => s.start > ep.duration - 300);
      for (let i = 0; i < outroSubs.length; i++) {
        if (outroSubs[i].text.length < 4) continue;
        if (countOccurrences(outroSubs[i].text, subsByEp) >= threshold) {
          outroStart = outroSubs[i].start;
          break; // First occurrence is outro start
        }
      }
      if (outroStart !== null) {
        db.prepare('UPDATE episodes SET outro_start = ? WHERE id = ?').run(outroStart, ep.id);
      }
    }
  }

  return { success: true, message: 'Análisis de subtítulos completado.' };
}
