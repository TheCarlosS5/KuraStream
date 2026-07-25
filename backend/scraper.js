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

async function tmdbFetch(endpoint, params = {}) {
  const { apiKey } = await getTMDBConfig();
  if (!apiKey) {
    throw new Error('TMDB API Key not found in apikeys.txt');
  }
  
  const queryParams = new URLSearchParams({
    api_key: apiKey,
    ...params
  });
  
  const url = `https://api.themoviedb.org/3${endpoint}?${queryParams.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TMDB API request failed: ${response.statusText} (${response.status})`);
  }
  return response.json();
}

// Download image utility
export async function downloadImage(urlPath, destPath) {
  if (!urlPath) return '';
  const imageUrl = `https://image.tmdb.org/t/p/w500${urlPath}`;
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
      append_to_response: 'credits'
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
    return {
      id: String(tmdbId),
      title: details.name || details.title,
      synopsis: details.overview || '',
      rating: details.vote_average || 0.0,
      year: new Date(details.first_air_date || details.release_date || null).getFullYear() || null,
      studio: studio,
      director: director,
      writer: writer,
      cast_members: cast,
      poster_path: details.poster_path,
      backdrop_path: details.backdrop_path,
      media_type: mediaType,
      genres: genres
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
        air_date: ep.air_date
      }));
    } catch (err) {
      console.error(`Failed to fetch season ${seasonNumber} for show ${tmdbId}:`, err);
      return [];
    }
  }
};
