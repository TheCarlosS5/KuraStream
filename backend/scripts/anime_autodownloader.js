import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbHelper } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDownloadDir = path.resolve(__dirname, '..', '..', 'library', 'downloads', 'temp');

let isEnabled = false;
let isScanning = false;
let lastScanTime = null;
let scanTimer = null;
const activeDownloads = [];

/**
 * Parses raw file / torrent title to extract clean anime title, season number, and episode number.
 */
export function parseAnimeFilename(filename) {
  if (!filename) return { animeTitle: 'Anime', season: 1, episode: 1 };

  // Remove file extensions
  let clean = filename.replace(/\.(mkv|mp4|avi|webm)$/i, '');

  // Extract Season & Episode (e.g. S02E05, S2E5, 02x05)
  let season = 1;
  let episode = 1;

  const sEpMatch = clean.match(/S(\d+)E(\d+)/i) || clean.match(/(\d+)x(\d+)/i);
  if (sEpMatch) {
    season = parseInt(sEpMatch[1], 10);
    episode = parseInt(sEpMatch[2], 10);
  } else {
    // Match standalone episode pattern like "- 05" or " - 12"
    const epMatch = clean.match(/[\s\-_]+(\d{1,3})[\s\-_\[\.]/);
    if (epMatch) {
      episode = parseInt(epMatch[1], 10);
    }
  }

  // Remove bracketed tags e.g. [Fansub], [1080p], [Latino], [Sub Español]
  let titleOnly = clean.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '');
  // Remove episode patterns from title
  titleOnly = titleOnly.replace(/S\d+E\d+/i, '').replace(/\d+x\d+/i, '').replace(/[\s\-_]+\d{1,3}.*$/, '');
  titleOnly = titleOnly.trim().replace(/^[\s\-_]+|[\s\-_]+$/g, '');

  return {
    animeTitle: titleOnly || 'Anime',
    season: season || 1,
    episode: episode || 1
  };
}

/**
 * Filters array of torrent items to keep only those targeting Spanish (Latino or Sub Español).
 */
export function filterSpanishAnimeTorrents(items) {
  if (!Array.isArray(items)) return [];

  const spanishRegex = /(latino|sub[\s\-_]*español|sub[\s\-_]*esp|castellano|spanish|esp|multisub|multi\-sub|dual[\s\-_]*audio)/i;

  return items.filter(item => {
    if (!item || !item.title) return false;
    return spanishRegex.test(item.title) || (item.description && spanishRegex.test(item.description));
  });
}

/**
 * Parses simple RSS XML into array of items
 */
export function parseRSSXml(xmlText) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const content = match[1];
    const titleMatch = content.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const linkMatch = content.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
    const guidMatch = content.match(/<guid[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/guid>/i);
    const descMatch = content.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);

    if (titleMatch) {
      const title = titleMatch[1].trim();
      const link = linkMatch ? linkMatch[1].trim() : '';
      const guid = guidMatch ? guidMatch[1].trim() : link || title;
      const description = descMatch ? descMatch[1].trim() : '';
      items.push({ title, link, guid, description });
    }
  }

  return items;
}

/**
 * Fetches latest Spanish anime torrents from Nyaa RSS
 */
export async function fetchSpanishAnimeRSS() {
  const rssUrls = [
    'https://nyaa.si/?page=rss&c=1_2',
    'https://nyaa.si/?page=rss&q=latino',
    'https://nyaa.si/?page=rss&q=espa%C3%B1ol'
  ];

  const allItems = [];
  const seenGuids = new Set();

  for (const url of rssUrls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, {
        headers: { 'User-Agent': 'KuraStream/1.5.0 AutoDownloader' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const xml = await res.text();
        const parsed = parseRSSXml(xml);
        const filtered = filterSpanishAnimeTorrents(parsed);

        for (const item of filtered) {
          const key = item.guid || item.link || item.title;
          if (!seenGuids.has(key)) {
            seenGuids.add(key);
            allItems.push(item);
          }
        }
      }
    } catch (err) {
      console.warn(`[AutoDownloader] Error fetching ${url}:`, err.message);
    }
  }

  return allItems;
}

/**
 * Detects if a torrent title represents a full season batch/pack vs a single episode.
 */
export function isBatchPack(title) {
  if (!title) return false;
  const batchRegex = /(batch|completa|completo|01[\s\-_~]+\d{2}|S\d+[\s\-_]+Complete|season\s*\d+\s*complete|\b01\s*-\s*\d{2}\b)/i;
  return batchRegex.test(title);
}

/**
 * Single scan execution loop
 */
export async function runAutoScan() {
  if (isScanning) return { status: 'already_scanning' };
  isScanning = true;
  lastScanTime = new Date().toISOString();

  let processedCount = 0;

  try {
    await fs.mkdir(tempDownloadDir, { recursive: true });
    const items = await fetchSpanishAnimeRSS();

    // Prioritize single episode torrents to process sequentially 1 by 1
    const singleEpisodes = items.filter(item => !isBatchPack(item.title));
    const batchPacks = items.filter(item => isBatchPack(item.title));

    const processQueue = [...singleEpisodes, ...batchPacks];

    for (const item of processQueue) {
      const infoHash = item.guid || item.link || item.title;
      if (dbHelper.isTorrentDownloaded(infoHash)) {
        continue;
      }

      const isBatch = isBatchPack(item.title);
      const parsed = parseAnimeFilename(item.title);
      console.log(`[AutoDownloader] Processing ${isBatch ? 'season batch' : 'single episode'} release 1-by-1: "${item.title}" -> ${parsed.animeTitle} S${parsed.season}E${parsed.episode}`);

      // Track active download status
      activeDownloads.push({
        title: item.title,
        animeTitle: parsed.animeTitle,
        season: parsed.season,
        episode: parsed.episode,
        isBatch,
        startTime: new Date().toISOString()
      });

      // Record in database
      dbHelper.saveDownloadedTorrent({
        info_hash: infoHash,
        title: item.title,
        anime_title: parsed.animeTitle,
        season: parsed.season,
        episode: parsed.episode,
        source_url: item.link
      });

      processedCount++;

      // Keep max 10 active/recent status items in memory
      if (activeDownloads.length > 10) {
        activeDownloads.shift();
      }
    }
  } catch (err) {
    console.error('[AutoDownloader] Scan error:', err);
  } finally {
    isScanning = false;
  }

  return { status: 'completed', processedCount, lastScanTime };
}

/**
 * Start background timer (e.g. every 30 mins)
 */
export function startAutoDownloader(intervalMs = 30 * 60 * 1000) {
  isEnabled = true;
  if (scanTimer) clearInterval(scanTimer);
  if (process.env.NODE_ENV !== 'test') {
    runAutoScan();
  }
  scanTimer = setInterval(() => {
    if (isEnabled) runAutoScan();
  }, intervalMs);
  console.log('[AutoDownloader] Automated daemon started.');
}

/**
 * Stop background daemon
 */
export function stopAutoDownloader() {
  isEnabled = false;
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  console.log('[AutoDownloader] Automated daemon stopped.');
}

/**
 * Get current status summary
 */
export function getAutoDownloaderStatus() {
  const history = dbHelper.getDownloadedTorrents(20);
  return {
    isEnabled,
    isScanning,
    lastScanTime,
    activeDownloads,
    history
  };
}
