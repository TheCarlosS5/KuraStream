import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbHelper } from '../db.js';
import { probeVideo } from '../scanner.js';
import { scraper } from '../scraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const showId = '203737'; // Oshi no Ko
const showTitle = 'Oshi no Ko';
const animeFolder = path.join(__dirname, '../..', 'library', 'Anime', 'Oshi_no_Ko');

async function main() {
  console.log("==============================================");
  console.log(" KuraStream DB restorer for Oshi no Ko");
  console.log("==============================================");

  try {
    const seasons = await fs.readdir(animeFolder);
    const seasonDirs = seasons.filter(s => s.toLowerCase().startsWith('season'));
    
    // Cache TMDB episodes by season
    const tmdbSeasons = {};

    for (const sDir of seasonDirs) {
      const seasonMatch = sDir.match(/season\s+(\d+)/i);
      if (!seasonMatch) continue;
      const seasonNumber = parseInt(seasonMatch[1], 10);
      const fullSeasonPath = path.join(animeFolder, sDir);

      console.log(`\nScanning season directory: ${sDir} (Season ${seasonNumber})`);
      
      // Fetch TMDB episode info
      if (!tmdbSeasons[seasonNumber]) {
        console.log(`Fetching TMDB episodes metadata for Season ${seasonNumber}...`);
        tmdbSeasons[seasonNumber] = await scraper.getSeasonEpisodes(showId, seasonNumber);
      }
      const tmdbEpisodes = tmdbSeasons[seasonNumber];

      const files = await fs.readdir(fullSeasonPath);
      const episodeFiles = files.filter(f => f.endsWith('.mkv') || f.endsWith('.mp4'));

      for (const file of episodeFiles) {
        const epMatch = file.match(/S\d+E(\d+)/i);
        if (!epMatch) {
          console.warn(`Could not parse episode number from: ${file}`);
          continue;
        }
        const episodeNumber = parseInt(epMatch[1], 10);
        const filePath = path.join(fullSeasonPath, file);

        console.log(`  Probing E${episodeNumber}: ${file}...`);
        const techDetails = await probeVideo(filePath);

        const tmdbEp = tmdbEpisodes.find(e => e.episode_number === episodeNumber);
        const epTitle = tmdbEp ? tmdbEp.title : `Capítulo ${episodeNumber}`;
        const epSynopsis = tmdbEp ? tmdbEp.synopsis : '';

        // Match existing thumbnails in the "Oshi no Ko" (with spaces) or "Oshi_no_Ko" folders
        const thumbFilename = `ep_${seasonNumber}_${episodeNumber}_thumb.jpg`;
        const possibleThumbPaths = [
          `/library/Anime/Oshi no Ko/${thumbFilename}`,
          `/library/Anime/Oshi_no_Ko/${thumbFilename}`
        ];
        
        let localThumbUrl = '';
        for (const pPath of possibleThumbPaths) {
          const absPath = path.join(__dirname, '../..', pPath);
          try {
            await fs.access(absPath);
            localThumbUrl = pPath;
            break;
          } catch(e) {}
        }

        const episodeId = `${showId}_S${seasonNumber}_E${episodeNumber}`;

        dbHelper.saveEpisode({
          id: episodeId,
          show_id: showId,
          season_number: seasonNumber,
          episode_number: episodeNumber,
          title: epTitle,
          synopsis: epSynopsis,
          filepath: filePath,
          duration: techDetails.duration,
          size: techDetails.size,
          video_codec: techDetails.video_codec,
          resolution: techDetails.resolution,
          fps: techDetails.fps,
          audio_tracks: techDetails.audio_tracks,
          subtitle_tracks: techDetails.subtitle_tracks,
          thumbnail_path: localThumbUrl
        });

        console.log(`    Successfully saved ${episodeId} to DB (Thumb: ${localThumbUrl})`);
      }
    }

    console.log("\n==============================================");
    console.log(" RESTORATION COMPLETE! 🎉");
    console.log("==============================================");
  } catch (err) {
    console.error("Restoration failed:", err);
  }
}

main();
