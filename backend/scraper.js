import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedConfig = null;

async function getTMDBConfig() {
  if (cachedConfig) return cachedConfig;
  
  try {
    const keyFilePath = path.join(__dirname, '..', 'apikeys.txt');
    const content = await fs.readFile(keyFilePath, 'utf-8');
    const lines = content.split('\n').map(l => l.trim());
    
    let apiKey = '';
    let readToken = '';
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === 'API Key') {
        let j = i + 1;
        while (j < lines.length && !lines[j]) j++;
        if (j < lines.length) apiKey = lines[j];
      }
      if (lines[i] === 'API Read Access Token') {
        let j = i + 1;
        while (j < lines.length && !lines[j]) j++;
        if (j < lines.length) readToken = lines[j];
      }
    }
    
    // Fallbacks
    if (!apiKey) {
      const match = content.match(/[0-9a-f]{32}/i);
      if (match) apiKey = match[0];
    }
    if (!readToken) {
      const match = content.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
      if (match) readToken = match[0];
    }
    
    cachedConfig = { apiKey, readToken };
    return cachedConfig;
  } catch (err) {
    console.error('Error reading apikeys.txt, using empty keys:', err);
    return { apiKey: '', readToken: '' };
  }
}

const tmdbCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function tmdbFetch(endpoint, params = {}) {
  const { apiKey, readToken } = await getTMDBConfig();
  if (!apiKey && !readToken) {
    throw new Error('TMDB API Key or Read Access Token not found in apikeys.txt');
  }
  
  const queryParams = new URLSearchParams({ ...params });
  const cacheKey = `${endpoint}?${queryParams.toString()}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const headers = { 'Accept': 'application/json' };
  
  if (readToken) {
    headers['Authorization'] = `Bearer ${readToken}`;
  } else if (apiKey) {
    queryParams.set('api_key', apiKey);
  }
  
  const queryString = queryParams.toString();
  const url = `https://api.themoviedb.org/3${endpoint}${queryString ? '?' + queryString : ''}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    throw new Error(`TMDB API request failed: ${response.statusText} (${response.status})`);
  }
  const data = await response.json();
  tmdbCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export async function downloadImage(urlPath, destPath) {
  if (!urlPath) return '';
  const size = (destPath && destPath.includes('backdrop')) ? 'original' : 'w500';
  const imageUrl = urlPath.startsWith('http') ? urlPath : `https://image.tmdb.org/t/p/${size}${urlPath}`;
  try {
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Failed to download image ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(destPath, buffer);
    // Return relative path for frontend access
    return path.basename(destPath);
  } catch (err) {
    console.error(`Failed to download image from ${imageUrl} to ${destPath}:`, err);
    return '';
  }
}

export const scraper = {
  // Search for tv shows or movies
  search: async (query, mediaType = 'anime') => {
    const isMovie = mediaType === 'movie';
    const endpoint = isMovie ? '/search/movie' : '/search/tv';
    
    // Add anime genre filters to TV search if it's anime
    const params = {
      query: query,
      language: 'es-ES'
    };
    
    const results = await tmdbFetch(endpoint, params);
    
    return (results.results || []).map(item => ({
      tmdb_id: item.id,
      title: item.name || item.title,
      synopsis: item.overview,
      rating: item.vote_average,
      year: new Date(item.first_air_date || item.release_date || null).getFullYear() || null,
      poster_path: item.poster_path,
      backdrop_path: item.backdrop_path
    }));
  },

  // Get full show details including credits (cast, directors)
  getDetails: async (tmdbId, mediaType = 'anime') => {
    const isMovie = mediaType === 'movie';
    const endpoint = isMovie ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
    
    const details = await tmdbFetch(endpoint, {
      language: 'es-ES',
      append_to_response: 'credits,videos'
    });
    
    // Parse credits to extract Studio, Director, Writer
    let studio = '';
    if (isMovie) {
      studio = details.production_companies?.[0]?.name || '';
    } else {
      studio = details.networks?.[0]?.name || details.production_companies?.[0]?.name || '';
    }
    
    let director = '';
    let writer = '';
    const crew = details.credits?.crew || [];
    
    // Search director and writer
    const dirObj = crew.find(c => c.job === 'Director') || crew.find(c => c.job === 'Series Director');
    const writObj = crew.find(c => c.job === 'Writer') || crew.find(c => c.job === 'Screenplay') || crew.find(c => c.job === 'Writer / Storyboard');
    
    if (dirObj) director = dirObj.name;
    if (writObj) writer = writObj.name;
    
    // If no director found in crew for TV shows, sometimes they are listed under created_by
    if (!director && details.created_by && details.created_by.length > 0) {
      director = details.created_by.map(c => c.name).join(', ');
    }
    
    // Format Cast Members
    const cast = (details.credits?.cast || [])
      .slice(0, 10)
      .map(c => ({
        name: c.name,
        character: c.character,
        profile_path: c.profile_path ? `/t/p/w185${c.profile_path}` : null
      }));
      
    const genres = (details.genres || []).map(g => g.name).join(', ');

    // Find trailer key (YouTube video ID)
    let trailerKey = '';
    let videoResults = details.videos?.results || [];

    if (videoResults.length === 0) {
      try {
        const videoData = await tmdbFetch(isMovie ? `/movie/${tmdbId}/videos` : `/tv/${tmdbId}/videos`);
        videoResults = videoData.results || [];
      } catch (e) {
        console.warn(`Failed to fetch fallback videos for tmdbId ${tmdbId}:`, e);
      }
    }

    if (videoResults.length > 0) {
      const trailer = videoResults.find(v => v.site === 'YouTube' && v.type === 'Trailer') || 
                      videoResults.find(v => v.site === 'YouTube' && v.type === 'Teaser') ||
                      videoResults.find(v => v.site === 'YouTube');
      if (trailer) {
        trailerKey = trailer.key;
      }
    }

    const releaseDate = details.first_air_date || details.release_date || '';
    const isAiring = details.in_production === true || details.status === 'Returning Series' || details.status === 'In Production';
    const status = isAiring ? 'airing' : 'finished';

    return {
      id: String(tmdbId),
      title: details.name || details.title,
      synopsis: details.overview || '',
      rating: details.vote_average || 0.0,
      year: parseInt(releaseDate.substring(0, 4), 10) || null,
      studio,
      director,
      writer,
      cast_members: cast,
      genres,
      poster_path: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : '',
      backdrop_path: details.backdrop_path ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}` : '',
      trailer_key: trailerKey,
      status
    };
  },

  // Get episode details for a season (so we can get episode synopsis, air_date, titles)
  getSeasonEpisodes: async (tmdbId, seasonNumber) => {
    try {
      const data = await tmdbFetch(`/tv/${tmdbId}/season/${seasonNumber}`, {
        language: 'es-ES'
      });
      return (data.episodes || []).map(ep => ({
        episode_number: ep.episode_number,
        title: ep.name,
        synopsis: ep.overview,
        air_date: ep.air_date,
        still_path: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : null
      }));
    } catch (err) {
      // 404 is normal if season does not exist on TMDB
      return [];
    }
  }
};
