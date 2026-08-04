import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libraryDir = path.resolve(__dirname, '../..', 'library');

async function cleanDemos() {
  console.log('--- Cleaning Demo Shows and Files ---');

  // 1. Delete from SQLite Database
  try {
    const showIds = ['test_show', 'test_scrape_show', '281161'];
    
    // Delete episodes
    const stmtDelEpisodes = db.prepare(`DELETE FROM episodes WHERE show_id IN (${showIds.map(() => '?').join(',')})`);
    const epRes = stmtDelEpisodes.run(...showIds);
    console.log(`Deleted ${epRes.changes} demo episodes from database.`);

    // Delete shows
    const stmtDelShows = db.prepare(`DELETE FROM shows WHERE id IN (${showIds.map(() => '?').join(',')})`);
    const showRes = stmtDelShows.run(...showIds);
    console.log(`Deleted ${showRes.changes} demo shows from database.`);
  } catch (err) {
    console.error('Error cleaning database records:', err);
  }

  // 2. Delete Physical Folders
  const foldersToDelete = [
    path.join(libraryDir, 'anime', 'Test_Scrape_Anime'),
    path.join(libraryDir, 'Anime', 'Assassination Classroom'),
    path.join(libraryDir, 'Anime', 'Kizoku Tensei_ Megumareta Umare kara Saikyo no Chikara o Eru'),
    path.join(libraryDir, 'Anime', 'Noble Reincarnation_ Born Blessed, So I\'ll Obtain Ultimate Power')
  ];

  for (const folder of foldersToDelete) {
    try {
      await fs.rm(folder, { recursive: true, force: true });
      console.log(`Deleted directory: ${folder}`);
    } catch (err) {
      console.error(`Failed to delete directory ${folder}:`, err.message);
    }
  }

  // Clean empty lowercase library/anime if empty
  try {
    const lowercaseAnimeDir = path.join(libraryDir, 'anime');
    const files = await fs.readdir(lowercaseAnimeDir);
    if (files.length === 0) {
      await fs.rmdir(lowercaseAnimeDir);
      console.log(`Deleted empty directory: ${lowercaseAnimeDir}`);
    }
  } catch (e) {}

  console.log('--- Demo Cleanup Completed ---');
}

cleanDemos();
