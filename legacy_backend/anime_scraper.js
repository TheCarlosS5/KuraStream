import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbHelper } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libraryDir = path.resolve(__dirname, '..', 'library');

let lastJikanRequestTime = 0;
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function fetchJikanWithRateLimit(url) {
  const now = Date.now();
  const elapsed = now - lastJikanRequestTime;
  if (elapsed < 400) {
    await sleep(400 - elapsed);
  }
  lastJikanRequestTime = Date.now();

  let res = await fetch(url);
  if (res.status === 429) {
    console.warn('[Scraper] Jikan 429 rate limit hit, backing off 1.2s and retrying...');
    await sleep(1200);
    lastJikanRequestTime = Date.now();
    res = await fetch(url);
  }
  return res;
}

/**
 * Scrapes metadata and poster image url from Jikan (MyAnimeList) and Kitsu APIs
 */
export async function scrapeAnimeMetadata(query) {
  // Try Jikan (MyAnimeList) API first
  try {
    console.log(`[Scraper] Querying Jikan API for: "${query}"`);
    const jikanRes = await fetchJikanWithRateLimit(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=1`);
    if (jikanRes.ok) {
      const data = await jikanRes.json();
      if (data && data.data && data.data.length > 0) {
        const item = data.data[0];
        const imageUrl = item.images?.jpg?.large_image_url || item.images?.jpg?.image_url;
        if (imageUrl) {
          console.log(`[Scraper] Found match on Jikan: "${item.title}"`);
          return {
            title: item.title,
            synopsis: item.synopsis || '',
            rating: item.score || 0.0,
            year: item.year || (item.aired?.from ? new Date(item.aired.from).getFullYear() : null),
            imageUrl
          };
        }
      }
    }
  } catch (err) {
    console.warn('[Scraper] Jikan API failed:', err.message);
  }

  // Fallback to Kitsu API
  try {
    console.log(`[Scraper] Querying Kitsu API for: "${query}"`);
    const kitsuRes = await fetch(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(query)}&page[limit]=1`);
    if (kitsuRes.ok) {
      const data = await kitsuRes.json();
      if (data && data.data && data.data.length > 0) {
        const item = data.data[0];
        const attrs = item.attributes;
        const imageUrl = attrs.posterImage?.original || attrs.posterImage?.large || attrs.posterImage?.medium;
        if (imageUrl) {
          console.log(`[Scraper] Found match on Kitsu: "${attrs.canonicalTitle}"`);
          return {
            title: attrs.canonicalTitle,
            synopsis: attrs.synopsis || attrs.description || '',
            rating: attrs.averageRating ? parseFloat(attrs.averageRating) / 10.0 : 0.0,
            year: attrs.startDate ? new Date(attrs.startDate).getFullYear() : null,
            imageUrl
          };
        }
      }
    }
  } catch (err) {
    console.warn('[Scraper] Kitsu API failed:', err.message);
  }

  throw new Error('No se encontraron resultados en los servidores de metadatos de anime.');
}

/**
 * Downloads show cover and updates show details
 */
export async function downloadAndSetShowCover(showId, query) {
  const show = dbHelper.getShow(showId);
  if (!show) {
    throw new Error('Show no encontrado en la base de datos.');
  }

  const metadata = await scrapeAnimeMetadata(query);
  
  // Resolve physical show folder
  const category = show.media_type === 'movie' ? 'Movies' : 'Anime';
  let showDir = '';
  
  if (show.poster_path && show.poster_path.startsWith('/library/')) {
    const parts = show.poster_path.split('/');
    if (parts.length >= 4) {
      showDir = parts[3];
    }
  }
  
  if (!showDir) {
    showDir = show.title.replace(/[^a-zA-Z0-9_]/g, '_').replace(/\s+/g, '_') || show.id;
  }

  const showPath = path.join(libraryDir, category, showDir);
  await fs.mkdir(showPath, { recursive: true });

  const destPath = path.join(showPath, 'poster.jpg');
  console.log(`[Scraper] Downloading cover from ${metadata.imageUrl} to ${destPath}`);
  
  const imgRes = await fetch(metadata.imageUrl);
  if (!imgRes.ok) {
    throw new Error(`Error al descargar la imagen: ${imgRes.statusText}`);
  }
  const arrayBuffer = await imgRes.arrayBuffer();
  await fs.writeFile(destPath, Buffer.from(arrayBuffer));

  // Update show poster path
  show.poster_path = `/library/${category}/${showDir}/poster.jpg`;
  
  // Update other metadata if empty
  if (!show.synopsis || show.synopsis.trim() === '') show.synopsis = metadata.synopsis;
  if (!show.rating || show.rating === 0) show.rating = metadata.rating;
  if (!show.year) show.year = metadata.year;

  dbHelper.saveShow(show);
  console.log(`[Scraper] Successfully updated cover for show "${show.title}"`);
  return show;
}
