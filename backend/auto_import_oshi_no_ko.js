import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbHelper } from './db.js';
import { probeVideo, extractCover, generateIntroLoop } from './scanner.js';
import { scraper, downloadImage } from './scraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMDB_ID = 203737; // Oshi no Ko TMDB ID

async function main() {
  console.log("==============================================");
  console.log(" KuraStream Auto-Importer: Oshi no Ko");
  console.log("==============================================");

  const workspaceDir = path.join(__dirname, '..');
  const libraryDir = path.join(workspaceDir, 'library');

  // Folders containing the seasons
  const seasonFolders = [
    { dir: '[Trix] Oshi no Ko S01 - AV1', season: 1 },
    { dir: '[Trix] Oshi no Ko S02 - WEB AV1', season: 2 },
    { dir: '[Trix] Oshi no Ko S03 [WEBRip 1080p AV1 Opus] (Multi Subs)', season: 3 }
  ];

  try {
    // 1. Fetch TMDB show metadata
    console.log(`Fetching TMDB metadata for ID: ${TMDB_ID}...`);
    const showDetails = await scraper.getDetails(TMDB_ID, 'anime');
    
    // Create base anime folder
    const showFolder = path.join(libraryDir, 'Anime', 'Oshi_no_Ko');
    await fs.mkdir(showFolder, { recursive: true });

    // Download poster & backdrop
    let localPoster = '';
    let localBackdrop = '';
    if (showDetails.poster_path) {
      localPoster = await downloadImage(showDetails.poster_path, path.join(showFolder, 'poster.jpg'));
    }
    if (showDetails.backdrop_path) {
      localBackdrop = await downloadImage(showDetails.backdrop_path, path.join(showFolder, 'backdrop.jpg'));
    }

    // Save show details to SQLite
    dbHelper.saveShow({
      id: String(TMDB_ID),
      title: showDetails.title,
      synopsis: showDetails.synopsis,
      rating: showDetails.rating,
      year: showDetails.year,
      studio: showDetails.studio,
      director: showDetails.director,
      writer: showDetails.writer,
      cast_members: showDetails.cast_members,
      poster_path: localPoster ? `/library/Anime/Oshi_no_Ko/${localPoster}` : '',
      backdrop_path: localBackdrop ? `/library/Anime/Oshi_no_Ko/${localBackdrop}` : '',
      media_type: 'anime'
    });
    console.log(`Saved Show: ${showDetails.title} in Database.`);

    // 2. Loop through folders and import episodes
    for (const sf of seasonFolders) {
      const sourceSeasonDir = path.join(workspaceDir, sf.dir);
      
      // Check if folder exists
      try {
        await fs.access(sourceSeasonDir);
      } catch (e) {
        console.warn(`Folder not found: ${sourceSeasonDir}, skipping season ${sf.season}`);
        continue;
      }

      console.log(`\nImporting Season ${sf.season} from folder: ${sf.dir}...`);
      const files = await fs.readdir(sourceSeasonDir);
      const mkvFiles = files.filter(f => f.toLowerCase().endsWith('.mkv'));

      // Fetch season episodes info from TMDB to get correct titles & synopsis
      console.log(`Fetching TMDB episodes list for Season ${sf.season}...`);
      const tmdbEpisodes = await scraper.getSeasonEpisodes(TMDB_ID, sf.season);

      for (const file of mkvFiles) {
        // Parse episode number
        const match = file.match(/S\d+E(\d+)/i) || file.match(/E(\d+)/i);
        if (!match) {
          console.warn(`Could not parse episode number from file: ${file}`);
          continue;
        }
        
        const epNum = parseInt(match[1], 10);
        const sourcePath = path.join(sourceSeasonDir, file);

        // Organize folder structure in library
        const seasonStr = `Season ${String(sf.season).padStart(2, '0')}`;
        const destSeasonDir = path.join(showFolder, seasonStr);
        await fs.mkdir(destSeasonDir, { recursive: true });

        // Retrieve TMDB info for this episode
        const tmdbEp = tmdbEpisodes.find(e => e.episode_number === epNum);
        const epTitle = tmdbEp ? tmdbEp.title : `Capítulo ${epNum}`;
        const epSynopsis = tmdbEp ? tmdbEp.synopsis : '';

        const ext = path.extname(file);
        const sNumStr = String(sf.season).padStart(2, '0');
        const eNumStr = String(epNum).padStart(2, '0');
        const sanitizedEpTitle = epTitle.replace(/[\\/:*?"<>|]/g, '_');
        const destFileName = `Oshi_no_Ko - S${sNumStr}E${eNumStr} - ${sanitizedEpTitle}${ext}`;
        const destPath = path.join(destSeasonDir, destFileName);

        console.log(`  - Moving E${eNumStr}: ${epTitle}...`);
        await fs.rename(sourcePath, destPath);

        // Probe media file details
        console.log(`    Probing metadata...`);
        const techDetails = await probeVideo(destPath);

        // Extract cover if none exists yet
        if (!localPoster) {
          console.log(`    Extracting cover from video file...`);
          localPoster = await extractCover(destPath, showFolder, techDetails.attachments);
          // Update DB with cover path
          dbHelper.saveShow({
            id: String(TMDB_ID),
            title: showDetails.title,
            synopsis: showDetails.synopsis,
            rating: showDetails.rating,
            year: showDetails.year,
            studio: showDetails.studio,
            director: showDetails.director,
            writer: showDetails.writer,
            cast_members: showDetails.cast_members,
            poster_path: `/library/Anime/Oshi_no_Ko/poster.jpg`,
            backdrop_path: localBackdrop ? `/library/Anime/Oshi_no_Ko/${localBackdrop}` : '',
            media_type: 'anime'
          });
        }

        // Generate intro loop from Season 1 Episode 2 if this is it
        // (E02 is better because it starts with Yoasobi's "Idol" opening loop)
        if (sf.season === 1 && epNum === 2) {
          console.log(`    Extracting 30-second background intro loop...`);
          const introDest = path.join(showFolder, 'intro_loop.mp4');
          // Extract 30 seconds starting at 90s (usually where the opening starts)
          await generateIntroLoop(destPath, 90, introDest);
        }

        // Save Episode Details to database
        const episodeId = `${TMDB_ID}_S${sf.season}_E${epNum}`;
        dbHelper.saveEpisode({
          id: episodeId,
          show_id: String(TMDB_ID),
          season_number: sf.season,
          episode_number: epNum,
          title: epTitle,
          synopsis: epSynopsis,
          filepath: destPath,
          duration: techDetails.duration,
          size: techDetails.size,
          video_codec: techDetails.video_codec,
          resolution: techDetails.resolution,
          fps: techDetails.fps,
          audio_tracks: techDetails.audio_tracks,
          subtitle_tracks: techDetails.subtitle_tracks
        });
        console.log(`    Imported successfully.`);
      }
    }

    console.log("\n==============================================");
    console.log(" AUTO-IMPORT COMPLETED SUCCESSFULLY! 🎉");
    console.log("==============================================");

  } catch (err) {
    console.error("Auto-import failed:", err);
  }
}

main();
