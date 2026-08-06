import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbHelper } from './db.js';
import { probeVideo, extractEpisodeThumbnail } from './scanner.js';
import { scraper, downloadImage } from './scraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libraryDir = path.join(__dirname, '..', 'library');

async function scanCategory(categoryName, mediaType) {
  const categoryPath = path.join(libraryDir, categoryName);
  try {
    const shows = await fs.readdir(categoryPath);
    for (const showDir of shows) {
      if (showDir.startsWith('.') || showDir === 'logo.png') continue;
      const showPath = path.join(categoryPath, showDir);
      const stat = await fs.stat(showPath);
      if (!stat.isDirectory()) continue;

      console.log(`\n--------------------------------------------------`);
      console.log(`Scanning Show Directory: ${showDir} [${mediaType}]`);
      console.log(`--------------------------------------------------`);

      // Determine or fetch show metadata
      let dbShow = null;
      try {
        const existingShows = dbHelper.getShows(mediaType);
        dbShow = existingShows.find(s => s.title.toLowerCase() === showDir.replace(/_/g, ' ').toLowerCase() || s.id === showDir);
      } catch (e) {
        console.warn("Error finding show in DB:", e);
      }

      let showId = dbShow ? dbShow.id : null;
      let showDetails = null;

      if (!showId) {
        // Try to search TMDB for the folder name
        const cleanTitle = showDir.replace(/_/g, ' ');
        console.log(`Searching TMDB for: "${cleanTitle}"...`);
        try {
          const results = await scraper.search(cleanTitle, mediaType);
          if (results.length > 0) {
            console.log(`Found TMDB match: "${results[0].title}" (ID: ${results[0].tmdb_id})`);
            showDetails = await scraper.getDetails(results[0].tmdb_id, mediaType);
            showId = showDetails.id;
          }
        } catch (e) {
          console.warn(`TMDB search failed for ${cleanTitle}:`, e.message);
        }
      } else {
        console.log(`Found existing show in database: ID ${showId}`);
        // Still fetch details to update or parse season episodes if necessary
        try {
          showDetails = await scraper.getDetails(showId, mediaType);
        } catch (e) {
          console.warn(`TMDB getDetails failed for ${showId}:`, e.message);
        }
      }

      if (!showId) {
        // Fallback to local name
        showId = showDir.replace(/[\\/:*?"<>|]/g, '_');
      }

      // Download images if they don't exist
      let localPosterName = '';
      let localBackdropName = '';
      if (showDetails) {
        const posterDest = path.join(showPath, 'poster.jpg');
        const backdropDest = path.join(showPath, 'backdrop.jpg');
        
        try {
          await fs.access(posterDest);
          localPosterName = 'poster.jpg';
        } catch (e) {
          if (showDetails.poster_path) {
            localPosterName = await downloadImage(showDetails.poster_path, posterDest);
          }
        }

        try {
          await fs.access(backdropDest);
          localBackdropName = 'backdrop.jpg';
        } catch (e) {
          if (showDetails.backdrop_path) {
            localBackdropName = await downloadImage(showDetails.backdrop_path, backdropDest);
          }
        }
      }

      // Save/update Show in DB
      dbHelper.saveShow({
        id: showId,
        title: (showDetails ? showDetails.title : showDir.replace(/_/g, ' ')).replace(/Ranma1\/?2/ig, 'Ranma ½'),
        synopsis: showDetails ? showDetails.synopsis : '',
        rating: showDetails ? showDetails.rating : 0.0,
        year: showDetails ? showDetails.year : null,
        studio: showDetails ? showDetails.studio : '',
        director: showDetails ? showDetails.director : '',
        writer: showDetails ? showDetails.writer : '',
        cast_members: showDetails ? showDetails.cast_members : [],
        poster_path: localPosterName ? `/library/${categoryName}/${showDir}/${localPosterName}` : (dbShow?.poster_path || ''),
        backdrop_path: localBackdropName ? `/library/${categoryName}/${showDir}/${localBackdropName}` : (dbShow?.backdrop_path || ''),
        media_type: mediaType
      });

      // Now scan episodes/files
      if (mediaType === 'movie') {
        const files = await fs.readdir(showPath);
        const movieFile = files.find(f => f.endsWith('.mkv') || f.endsWith('.mp4'));
        if (movieFile) {
          const filePath = path.join(showPath, movieFile);
          const episodeId = `${showId}_movie`;
          
          let dbEpisode = dbHelper.getEpisode(episodeId);
          if (!dbEpisode) {
            console.log(`Adding movie file: ${movieFile}`);
            const techDetails = await probeVideo(filePath);
            dbHelper.saveEpisode({
              id: episodeId,
              show_id: showId,
              season_number: null,
              episode_number: null,
              title: showDetails ? showDetails.title : showDir.replace(/_/g, ' '),
              synopsis: showDetails ? showDetails.synopsis : '',
              filepath: filePath,
              duration: techDetails.duration,
              size: techDetails.size,
              video_codec: techDetails.video_codec,
              resolution: techDetails.resolution,
              fps: techDetails.fps,
              audio_tracks: techDetails.audio_tracks,
              subtitle_tracks: techDetails.subtitle_tracks,
              thumbnail_path: ''
            });
          }
        }
      } else {
        // TV Show: Scan Season folders
        const contents = await fs.readdir(showPath);
        for (const item of contents) {
          const itemPath = path.join(showPath, item);
          const itemStat = await fs.stat(itemPath);
          if (!itemStat.isDirectory()) continue;
          
          const seasonMatch = item.match(/Season\s+(\d+)/i);
          if (!seasonMatch) continue;
          
          const seasonNumber = parseInt(seasonMatch[1], 10);
          const files = await fs.readdir(itemPath);
          const videoFiles = files.filter(f => f.endsWith('.mkv') || f.endsWith('.mp4'));

          // Cache TMDB episodes for this season
          let tmdbEpisodes = [];
          if (showDetails) {
            try {
              tmdbEpisodes = await scraper.getSeasonEpisodes(showId, seasonNumber);
            } catch (e) {
              console.warn(`Failed to fetch TMDB episode metadata for S${seasonNumber}:`, e.message);
            }
          }

          for (const file of videoFiles) {
            const epMatch = file.match(/S\d+E(\d+)/i) || file.match(/E(\d+)/i);
            if (!epMatch) continue;
            
            const episodeNumber = parseInt(epMatch[1], 10);
            const filePath = path.join(itemPath, file);
            const episodeId = `${showId}_S${seasonNumber}_E${episodeNumber}`;

            let dbEpisode = dbHelper.getEpisode(episodeId);
            if (!dbEpisode) {
              console.log(`Discovered new episode file: ${file} (S${seasonNumber}E${episodeNumber})`);
              const techDetails = await probeVideo(filePath);
              
              const tmdbEp = tmdbEpisodes.find(e => e.episode_number === episodeNumber);
              const epTitle = tmdbEp ? tmdbEp.title : `Capítulo ${episodeNumber}`;
              const epSynopsis = tmdbEp ? tmdbEp.synopsis : '';

              // Check if episode thumbnail exists or extract it
              const thumbFilename = `ep_${seasonNumber}_${episodeNumber}_thumb.jpg`;
              const thumbDest = path.join(showPath, thumbFilename);
              let localThumbUrl = '';
              try {
                await fs.access(thumbDest);
                localThumbUrl = `/library/${categoryName}/${showDir}/${thumbFilename}`;
              } catch (e) {
                if (tmdbEp && tmdbEp.still_path) {
                  const downloaded = await downloadImage(tmdbEp.still_path, thumbDest);
                  if (downloaded) {
                    localThumbUrl = `/library/${categoryName}/${showDir}/${thumbFilename}`;
                  }
                }
                if (!localThumbUrl) {
                  const extracted = await extractEpisodeThumbnail(filePath, thumbDest);
                  if (extracted) {
                    localThumbUrl = `/library/${categoryName}/${showDir}/${thumbFilename}`;
                  }
                }
              }

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
              console.log(`Saved episode ${episodeId} to DB.`);
            } else {
              // Update filepath if it differs
              if (dbEpisode.filepath !== filePath) {
                console.log(`Updating filepath for ${episodeId} to: ${filePath}`);
                dbHelper.saveEpisode({
                  ...dbEpisode,
                  filepath: filePath
                });
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn(`Category path ${categoryPath} does not exist or failed to read:`, err.message);
  }
}

export async function runLibraryScan() {
  console.log("==============================================");
  console.log(" KuraStream Library Scanner & DB Sync");
  console.log("==============================================");

  try {
    await fs.mkdir(path.join(LIBRARY_DIR, 'Anime'), { recursive: true });
    await fs.mkdir(path.join(LIBRARY_DIR, 'Movies'), { recursive: true });
  } catch (e) {}
  
  await scanCategory('Anime', 'anime');
  await scanCategory('Movies', 'movie');
  
  console.log("\n==============================================");
  console.log(" SCANNING & SYNC COMPLETE! 🎉");
  console.log("==============================================");
}

import { argv } from 'node:process';
const modulePath = fileURLToPath(import.meta.url);
if (argv[1] === modulePath || (argv[1] && argv[1].endsWith('scan_library.js'))) {
  runLibraryScan().catch(console.error);
}
