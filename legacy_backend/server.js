import http from 'node:http';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import { dbHelper, db } from './db.js';
import { probeVideo, extractCover, generateIntroLoop, extractEpisodeThumbnail } from './scanner.js';
import { scraper, downloadImage } from './scraper.js';
import { runLibraryScan } from './scan_library.js';
import { detectIntrosForSeason } from './said.js';
import { downloadAndSetShowCover } from './anime_scraper.js';
import { fetchWeeklyCalendar } from './anime_calendar.js';
import { getAutoDownloaderStatus, startAutoDownloader, stopAutoDownloader, runAutoScan, removeFromQueue, cancelActiveDownload, clearQueue, searchNyaaTorrents, addManualTorrent, startManualQueueProcessing } from './scripts/anime_autodownloader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Helper functions for auth
function hashPassword(password) {
  const salt = process.env.PASSWORD_SALT || process.env.JWT_SECRET || 'kurasalt';
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function signToken(payload) {
  const secret = process.env.JWT_SECRET || 'default_secret_key';
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const secret = process.env.JWT_SECRET || 'default_secret_key';
  const expectedSignature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  if (signature !== expectedSignature) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch (e) {
    return null;
  }
}

const libraryBaseDir = path.resolve(__dirname, '..', 'library');

function resolveMediaFilePath(filePath) {
  if (!filePath) return filePath;
  let decoded = filePath;
  try { decoded = decodeURIComponent(filePath); } catch(e) {}
  
  const absPath = path.resolve(decoded);
  if (absPath.startsWith(libraryBaseDir) && fs.existsSync(absPath)) {
    return absPath;
  }
  
  const idx = decoded.indexOf('library/');
  if (idx !== -1) {
    const rel = decoded.substring(idx);
    const candidate1 = path.resolve(__dirname, '..', rel);
    if (candidate1.startsWith(libraryBaseDir) && fs.existsSync(candidate1)) return candidate1;
    
    const candidateSpaces = path.resolve(__dirname, '..', rel.replace(/_/g, ' '));
    if (candidateSpaces.startsWith(libraryBaseDir) && fs.existsSync(candidateSpaces)) return candidateSpaces;

    const candidateUnderscores = path.resolve(__dirname, '..', rel.replace(/ /g, '_'));
    if (candidateUnderscores.startsWith(libraryBaseDir) && fs.existsSync(candidateUnderscores)) return candidateUnderscores;
  }
  return absPath.startsWith(libraryBaseDir) ? absPath : null;
}

function getFfmpegPath() {
  const customBin = path.join(__dirname, '..', 'bin', 'ffmpeg');
  if (fs.existsSync(customBin)) return customBin;
  const userHome = process.env.HOME || (typeof require !== 'undefined' ? require('os').homedir() : '');
  if (userHome) {
    const userBin = path.join(userHome, 'bin', 'ffmpeg');
    if (fs.existsSync(userBin)) return userBin;
  }
  if (fs.existsSync('/usr/bin/ffmpeg')) return '/usr/bin/ffmpeg';
  if (fs.existsSync('/usr/local/bin/ffmpeg')) return '/usr/local/bin/ffmpeg';
  return 'ffmpeg';
}

function authorizeAdmin(req, res) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Unauthorized', message: 'Token de autenticación requerido' }));
    return null;
  }
  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Forbidden', message: 'Acceso denegado' }));
    return null;
  }
  return payload;
}

function authorizeUser(req, res) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Unauthorized', message: 'Token de autenticación requerido' }));
    return null;
  }
  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Unauthorized', message: 'Token inválido' }));
    return null;
  }
  return payload;
}

function isPathSafe(baseDir, targetPath) {
  const relative = path.relative(baseDir, targetPath);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function parseJsonBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('error', err => reject(err));
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limitBytes) {
        req.destroy();
        reject(new Error('Payload Too Large'));
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

async function readJsonBody(req, res) {
  try {
    return await parseJsonBody(req);
  } catch (err) {
    res.writeHead(err.message === 'Payload Too Large' ? 413 : 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message === 'Payload Too Large' ? 'Payload Too Large' : 'Bad Request', message: err.message }));
    return null;
  }
}

export { hashPassword, signToken, verifyToken };

// Global memory state for KuraStream Admin Monitoring
const logHistory = [];
const activeStreams = {};

const originalLog = console.log;
const originalError = console.error;

console.log = function(...args) {
  originalLog.apply(console, args);
  const logLine = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  logHistory.push({ type: 'LOG', time: new Date().toISOString(), message: logLine });
  if (logHistory.length > 100) logHistory.shift();
};

console.error = function(...args) {
  originalError.apply(console, args);
  const logLine = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  logHistory.push({ type: 'ERROR', time: new Date().toISOString(), message: logLine });
  if (logHistory.length > 100) logHistory.shift();
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ass': 'text/x-ass',
  '.srt': 'text/srt',
  '.vtt': 'text/vtt',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

// Helper to serve files with HTTP Range support (for seeking)
function serveFileWithRanges(filePath, req, res, contentType) {
  try {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) {
        res.writeHead(416, {
          'Content-Range': `bytes */${fileSize}`
        });
        return res.end();
      }

      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error(`Error serving file ${filePath}:`, err);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
}

// Convert Node request to Web Request to parse FormData
async function parseMultipartForm(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        value.forEach(v => headers.append(key, v));
      } else {
        headers.append(key, value);
      }
    }
  }
  const url = `http://${req.headers.host || 'localhost'}${req.url}`;
  const webReq = new Request(url, {
    method: req.method,
    headers: headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? null : Readable.toWeb(req),
    duplex: 'half'
  });
  return await webReq.formData();
}

const server = http.createServer(async (req, res) => {
  try {
    // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // --- API Routes ---

  // Verify Login / Auto-registration
  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await readJsonBody(req, res);
    if (!body) return;

    const { username, password } = body;
    if (!username || !username.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'El usuario es obligatorio' }));
    }

    if (typeof password !== 'string' || !password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'La contraseña es obligatoria' }));
    }

    let existing;
    try {
      existing = dbHelper.getUser(username);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Database Error', message: 'Error al consultar la base de datos' }));
    }

    if (existing) {
      let passwordMatch = false;
      let needsUpdate = false;

      const singleHash = hashPassword(password);
      const doubleHash = hashPassword(singleHash);

      if (existing.password === singleHash || existing.password === doubleHash || existing.password === password) {
        passwordMatch = true;
        if (existing.password !== singleHash) {
          needsUpdate = true;
        }
      }

      if (passwordMatch) {
        try {
          if (needsUpdate) {
            db.prepare("UPDATE users SET password = ? WHERE username = ?").run(singleHash, existing.username);
          }
          dbHelper.transferGuestHistory(existing.username);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Database Error', message: 'Error al actualizar el usuario' }));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          username: existing.username, 
          role: existing.role,
          token: signToken({ username: existing.username, role: existing.role })
        }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Contraseña incorrecta para este usuario' }));
      }
    } else {
      // Register automatically
      try {
        const hashedPassword = hashPassword(password);
        dbHelper.createUser(username, hashedPassword, 'user');
        dbHelper.transferGuestHistory(username);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Database Error', message: 'Error al registrar el usuario' }));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true, 
        username: username, 
        role: 'user', 
        token: signToken({ username, role: 'user' }),
        registered: true 
      }));
    }
    return;
  }

  // Explicit Register
  if (pathname === '/api/register' && req.method === 'POST') {
    const body = await readJsonBody(req, res);
    if (!body) return;

    const { username, password } = body;
    if (!username || !username.trim() || !password || !password.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Todos los campos son obligatorios' }));
    }

    let existing;
    try {
      existing = dbHelper.getUser(username);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Database Error', message: 'Error al consultar la base de datos' }));
    }

    if (existing) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'El usuario ya existe' }));
    }

    try {
      const hashedPassword = hashPassword(password);
      dbHelper.createUser(username, hashedPassword, 'user');
      dbHelper.transferGuestHistory(username);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Database Error', message: 'Error al registrar el usuario' }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, username }));
    return;
  }

  // Chat API
  if (pathname === '/api/chat' && req.method === 'GET') {
    try {
      const messages = dbHelper.getChatMessages(50);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(messages));
    } catch (err) {
      res.writeHead(500);
      res.end('Error retrieving chat');
    }
    return;
  }

  if (pathname === '/api/chat' && req.method === 'POST') {
    const body = await readJsonBody(req, res);
    if (!body) return;

    const { username, message } = body;
    if (!username || !message || !message.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Faltan campos' }));
    }

    try {
      dbHelper.saveChatMessage(username, message);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Database Error', message: 'Error al guardar el mensaje de chat' }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Comments API
  if (pathname === '/api/comments' && req.method === 'GET') {
    try {
      const showId = parsedUrl.searchParams.get('showId');
      if (!showId) {
        res.writeHead(400);
        return res.end('Missing showId');
      }
      const comments = dbHelper.getComments(showId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(comments));
    } catch (err) {
      res.writeHead(500);
      res.end('Error retrieving comments');
    }
    return;
  }

  if (pathname === '/api/comments' && req.method === 'POST') {
    const body = await readJsonBody(req, res);
    if (!body) return;

    const { showId, username, comment } = body;
    if (!showId || !username || !comment || !comment.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Faltan campos' }));
    }

    try {
      dbHelper.saveComment(showId, username, comment);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Database Error', message: 'Error al guardar el comentario' }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Debug Log from browser
  if (pathname === '/api/debug-log' && req.method === 'POST') {
    const parsed = await readJsonBody(req, res);
    if (!parsed) return;
    try {
      console.log(`Browser log: [${parsed.type}] ${parsed.message}`);
      const logLine = `[${new Date().toISOString()}] ${parsed.type || 'ERROR'}: ${parsed.message} | Stack: ${parsed.stack || 'N/A'}\n`;
      await fsPromises.appendFile(path.join(__dirname, '..', 'browser_errors.log'), logLine);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500);
      res.end('Error logging');
    }
    return;
  }

  // Get all shows
  if (pathname === '/api/shows' && req.method === 'GET') {
    let isKids = false;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      if (payload && payload.is_kids) {
        isKids = true;
      }
    }
    const type = parsedUrl.searchParams.get('type') || 'all';
    const statusParam = parsedUrl.searchParams.get('status');
    const sortParam = parsedUrl.searchParams.get('sort');

    let shows = dbHelper.getShows(type, isKids);
    if (statusParam && statusParam !== 'all') {
      shows = shows.filter(s => (s.status || 'finished') === statusParam);
    }
    if (sortParam) {
      shows = [...shows].sort((a, b) => {
        if (sortParam === 'year_desc') return (b.year || 0) - (a.year || 0);
        if (sortParam === 'year_asc') return (a.year || 0) - (b.year || 0);
        if (sortParam === 'rating_desc') return (b.rating || 0) - (a.rating || 0);
        if (sortParam === 'title_asc') return a.title.localeCompare(b.title);
        return 0;
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(shows));
  }

  // Get Weekly Simulcast Calendar Schedule
  if (pathname === '/api/calendar/schedule' && req.method === 'GET') {
    try {
      const schedule = await fetchWeeklyCalendar();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(schedule));
    } catch (err) {
      console.error("Calendar schedule error:", err);
      res.writeHead(500);
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // Toggle Show Airing Status (Admin)
  if (pathname === '/api/admin/toggle-show-status' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { showId, status } = JSON.parse(body || '{}');
        if (!showId || !status) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'showId and status required' }));
        }
        const show = dbHelper.getShow(showId);
        if (!show) {
          res.writeHead(404);
          return res.end(JSON.stringify({ error: 'Show not found' }));
        }
        show.status = status;
        dbHelper.saveShow(show);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, show }));
      } catch (err) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Search TMDB
  if (pathname === '/api/shows/search' && req.method === 'GET') {
    const query = parsedUrl.searchParams.get('query');
    const type = parsedUrl.searchParams.get('type') || 'anime';
    if (!query) {
      res.writeHead(400);
      return res.end('Query required');
    }
    try {
      const results = await scraper.search(query, type);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(results));
    } catch (err) {
      res.writeHead(500);
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // Get Random Show
  if (pathname === '/api/shows/random' && req.method === 'GET') {
    const show = dbHelper.getRandomShow();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, show }));
  }

  // Get User Notifications
  if (pathname === '/api/notifications' && req.method === 'GET') {
    const username = parsedUrl.searchParams.get('username') || 'guest';
    const profile = parsedUrl.searchParams.get('profile_name') || 'Principal';
    const notifications = dbHelper.getNotifications(username, profile);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, notifications }));
  }

  // Get individual show details & episodes
  if (pathname.startsWith('/api/shows/') && req.method === 'GET') {
    const id = pathname.split('/').pop();
    const show = dbHelper.getShow(id);
    if (!show) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Show not found' }));
    }

    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      if (payload && payload.is_kids && (show.age_rating === 'TV-MA' || show.age_rating === 'R')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Forbidden' }));
      }
    }

    if (!show.trailer_key && show.id) {
      scraper.getDetails(show.id, show.media_type || 'anime').then(details => {
        if (details && details.trailer_key) {
          show.trailer_key = details.trailer_key;
          dbHelper.saveShow(show);
        }
      }).catch(e => {});
    }

    const episodes = dbHelper.getEpisodes(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ show, episodes }));
  }

  // Delete a show
  if (pathname.startsWith('/api/shows/') && req.method === 'DELETE') {
    const admin = authorizeAdmin(req, res);
    if (!admin) return;
    const rawId = pathname.split('/').pop();
    const id = decodeURIComponent(rawId);
    const show = dbHelper.getShow(id) || dbHelper.getShow(rawId);
    if (!show) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Anime o película no encontrada' }));
    }
    
    // Delete files physically from both Anime and Movies (and lowercase variants)
    const possibleDirs = ['Anime', 'Movies', 'anime', 'movies'];
    const searchFolderNames = [
      show.id,
      show.title.replace(/[\\/:*?"<>|]/g, '_'),
      show.title.replace(/[^a-zA-Z0-9_]/g, '_').replace(/\s+/g, '_')
    ];
    if (show.poster_path && show.poster_path.startsWith('/library/')) {
      const parts = show.poster_path.split('/');
      if (parts.length >= 4) searchFolderNames.push(parts[3]);
    }

    for (const cat of possibleDirs) {
      const parentDir = path.join(__dirname, '..', 'library', cat);
      try {
        const existingFolders = await fsPromises.readdir(parentDir);
        for (const f of existingFolders) {
          const lowerF = f.toLowerCase();
          const matches = searchFolderNames.some(name => lowerF === name.toLowerCase() || lowerF.includes(name.toLowerCase()));
          if (matches) {
            const targetPath = path.join(parentDir, f);
            await fsPromises.rm(targetPath, { recursive: true, force: true });
            console.log(`Physically deleted show directory: ${targetPath}`);
          }
        }
      } catch (e) {}
    }
    
    dbHelper.deleteShow(show.id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, message: 'Anime eliminado con éxito' }));
  }

  // Watch progress routes
  if (pathname.startsWith('/api/progress/') && req.method === 'GET') {
    const episodeId = pathname.split('/').pop();
    const username = parsedUrl.searchParams.get('username') || 'guest';
    let profileName = 'Principal';
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      if (payload && payload.profile_name) {
        profileName = payload.profile_name;
      }
    }
    const progress = dbHelper.getWatchProgress(username, episodeId, profileName);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ progress }));
  }

  if (pathname.startsWith('/api/progress/') && req.method === 'POST') {
    const episodeId = pathname.split('/').pop();
    const body = await readJsonBody(req, res);
    if (!body) return;

    const { progress, username = 'guest' } = body;
    let profileName = 'Principal';
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      if (payload && payload.profile_name) {
        profileName = payload.profile_name;
      }
    }
    try {
      dbHelper.saveWatchProgress(username, episodeId, progress, profileName);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Database Error', message: 'Error al guardar el progreso' }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  // Get recently watched history
  if (pathname === '/api/history' && req.method === 'GET') {
    const username = parsedUrl.searchParams.get('username') || 'guest';
    let profileName = parsedUrl.searchParams.get('profile_name') || 'Principal';
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      if (payload && payload.profile_name) {
        profileName = payload.profile_name;
      }
    }
    const history = dbHelper.getHistory(username, profileName);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(history));
  }

  if (pathname === '/api/history' && req.method === 'DELETE') {
    const username = parsedUrl.searchParams.get('username') || 'guest';
    let profileName = parsedUrl.searchParams.get('profile_name') || 'Principal';
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      if (payload && payload.profile_name) {
        profileName = payload.profile_name;
      }
    }
    const episodeId = parsedUrl.searchParams.get('episode_id');
    const clear = parsedUrl.searchParams.get('clear');
    if (clear === 'all') {
      dbHelper.clearUserHistory(username, profileName);
    } else if (episodeId) {
      dbHelper.deleteHistoryItem(username, profileName, episodeId);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }

  if (pathname === '/api/user/stats' && req.method === 'GET') {
    const username = parsedUrl.searchParams.get('username') || 'guest';
    let profileName = parsedUrl.searchParams.get('profile_name') || 'Principal';
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      if (payload && payload.profile_name) {
        profileName = payload.profile_name;
      }
    }
    const stats = dbHelper.getUserStats(username, profileName);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, stats }));
  }

  // Favorites (My List) routes
  if (pathname === '/api/favorites' && req.method === 'GET') {
    const username = parsedUrl.searchParams.get('username') || 'guest';
    let profileName = parsedUrl.searchParams.get('profile_name') || 'Principal';
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      if (payload && payload.profile_name) {
        profileName = payload.profile_name;
      }
    }
    const favorites = dbHelper.getFavorites(username, profileName);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(favorites));
  }

  if (pathname === '/api/favorites/check' && req.method === 'GET') {
    const username = parsedUrl.searchParams.get('username') || 'guest';
    const showId = parsedUrl.searchParams.get('showId');
    let profileName = 'Principal';
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      if (payload && payload.profile_name) {
        profileName = payload.profile_name;
      }
    }
    const isFav = dbHelper.isFavorite(username, showId, profileName);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ isFavorite: isFav }));
  }

  if (pathname === '/api/favorites' && req.method === 'POST') {
    const body = await readJsonBody(req, res);
    if (!body) return;

    const { username, showId, isFavorite } = body;
    let profileName = 'Principal';
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      if (payload && payload.profile_name) {
        profileName = payload.profile_name;
      }
    }
    try {
      dbHelper.toggleFavorite(username || 'guest', showId, isFavorite, profileName);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Database Error', message: 'Error al actualizar favoritos' }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Profiles routes
  if (pathname === '/api/profiles' && req.method === 'GET') {
    const user = authorizeUser(req, res);
    if (!user) return;
    try {
      const profiles = dbHelper.getProfiles(user.username);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, profiles }));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Internal Server Error' }));
    }
  }

  if (pathname === '/api/profiles' && req.method === 'POST') {
    const user = authorizeUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req, res);
    if (!body) return;
    const { profile_name, avatar_color, is_kids, pin, avatar_image } = body;

    if (typeof profile_name !== 'string' || profile_name.trim() === '' || profile_name.length > 25) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Invalid profile_name: must be a non-empty string max 25 characters' }));
    }
    if (pin && (typeof pin !== 'string' || !/^\d{4}$/.test(pin))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Invalid PIN: must be 4 digits' }));
    }

    let finalAvatarColor = avatar_color;

    if (avatar_image && avatar_image.startsWith('data:image/')) {
      const base64Data = avatar_image.split(';base64,').pop();
      const filename = `${user.username}_${profile_name.replace(/\s+/g, '_')}_${Date.now()}.jpg`;
      const avatarsDir = path.resolve(__dirname, '..', 'library', 'avatars');
      if (!fs.existsSync(avatarsDir)) {
        fs.mkdirSync(avatarsDir, { recursive: true });
      }
      const filePath = path.join(avatarsDir, filename);
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
      finalAvatarColor = `/library/avatars/${filename}`;
    }

    try {
      dbHelper.createProfile({
        username: user.username,
        profile_name,
        avatar_color: finalAvatarColor,
        is_kids,
        pin
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        console.warn(`Profile creation failed, name already exists: ${profile_name}`);
        res.writeHead(409, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'El nombre de perfil ya está en uso.' }));
      }
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Internal Server Error' }));
    }
  }

  if (pathname === '/api/profiles/select' && req.method === 'POST') {
    const user = authorizeUser(req, res);
    if (!user) return;
    const body = await readJsonBody(req, res);
    if (!body) return;
    const { profile_name, pin } = body;
    try {
      const profile = dbHelper.getProfileByName(user.username, profile_name);
      if (!profile) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Profile not found' }));
      }
      if (profile.pin && profile.pin !== pin) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Invalid PIN' }));
      }
      const token = signToken({
        username: user.username,
        profile_name: profile.profile_name,
        role: user.role,
        is_kids: !!profile.is_kids,
        profile_color: profile.avatar_color
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, token, profile }));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Internal Server Error' }));
    }
  }

  if (pathname.startsWith('/api/profiles/') && pathname !== '/api/profiles/select' && req.method === 'PUT') {
    const user = authorizeUser(req, res);
    if (!user) return;
    const profile_name = decodeURIComponent(pathname.split('/').pop());

    if (typeof profile_name !== 'string' || profile_name.trim() === '' || profile_name.length > 25) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Invalid profile_name: must be a non-empty string max 25 characters' }));
    }

    const body = await readJsonBody(req, res);
    if (!body) return;
    const { avatar_color, is_kids, pin, avatar_image } = body;

    if (pin && (typeof pin !== 'string' || !/^\d{4}$/.test(pin))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Invalid PIN: must be 4 digits' }));
    }

    let finalAvatarColor = avatar_color;

    if (avatar_image && avatar_image.startsWith('data:image/')) {
      const base64Data = avatar_image.split(';base64,').pop();
      const filename = `${user.username}_${profile_name.replace(/\s+/g, '_')}_${Date.now()}.jpg`;
      const avatarsDir = path.resolve(__dirname, '..', 'library', 'avatars');
      if (!fs.existsSync(avatarsDir)) {
        fs.mkdirSync(avatarsDir, { recursive: true });
      }
      const filePath = path.join(avatarsDir, filename);
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
      finalAvatarColor = `/library/avatars/${filename}`;
    }

    try {
      dbHelper.updateProfile({
        username: user.username,
        profile_name,
        avatar_color: finalAvatarColor,
        is_kids,
        pin
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Internal Server Error' }));
    }
  }

  if (pathname.startsWith('/api/profiles/') && pathname !== '/api/profiles/select' && req.method === 'DELETE') {
    const user = authorizeUser(req, res);
    if (!user) return;
    const profile_name = decodeURIComponent(pathname.split('/').pop());
    try {
      dbHelper.deleteProfile(user.username, profile_name);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true }));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'Internal Server Error' }));
    }
  }

  // Import media (Local File Import - recommended for offline)
  if (pathname === '/api/import' && req.method === 'POST') {
    const admin = authorizeAdmin(req, res);
    if (!admin) return;
    try {
      const formData = await parseMultipartForm(req);
      const videoFile = formData.get('videoFile');
      const sourcePath = formData.get('sourcePath') || '';
      const title = formData.get('title') || '';
      const mediaType = formData.get('mediaType') || 'anime';
      const seasonNumber = formData.get('seasonNumber') ? parseInt(formData.get('seasonNumber'), 10) : 1;
      const episodeNumber = formData.get('episodeNumber') ? parseInt(formData.get('episodeNumber'), 10) : 1;
      const episodeTitle = formData.get('episodeTitle') || '';
      const tmdbId = formData.get('tmdbId') || '';
      const startSec = formData.get('startSeconds');
      const startSeconds = startSec ? parseFloat(startSec) : null;

      if ((!videoFile || videoFile.size === 0) && !sourcePath) {
        res.writeHead(400);
        return res.end('Falta el archivo de video o la ruta local de origen.');
      }

      const sanitizedTitle = title.replace(/[\\/:*?"<>|]/g, '_');

      // Fetch TMDB metadata first to determine showId and check for duplicates
      let showDetails = null;
      try {
        if (tmdbId) {
          showDetails = await scraper.getDetails(tmdbId, mediaType);
        } else {
          const searchResults = await scraper.search(title, mediaType);
          if (searchResults.length > 0) {
            showDetails = await scraper.getDetails(searchResults[0].tmdb_id, mediaType);
          }
        }
      } catch (e) {
        console.warn("Could not retrieve TMDB metadata during import duplicate check:", e);
      }

      const showId = showDetails ? showDetails.id : sanitizedTitle;

      // Duplicate check & overwrite handling
      if (mediaType !== 'movie') {
        const episodeId = `${showId}_S${seasonNumber || 1}_E${episodeNumber || 1}`;
        const existingEpisode = dbHelper.getEpisode(episodeId);
        if (existingEpisode) {
          console.log(`[Import] Episode ${episodeId} already exists. Updating with new file upload...`);
        }
      }

      // Organize file structure
      const mediaTypeDir = mediaType === 'movie' ? 'Movies' : 'Anime';
      const originalName = videoFile && videoFile.size > 0 ? videoFile.name : path.basename(sourcePath);
      const ext = path.extname(originalName).toLowerCase();
      const whitelist = ['.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v'];
      if (!whitelist.includes(ext)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Bad Request', message: 'Formato de video no soportado' }));
      }
      
      let destDir = '';
      let destFileName = '';
      
      if (mediaType === 'movie') {
        destDir = path.join(__dirname, '..', 'library', mediaTypeDir, sanitizedTitle);
        destFileName = `${sanitizedTitle}${ext}`;
      } else {
        const seasonStr = `Season ${String(seasonNumber || 1).padStart(2, '0')}`;
        destDir = path.join(__dirname, '..', 'library', mediaTypeDir, sanitizedTitle, seasonStr);
        
        const sNum = String(seasonNumber || 1).padStart(2, '0');
        const eNum = String(episodeNumber || 1).padStart(2, '0');
        const epTitleStr = episodeTitle ? ` - ${episodeTitle.replace(/[\\/:*?"<>|]/g, '_')}` : '';
        destFileName = `${sanitizedTitle} - S${sNum}E${eNum}${epTitleStr}${ext}`;
      }

      const destPath = path.join(destDir, destFileName);
      await fsPromises.mkdir(destDir, { recursive: true });

      // Save video file
      if (videoFile && videoFile.size > 0) {
        const buffer = Buffer.from(await videoFile.arrayBuffer());
        await fsPromises.writeFile(destPath, buffer);
      } else {
        // Check if source file exists
        try {
          await fsPromises.access(sourcePath);
        } catch (e) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: `El archivo de origen no existe en la ruta: ${sourcePath}` }));
        }
        await fsPromises.copyFile(sourcePath, destPath);
      }

      // Get technical metadata via ffprobe
      const techDetails = await probeVideo(destPath);

      // Show Folder Details
      const showFolder = path.join(__dirname, '..', 'library', mediaTypeDir, sanitizedTitle);
      let localPosterName = '';
      let localBackdropName = '';

      if (showDetails) {
        if (showDetails.poster_path) {
          localPosterName = await downloadImage(showDetails.poster_path, path.join(showFolder, 'poster.jpg'));
        }
        if (showDetails.backdrop_path) {
          localBackdropName = await downloadImage(showDetails.backdrop_path, path.join(showFolder, 'backdrop.jpg'));
        }
      }

      // Save show details to DB
      dbHelper.saveShow({
        id: showId,
        title: showDetails ? showDetails.title : title,
        synopsis: showDetails ? showDetails.synopsis : '',
        rating: showDetails ? showDetails.rating : 0.0,
        year: showDetails ? showDetails.year : null,
        studio: showDetails ? showDetails.studio : '',
        director: showDetails ? showDetails.director : '',
        writer: showDetails ? showDetails.writer : '',
        cast_members: showDetails ? showDetails.cast_members : [],
        poster_path: localPosterName ? `/library/${mediaTypeDir}/${sanitizedTitle}/${localPosterName}` : '',
        backdrop_path: localBackdropName ? `/library/${mediaTypeDir}/${sanitizedTitle}/${localBackdropName}` : '',
        media_type: mediaType,
        genres: showDetails ? showDetails.genres : ''
      });

      // Fetch episode metadata & thumbnail if TV
      let epTitle = episodeTitle;
      let epSynopsis = '';
      let epStillPath = null;
      if (mediaType === 'anime' && showDetails) {
        const seasonEps = await scraper.getSeasonEpisodes(showDetails.id, seasonNumber || 1);
        const tmdbEp = seasonEps.find(e => e.episode_number === parseInt(episodeNumber || 1, 10));
        if (tmdbEp) {
          epTitle = tmdbEp.title;
          epSynopsis = tmdbEp.synopsis;
          epStillPath = tmdbEp.still_path;
        }
      }

      // Generate or Download Episode Thumbnail
      const thumbFileName = `ep_S${seasonNumber || 1}_E${episodeNumber || 1}_thumb.jpg`;
      const thumbFileDest = path.join(showFolder, thumbFileName);
      let localThumbUrl = '';

      if (epStillPath) {
        const downloaded = await downloadImage(epStillPath, thumbFileDest);
        if (downloaded) {
          localThumbUrl = `/library/${mediaTypeDir}/${sanitizedTitle}/${thumbFileName}`;
        }
      }

      if (!localThumbUrl) {
        const extracted = await extractEpisodeThumbnail(destPath, thumbFileDest);
        if (extracted) {
          localThumbUrl = `/library/${mediaTypeDir}/${sanitizedTitle}/${thumbFileName}`;
        }
      }

      // Save Episode details
      const episodeId = `${showId}_S${seasonNumber || 1}_E${episodeNumber || 1}`;
      dbHelper.saveEpisode({
        id: episodeId,
        show_id: showId,
        season_number: parseInt(seasonNumber || 1, 10),
        episode_number: parseInt(episodeNumber || 1, 10),
        title: epTitle || `Capítulo ${episodeNumber}`,
        synopsis: epSynopsis || '',
        filepath: destPath,
        duration: techDetails.duration,
        size: techDetails.size,
        video_codec: techDetails.video_codec,
        resolution: techDetails.resolution,
        fps: techDetails.fps,
        audio_tracks: techDetails.audio_tracks,
        subtitle_tracks: techDetails.subtitle_tracks,
        thumbnail_path: localThumbUrl
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, episodeId }));
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname.startsWith('/api/admin/') && pathname !== '/api/admin/login') {
    const admin = authorizeAdmin(req, res);
    if (!admin) return;
  }

  let currentDisplayPowerState = 'on';

  // Helper for display power control (laptop backlight management)
  function setLaptopDisplayPower(state) {
    const isOff = state === 'off';
    currentDisplayPowerState = isOff ? 'off' : 'on';
    
    // 1. Sysfs backlight bl_power & brightness
    try {
      const sysPath = '/sys/class/backlight';
      if (fs.existsSync(sysPath)) {
        const devices = fs.readdirSync(sysPath);
        for (const dev of devices) {
          const blPowerPath = path.join(sysPath, dev, 'bl_power');
          const brightnessPath = path.join(sysPath, dev, 'brightness');
          const maxBrightPath = path.join(sysPath, dev, 'max_brightness');

          if (fs.existsSync(blPowerPath)) {
            try { fs.writeFileSync(blPowerPath, isOff ? '4' : '0'); } catch(e) {}
          }
          if (fs.existsSync(brightnessPath)) {
            let targetBright = '0';
            if (!isOff) {
              if (fs.existsSync(maxBrightPath)) {
                targetBright = fs.readFileSync(maxBrightPath, 'utf8').trim() || '9';
              } else {
                targetBright = '9';
              }
            }
            try { fs.writeFileSync(brightnessPath, targetBright); } catch(e) {}
          }
        }
      }
    } catch(e) {}

    // 2. Framebuffer blanking
    try {
      const fbBlankPath = '/sys/class/graphics/fb0/blank';
      if (fs.existsSync(fbBlankPath)) {
        try { fs.writeFileSync(fbBlankPath, isOff ? '1' : '0'); } catch(e) {}
      }
    } catch(e) {}

    // 3. Brightnessctl, vbetool, xrandr & setterm commands
    try {
      if (isOff) {
        try { execSync('brightnessctl set 0 2>/dev/null'); } catch(e) {}
        try { execSync('xrandr --output $(xrandr | grep " connected" | cut -f1 -d" " | head -n1) --off 2>/dev/null'); } catch(e) {}
        try { execSync('vbetool dpms off 2>/dev/null'); } catch(e) {}
        try { execSync('for tty in /dev/tty[0-6]; do setterm --blank force > $tty 2>/dev/null; done'); } catch(e) {}
        try { execSync('xset -display :0 dpms force off 2>/dev/null'); } catch(e) {}
      } else {
        try { execSync('brightnessctl set 100% 2>/dev/null'); } catch(e) {}
        try { execSync('xrandr --output $(xrandr | grep " connected" | cut -f1 -d" " | head -n1) --auto 2>/dev/null'); } catch(e) {}
        try { execSync('vbetool dpms on 2>/dev/null'); } catch(e) {}
        try { execSync('for tty in /dev/tty[0-6]; do setterm --blank poke > $tty 2>/dev/null; done'); } catch(e) {}
        try { execSync('xset -display :0 dpms force on 2>/dev/null'); } catch(e) {}
      }
    } catch(e) {}

    return currentDisplayPowerState;
  }

  function getLaptopDisplayPower() {
    try {
      const sysPath = '/sys/class/backlight';
      if (fs.existsSync(sysPath)) {
        const devices = fs.readdirSync(sysPath);
        for (const dev of devices) {
          const brightnessPath = path.join(sysPath, dev, 'brightness');
          const blPowerPath = path.join(sysPath, dev, 'bl_power');
          if (fs.existsSync(brightnessPath)) {
            const bVal = fs.readFileSync(brightnessPath, 'utf8').trim();
            if (bVal === '0') return 'off';
          }
          if (fs.existsSync(blPowerPath)) {
            const val = fs.readFileSync(blPowerPath, 'utf8').trim();
            if (val === '4') return 'off';
          }
        }
      }
    } catch(e) {}
    return currentDisplayPowerState;
  }

  // Display Power Endpoints
  if (pathname === '/api/admin/display/status' && req.method === 'GET') {
    const status = getLaptopDisplayPower();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, status }));
    return;
  }

  if (pathname === '/api/admin/display/power' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { state } = JSON.parse(body || '{}');
        const finalState = setLaptopDisplayPower(state);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          status: finalState,
          message: finalState === 'off' ? 'Pantalla apagada (Modo Anti-Calentamiento activo)' : 'Pantalla encendida'
        }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // TMDB Candidate Search
  if (pathname === '/api/admin/search-tmdb-candidates' && req.method === 'GET') {
    try {
      const queryVal = parsedUrl.searchParams.get('query');
      const typeVal = parsedUrl.searchParams.get('type') || 'anime';
      if (!queryVal) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Término de búsqueda requerido' }));
      }
      const results = await scraper.search(queryVal, typeVal);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, results }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 1-Click Show Creator from TMDB
  if (pathname === '/api/admin/create-show-tmdb' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { tmdb_id, media_type, age_rating } = JSON.parse(body);
        if (!tmdb_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'tmdb_id es requerido' }));
        }
        const mType = media_type || 'anime';
        const details = await scraper.getDetails(tmdb_id, mType);
        if (!details) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'No se encontraron detalles en TMDB' }));
        }

        const typeDir = mType === 'movie' ? 'Movies' : 'Anime';
        const safeTitle = details.title.replace(/[\/\\?%*:|"<>]/g, '_');
        const showDir = path.join(__dirname, '..', 'library', typeDir, safeTitle);
        if (!fs.existsSync(showDir)) fs.mkdirSync(showDir, { recursive: true });

        let posterLocal = '';
        let backdropLocal = '';
        if (details.poster_path) {
          const posterExt = path.extname(details.poster_path) || '.jpg';
          const posterDest = path.join(showDir, `poster${posterExt}`);
          await scraper.downloadImage(details.poster_path, posterDest);
          posterLocal = `/library/${typeDir}/${safeTitle}/poster${posterExt}`;
        }
        if (details.backdrop_path) {
          const backdropExt = path.extname(details.backdrop_path) || '.jpg';
          const backdropDest = path.join(showDir, `backdrop${backdropExt}`);
          await scraper.downloadImage(details.backdrop_path, backdropDest);
          backdropLocal = `/library/${typeDir}/${safeTitle}/backdrop${backdropExt}`;
        }

        const showRecord = {
          id: String(details.id),
          title: details.title,
          synopsis: details.synopsis || '',
          rating: details.rating || 0,
          year: details.year || new Date().getFullYear(),
          studio: details.studio || '',
          director: details.director || '',
          writer: details.writer || '',
          cast_members: JSON.stringify(details.cast_members || []),
          poster_path: posterLocal || details.poster_path || '',
          backdrop_path: backdropLocal || details.backdrop_path || '',
          media_type: mType,
          backdrop_loops: '[]',
          genres: (details.genres || []).join(','),
          trailer_key: details.trailer_key || '',
          age_rating: age_rating || 'TV-14'
        };

        dbHelper.saveShow(showRecord);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, show: showRecord }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 1-Click Server Repair & Sync
  if (pathname === '/api/admin/repair-library' && req.method === 'POST') {
    try {
      dbHelper.syncDatabaseWithDisk();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Biblioteca auditada y reparada con éxito' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Get episodes for a show (Admin view)
  if (pathname.startsWith('/api/admin/shows/') && pathname.endsWith('/episodes') && req.method === 'GET') {
    const parts = pathname.split('/');
    const showId = parts[parts.length - 2];
    const episodes = dbHelper.getEpisodes(showId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, episodes }));
    return;
  }

  // Delete an episode (Admin view)
  if (pathname.startsWith('/api/admin/episodes/') && pathname.endsWith('/delete') && req.method === 'POST') {
    const parts = pathname.split('/');
    const episodeId = parts[parts.length - 2];
    const ep = dbHelper.getEpisode(episodeId);
    if (ep) {
      db.prepare("DELETE FROM episodes WHERE id = ?").run(episodeId);
      db.prepare("DELETE FROM watch_history WHERE episode_id = ?").run(episodeId);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Trigger library scan
  if (pathname === '/api/admin/scan' && req.method === 'POST') {
    try {
      await runLibraryScan();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Scrape and download show cover
  if (pathname === '/api/admin/scrape-show-cover' && req.method === 'POST') {
    const body = await readJsonBody(req, res);
    if (!body) return;

    const { showId, query } = body;
    if (!showId || !query) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'showId and query are required' }));
    }

    try {
      let show = await downloadAndSetShowCover(showId, query);
      if (!show) {
        // Fallback to placeholder SVG poster
        const dbShow = dbHelper.getShow(showId);
        if (dbShow) {
          dbShow.poster_path = `/api/placeholder-poster?title=${encodeURIComponent(query || dbShow.title)}`;
          dbHelper.saveShow(dbShow);
          show = dbShow;
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, show }));
    } catch (err) {
      console.error(err);
      const dbShow = dbHelper.getShow(showId);
      if (dbShow) {
        dbShow.poster_path = `/api/placeholder-poster?title=${encodeURIComponent(query || dbShow.title)}`;
        dbHelper.saveShow(dbShow);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, show: dbShow }));
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Live Nyaa Torrent Search
  if (pathname === '/api/admin/torrents/search' && req.method === 'GET') {
    try {
      const q = parsedUrl.searchParams.get('q') || '';
      const filterSpanish = parsedUrl.searchParams.get('filterSpanish') === '1';
      const results = await searchNyaaTorrents(q, filterSpanish);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, results }));
    } catch (err) {
      console.error('[Torrents Search Error]:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // Add Manual Torrent to Download Queue
  if (pathname === '/api/admin/torrents/add' && req.method === 'POST') {
    const body = await readJsonBody(req, res);
    if (!body) return;

    const { torrentUrl, title } = body;
    if (!torrentUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'torrentUrl es requerido' }));
    }

    try {
      await addManualTorrent(torrentUrl, title);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'Torrent añadido a la cola de descarga con éxito' }));
    } catch (err) {
      console.error('[Torrents Add Error]:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // Start Queue Processing Manually
  if (pathname === '/api/admin/autodownload/queue/start' && req.method === 'POST') {
    try {
      const ok = await startManualQueueProcessing();
      const status = getAutoDownloaderStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, status, message: ok ? 'Descargas iniciadas con éxito' : 'Ya hay una descarga activa' }));
    } catch (err) {
      console.error('[Start Queue Error]:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // Admin Update Show Title & Rename Folder
  if (pathname === '/api/admin/update-show-title' && req.method === 'POST') {
    const body = await readJsonBody(req, res);
    if (!body) return;

    const { showId, newTitle } = body;
    if (!showId || !newTitle) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'showId y newTitle son requeridos' }));
    }

    try {
      const ok = await dbHelper.updateShowTitleAndPath(showId, newTitle);
      if (!ok) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'No se encontró el anime o el título no es válido' }));
      }

      await runLibraryScan();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Título y carpeta actualizados con éxito' }));
    } catch (err) {
      console.error('[Update Show Title Error]:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // SAID Trigger
  if (pathname === '/api/admin/detect-intros' && req.method === 'POST') {
    const body = await readJsonBody(req, res);
    if (!body) return;

    const { showId, seasonNumber } = body;
    if (!showId || !seasonNumber) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'showId and seasonNumber required' }));
    }
    
    try {
      const result = await detectIntrosForSeason(showId, seasonNumber);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Database/Detection Error', message: e.message }));
    }
    return;
  }

  // Admin stats
  if (pathname === '/api/admin/stats' && req.method === 'GET') {
    try {
      const stats = dbHelper.getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Admin system logs
  if (pathname === '/api/admin/logs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ logs: logHistory }));
    return;
  }

  // Admin active streams
  if (pathname === '/api/admin/active-streams' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ streams: Object.values(activeStreams) }));
    return;
  }

  // Admin AutoDownloader Status
  if (pathname === '/api/admin/autodownload/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getAutoDownloaderStatus()));
    return;
  }

  // Admin AutoDownloader Toggle
  if (pathname === '/api/admin/autodownload/toggle' && req.method === 'POST') {
    const body = await readJsonBody(req, res);
    const enable = body && typeof body.enable === 'boolean' ? body.enable : !getAutoDownloaderStatus().isEnabled;
    if (enable) {
      startAutoDownloader();
    } else {
      stopAutoDownloader();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getAutoDownloaderStatus()));
    return;
  }

  // Admin AutoDownloader Scan
  if (pathname === '/api/admin/autodownload/scan' && req.method === 'POST') {
    const result = await runAutoScan();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // Admin AutoDownloader Remove Queue Item
  if (pathname === '/api/admin/autodownload/queue/remove' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const success = removeFromQueue(parsed.index);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success, status: getAutoDownloaderStatus() }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Admin AutoDownloader Cancel Active Download
  if (pathname === '/api/admin/autodownload/cancel-active' && req.method === 'POST') {
    const success = cancelActiveDownload();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success, status: getAutoDownloaderStatus() }));
    return;
  }

  // Admin AutoDownloader Clear Entire Queue
  if (pathname === '/api/admin/autodownload/queue/clear' && req.method === 'POST') {
    const success = clearQueue();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success, status: getAutoDownloaderStatus() }));
    return;
  }

  // Dynamic Generic Fallback Poster SVG Generator
  if (pathname === '/api/placeholder-poster' && req.method === 'GET') {
    const titleVal = parsedUrl.searchParams.get('title') || 'KuraStream Anime';
    const cleanTitle = titleVal.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750" viewBox="0 0 500 750">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#180b2b" />
          <stop offset="50%" stop-color="#0f172a" />
          <stop offset="100%" stop-color="#030712" />
        </linearGradient>
        <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#a855f7" />
          <stop offset="100%" stop-color="#00e08f" />
        </linearGradient>
      </defs>
      <rect width="500" height="750" fill="url(#bg)" />
      <circle cx="250" cy="280" r="140" fill="#a855f7" opacity="0.08" />
      <rect x="40" y="40" width="420" height="670" rx="16" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.1)" stroke-width="1.5" />
      <text x="250" y="120" font-family="'Segoe UI', Roboto, sans-serif" font-weight="900" font-size="28" fill="url(#accent)" text-anchor="middle" letter-spacing="4">KURASTREAM</text>
      <rect x="180" y="145" width="140" height="3" fill="url(#accent)" rx="1.5" />
      <g transform="translate(250, 310)">
        <polygon points="-40,-50 50,0 -40,50" fill="#00e08f" opacity="0.8" />
      </g>
      <text x="250" y="520" font-family="'Segoe UI', Roboto, sans-serif" font-weight="800" font-size="30" fill="#ffffff" text-anchor="middle">${cleanTitle}</text>
      <text x="250" y="560" font-family="'Segoe UI', Roboto, sans-serif" font-size="16" fill="#94a3b8" text-anchor="middle">CONTENIDO MULTIMEDIA</text>
    </svg>`;
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
    res.end(svg);
    return;
  }

  // GET /api/admin/staged - List all pending staged imports
  if (pathname === '/api/admin/staged' && req.method === 'GET') {
    const staged = dbHelper.getStagedImports();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(staged));
    return;
  }

  // POST /api/admin/staged/:id/publish - Zero-copy move & publish to main catalog
  if (pathname.startsWith('/api/admin/staged/') && pathname.endsWith('/publish') && req.method === 'POST') {
    const parts = pathname.split('/');
    const stageId = parts[4];
    const item = dbHelper.getStagedImport(stageId);

    if (!item) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Staged item not found' }));
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const cleanTitle = (payload.clean_title || item.clean_title || item.raw_title).replace(/[\\/:*?"<>|]/g, '_').trim();
        const mediaType = payload.media_type || item.media_type || 'anime';
        const season = payload.season || item.season || 1;
        const episode = payload.episode || item.episode || 1;
        const seasonPad = String(season).padStart(2, '0');
        const epPad = String(episode).padStart(2, '0');
        const ext = path.extname(item.file_path) || '.mkv';

        const categoryDir = mediaType === 'movie' ? 'Movies' : 'Anime';
        const targetDir = mediaType === 'movie' 
          ? path.join(__dirname, '..', 'library', categoryDir, cleanTitle)
          : path.join(__dirname, '..', 'library', categoryDir, cleanTitle, `Season ${seasonPad}`);

        await fsPromises.mkdir(targetDir, { recursive: true });

        const targetFileName = mediaType === 'movie' ? `${cleanTitle}${ext}` : `${cleanTitle} - S${seasonPad}E${epPad}${ext}`;
        const targetPath = path.join(targetDir, targetFileName);

        // Zero-copy move with EXDEV cross-device fallback
        if (fs.existsSync(item.file_path)) {
          try {
            await fsPromises.rename(item.file_path, targetPath);
          } catch (mErr) {
            if (mErr.code === 'EXDEV' || mErr.code === 'EPERM' || mErr.code === 'EACCES') {
              await fsPromises.copyFile(item.file_path, targetPath);
              await fsPromises.unlink(item.file_path);
            } else {
              throw mErr;
            }
          }
        }

        // Delete staging entry
        dbHelper.deleteStagedImport(stageId);

        // Trigger scan to incorporate into public catalog
        await runLibraryScan();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Publicado con éxito al catálogo' }));
      } catch (err) {
        console.error('[Staged Publish Error]:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // DELETE /api/admin/staged/:id - Remove staged item and delete file
  if (pathname.startsWith('/api/admin/staged/') && req.method === 'DELETE') {
    const parts = pathname.split('/');
    const stageId = parts[4];
    const item = dbHelper.getStagedImport(stageId);

    if (item) {
      try {
        if (fs.existsSync(item.file_path)) {
          await fsPromises.unlink(item.file_path);
        }
      } catch (e) {}
      dbHelper.deleteStagedImport(stageId);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Search TMDB Helper
  if (pathname === '/api/search-tmdb' && req.method === 'GET') {
    try {
      const queryVal = parsedUrl.searchParams.get('query');
      const typeVal = parsedUrl.searchParams.get('type') || 'anime';
      const idVal = parsedUrl.searchParams.get('id');

      let details = null;
      if (idVal) {
        details = await scraper.getDetails(idVal, typeVal);
      } else if (queryVal) {
        const results = await scraper.search(queryVal, typeVal);
        if (results.length > 0) {
          details = await scraper.getDetails(results[0].tmdb_id, typeVal);
        }
      }

      if (!details) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'No se encontraron metadatos en TMDB.' }));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: details.id,
        title: details.title,
        synopsis: details.synopsis,
        rating: details.rating,
        year: details.year,
        poster_path: details.poster_path,
        backdrop_path: details.backdrop_path
      }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 1. Update logo image (File Upload)
  if (pathname === '/api/admin/upload-logo' && req.method === 'POST') {
    try {
      const formData = await parseMultipartForm(req);
      const file = formData.get('file');
      if (!file) {
        res.writeHead(400);
        return res.end('File required');
      }
      
      const destPath = path.join(__dirname, '..', 'library', 'logo.png');
      await fsPromises.mkdir(path.dirname(destPath), { recursive: true });
      
      const buffer = Buffer.from(await file.arrayBuffer());
      await fsPromises.writeFile(destPath, buffer);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, logoUrl: '/library/logo.png' }));
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 1b. Reset logo image (Delete)
  if (pathname === '/api/admin/reset-logo' && req.method === 'POST') {
    try {
      const destPath = path.join(__dirname, '..', 'library', 'logo.png');
      try {
        await fsPromises.unlink(destPath);
      } catch (e) {
        // Ignore if file doesn't exist
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 2. Update Show Poster & Backdrop (File Upload)
  if (pathname === '/api/admin/upload-show-media' && req.method === 'POST') {
    try {
      const formData = await parseMultipartForm(req);
      const showId = formData.get('showId');
      const posterFile = formData.get('poster');
      const backdropFile = formData.get('backdrop');
      
      const show = dbHelper.getShow(showId);
      if (!show) {
        res.writeHead(404);
        return res.end('Show not found');
      }
      
      const mediaTypeDir = show.media_type === 'movie' ? 'Movies' : 'Anime';
      const sanitizedTitle = show.title.replace(/[\\/:*?"<>|]/g, '_');
      const showFolder = path.join(__dirname, '..', 'library', mediaTypeDir, sanitizedTitle);
      await fsPromises.mkdir(showFolder, { recursive: true });
      
      let finalPosterUrl = show.poster_path;
      let finalBackdropUrl = show.backdrop_path;
      
      if (posterFile && posterFile.size > 0) {
        const ext = path.extname(posterFile.name) || '.jpg';
        const destPoster = path.join(showFolder, `poster${ext}`);
        const buffer = Buffer.from(await posterFile.arrayBuffer());
        await fsPromises.writeFile(destPoster, buffer);
        finalPosterUrl = `/library/${mediaTypeDir}/${sanitizedTitle}/poster${ext}`;
      }
      
      if (backdropFile && backdropFile.size > 0) {
        const ext = path.extname(backdropFile.name) || '.jpg';
        const destBackdrop = path.join(showFolder, `backdrop${ext}`);
        const buffer = Buffer.from(await backdropFile.arrayBuffer());
        await fsPromises.writeFile(destBackdrop, buffer);
        finalBackdropUrl = `/library/${mediaTypeDir}/${sanitizedTitle}/backdrop${ext}`;
      }
      
      const statusVal = formData.get('status');
      if (statusVal) show.status = statusVal;

      show.poster_path = finalPosterUrl;
      show.backdrop_path = finalBackdropUrl;
      dbHelper.saveShow(show);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, show }));
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 3. Add dynamic background loop video (File Upload)
  if (pathname === '/api/admin/upload-backdrop-loop' && req.method === 'POST') {
    try {
      const formData = await parseMultipartForm(req);
      const showId = formData.get('showId');
      const file = formData.get('video');
      
      const show = dbHelper.getShow(showId);
      if (!show) {
        res.writeHead(404);
        return res.end('Show not found');
      }
      
      if (!file || file.size === 0) {
        res.writeHead(400);
        return res.end('Video file required');
      }
      
      const mediaTypeDir = show.media_type === 'movie' ? 'Movies' : 'Anime';
      const sanitizedTitle = show.title.replace(/[\\/:*?"<>|]/g, '_');
      const showFolder = path.join(__dirname, '..', 'library', mediaTypeDir, sanitizedTitle);
      await fsPromises.mkdir(showFolder, { recursive: true });
      
      const ext = path.extname(file.name) || '.mp4';
      const filename = `backdrop_loop_${Date.now()}${ext}`;
      const destPath = path.join(showFolder, filename);
      
      const buffer = Buffer.from(await file.arrayBuffer());
      await fsPromises.writeFile(destPath, buffer);
      
      const loopUrl = `/library/${mediaTypeDir}/${sanitizedTitle}/${filename}`;
      
      const loops = show.backdrop_loops ? JSON.parse(show.backdrop_loops) : [];
      loops.push(loopUrl);
      
      show.backdrop_loops = JSON.stringify(loops);
      dbHelper.saveShow(show);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, loops }));
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 4. Delete background loop video (References file on disk)
  if (pathname === '/api/admin/delete-backdrop-loop' && req.method === 'POST') {
    const body = await readJsonBody(req, res);
    if (!body) return;
    try {
      const { showId, videoUrl } = body;
      const show = dbHelper.getShow(showId);
      if (!show) {
        res.writeHead(404);
        return res.end('Show not found');
      }
      
      const relativePath = decodeURIComponent(videoUrl.substring(9));
      const libraryDir = path.resolve(__dirname, '..', 'library');
      const filePath = path.resolve(libraryDir, relativePath);
      
      if (!isPathSafe(libraryDir, filePath)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Forbidden', message: 'Acceso denegado' }));
      }
      
      try {
        await fsPromises.unlink(filePath);
      } catch (e) {
        console.warn(`File already deleted or missing on disk: ${filePath}`);
      }
      
      let loops = show.backdrop_loops ? JSON.parse(show.backdrop_loops) : [];
      loops = loops.filter(url => url !== videoUrl);
      
      show.backdrop_loops = JSON.stringify(loops);
      dbHelper.saveShow(show);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, loops }));
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 5. Update individual episode thumbnail (File Upload)
  if (pathname === '/api/admin/upload-episode-thumb' && req.method === 'POST') {
    try {
      const formData = await parseMultipartForm(req);
      const episodeId = formData.get('episodeId');
      const file = formData.get('image');
      const applyToSeason = formData.get('applyToSeason') === 'true';
      
      const episode = dbHelper.getEpisode(episodeId);
      if (!episode) {
        res.writeHead(404);
        return res.end('Episode not found');
      }
      
      if (!file || file.size === 0) {
        res.writeHead(400);
        return res.end('Image file required');
      }
      
      const show = dbHelper.getShow(episode.show_id);
      const mediaTypeDir = show.media_type === 'movie' ? 'Movies' : 'Anime';
      const sanitizedTitle = show.title.replace(/[\\/:*?"<>|]/g, '_');
      const showFolder = path.join(__dirname, '..', 'library', mediaTypeDir, sanitizedTitle);
      await fsPromises.mkdir(showFolder, { recursive: true });
      
      const ext = path.extname(file.name) || '.jpg';
      const filename = `ep_${episode.season_number}_${episode.episode_number}_thumb${ext}`;
      const destPath = path.join(showFolder, filename);
      
      const buffer = Buffer.from(await file.arrayBuffer());
      await fsPromises.writeFile(destPath, buffer);
      
      const thumbUrl = `/library/${mediaTypeDir}/${sanitizedTitle}/${filename}`;
      
      if (applyToSeason) {
        // Fetch all episodes of this show and filter by season
        const allEps = dbHelper.getEpisodes(episode.show_id);
        const seasonEps = allEps.filter(e => e.season_number === episode.season_number);
        
        for (const ep of seasonEps) {
          ep.thumbnail_path = thumbUrl;
          dbHelper.saveEpisode(ep);
        }
        console.log(`Applied cover ${thumbUrl} to all ${seasonEps.length} episodes of Season ${episode.season_number}`);
      } else {
        episode.thumbnail_path = thumbUrl;
        dbHelper.saveEpisode(episode);
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, thumbnail_path: thumbUrl }));
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 5b. Update individual episode opening/ending skip times
  if (pathname === '/api/admin/save-episode-timings' && req.method === 'POST') {
    const body = await readJsonBody(req, res);
    if (!body) return;

    try {
      const episodeId = body.episodeId;
      const introStart = body.introStart !== undefined && body.introStart !== '' && body.introStart !== null ? parseInt(body.introStart, 10) : null;
      const introEnd = body.introEnd !== undefined && body.introEnd !== '' && body.introEnd !== null ? parseInt(body.introEnd, 10) : null;
      const outroStart = body.outroStart !== undefined && body.outroStart !== '' && body.outroStart !== null ? parseInt(body.outroStart, 10) : null;

      let episode;
      try {
        episode = dbHelper.getEpisode(episodeId);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Database Error', message: 'Error al consultar el episodio' }));
      }

      if (!episode) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Episode not found' }));
      }

      episode.intro_start = introStart;
      episode.intro_end = introEnd;
      episode.outro_start = outroStart;

      try {
        dbHelper.saveEpisode(episode);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Database Error', message: 'Error al guardar los tiempos del episodio' }));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Internal Server Error', message: err.message }));
    }
    return;
  }

  // Stream video (remuxing MKV on the fly)
  if (pathname.startsWith('/api/stream/') && req.method === 'GET') {
    const episodeId = pathname.split('/').pop();
    const episode = dbHelper.getEpisode(episodeId);

    if (!episode) {
      res.writeHead(404);
      return res.end('Episode not found');
    }

    const show = dbHelper.getShow(episode.show_id);
    if (show) {
      const tokenParam = parsedUrl.searchParams.get('token');
      const authHeader = req.headers['authorization'];
      let token = tokenParam;
      if (!token && authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
      if (token) {
        const payload = verifyToken(token);
        if (payload && payload.is_kids && (show.age_rating === 'TV-MA' || show.age_rating === 'R')) {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          return res.end('Forbidden: Kids profile cannot stream this content');
        }
      }
    }
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const sessionId = `${clientIp}_${episodeId}_${Date.now()}`;
    const start = parsedUrl.searchParams.get('start'); // seek timestamp in seconds
    const audioTrackIdx = parsedUrl.searchParams.get('audio'); // Selected audio track number (track_number in JSON)

    activeStreams[sessionId] = {
      id: sessionId,
      episodeId,
      showTitle: show ? show.title : 'Desconocido',
      episodeNumber: episode.episode_number,
      seasonNumber: episode.season_number,
      episodeTitle: episode.title || 'Capítulo',
      ip: clientIp,
      startOffset: start ? parseFloat(start) : 0,
      timestamp: Date.now()
    };

    req.on('close', () => {
      delete activeStreams[sessionId];
    });

    const filePath = resolveMediaFilePath(episode.filepath);

    // Check if the container is MKV
    const isMkv = path.extname(filePath).toLowerCase() === '.mkv';

    // Parse audio track index mapped to ffmpeg stream index
    let audioStreamIndex = -1;
    if (audioTrackIdx !== null) {
      const tracks = JSON.parse(episode.audio_tracks || '[]');
      const track = tracks.find(t => t.track_number === parseInt(audioTrackIdx, 10));
      if (track) audioStreamIndex = track.index;
    }

    // Determine target container based on video codec
    const codec = (episode.video_codec || '').toUpperCase();
    const isWebmCompatible = codec === 'AV1' || codec === 'VP9' || codec === 'VP8';

    // Remux conditions:
    // 1. It is an MKV container (browsers don't support it natively).
    // 2. We are requesting a specific audio track (different from the first one) OR we need transcoding.
    // 3. Audio codec is not widely supported in browsers (e.g. DTS, TrueHD) -> Opus/AAC is a safe fallback.
    const mustRemux = isMkv || audioStreamIndex !== -1;

    if (!mustRemux) {
      // Direct file stream (MP4/WebM) with HTTP ranges
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'video/mp4';
      return serveFileWithRanges(filePath, req, res, contentType);
    } else {
      // Choose container parameters dynamically
      const contentType = isWebmCompatible ? 'video/webm' : 'video/mp4';
      
      res.writeHead(200, {
        'Content-Type': contentType,
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      const ffmpegArgs = [];
      
      // Fast seek input if start time provided
      if (start) {
        ffmpegArgs.push('-noaccurate_seek', '-ss', String(parseFloat(start)));
      }
      
      ffmpegArgs.push('-i', filePath);
      
      // Map video
      ffmpegArgs.push('-map', '0:v:0');
      
      // Map selected audio track or default to first audio track
      if (audioStreamIndex !== -1) {
        ffmpegArgs.push('-map', `0:${audioStreamIndex}`);
      } else {
        const tracks = JSON.parse(episode.audio_tracks || '[]');
        if (tracks.length > 0) {
          ffmpegArgs.push('-map', `0:${tracks[0].index}`);
        } else {
          ffmpegArgs.push('-map', '0:a:0?'); // fallback map audio if exists
        }
      }

      // Dynamic video copy, audio transcode and format selection
      ffmpegArgs.push('-c:v', 'copy');
      ffmpegArgs.push('-avoid_negative_ts', 'make_zero');
      
      if (isWebmCompatible) {
        ffmpegArgs.push(
          '-c:a', 'libopus',
          '-b:a', '128k',
          '-af', 'aresample=async=1',
          '-f', 'webm',
          '-deadline', 'realtime'
        );
      } else {
        ffmpegArgs.push(
          '-c:a', 'aac',
          '-b:a', '128k',
          '-af', 'aresample=async=1',
          '-f', 'mp4',
          '-movflags', 'frag_keyframe+empty_moov+default_base_moof'
        );
      }
      
      ffmpegArgs.push('pipe:1');

      console.log(`Spawning ffmpeg: ${getFfmpegPath()} ${ffmpegArgs.join(' ')}`);
      const ffmpegProcess = spawn(getFfmpegPath(), ffmpegArgs);

      ffmpegProcess.stdout.pipe(res);

      ffmpegProcess.stderr.on('data', (data) => {
        // Log ffmpeg activity in debug mode if needed
      });

      req.on('close', () => {
        console.log(`Client closed connection, killing ffmpeg process (PID ${ffmpegProcess.pid})`);
        ffmpegProcess.kill('SIGKILL');
      });

      ffmpegProcess.on('error', (err) => {
        console.error('ffmpeg process error:', err);
        res.end();
      });
    }
    return;
  }

  // Extract subtitle on the fly
  if (pathname.startsWith('/api/subtitle/') && req.method === 'GET') {
    console.log(`Subtitle requested: ${pathname}`);
    const parts = pathname.split('/');
    const trackNum = parts.pop();
    const episodeId = parts.pop();

    const episode = dbHelper.getEpisode(episodeId);
    if (!episode) {
      res.writeHead(404);
      return res.end('Episode not found');
    }

    const subtitleTracks = JSON.parse(episode.subtitle_tracks || '[]');
    const track = subtitleTracks.find(t => t.track_number === parseInt(trackNum, 10));

    if (!track) {
      res.writeHead(404);
      return res.end('Subtitle track not found');
    }

    // Extract subtitle using ffmpeg in ASS format (highly compatible with SubtitlesOctopus)
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });

    const ffmpegProcess = spawn(getFfmpegPath(), [
      '-i', resolveMediaFilePath(episode.filepath),
      '-map', `0:${track.index}`,
      '-f', 'ass',
      'pipe:1'
    ]);

    ffmpegProcess.on('error', (err) => {
      console.error('Subtitle ffmpeg process error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Internal Server Error', message: 'Error al extraer subtítulos' }));
      }
    });

    ffmpegProcess.stdout.pipe(res);

    req.on('close', () => {
      ffmpegProcess.kill('SIGKILL');
    });
    return;
  }

  // Catch unmatched API endpoints
  if (pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: 'Not Found', message: 'Endpoint no encontrado' }));
  }

  // --- Static Files Server ---

  // Library files access (posters, backdrops, generated intro loops)
  if (pathname.startsWith('/library/')) {
    const relativePath = decodeURIComponent(pathname.substring(9));
    const libraryDir = path.resolve(__dirname, '..', 'library');
    const filePath = path.resolve(libraryDir, relativePath);
    if (!isPathSafe(libraryDir, filePath)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Forbidden', message: 'Acceso denegado' }));
    }
    
    try {
      await fsPromises.access(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      return serveFileWithRanges(filePath, req, res, contentType);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Not Found', message: 'Archivo no encontrado en la librería' }));
    }
  }

  // Frontend files
  let relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.substring(1));
  const frontendDir = path.resolve(__dirname, '..', 'frontend');
  const filePath = path.resolve(frontendDir, relativePath);
  if (!isPathSafe(frontendDir, filePath)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: 'Forbidden', message: 'Acceso denegado' }));
  }

  try {
    await fsPromises.access(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'text/plain';
    console.log(`Serving static file: ${relativePath} (${contentType})`);
    return serveFileWithRanges(filePath, req, res, contentType);
  } catch (e) {
    // SPA fallback: return index.html for unknown routes
    const indexHtml = path.join(__dirname, '..', 'frontend', 'index.html');
    try {
      await fsPromises.access(indexHtml);
      return serveFileWithRanges(indexHtml, req, res, 'text/html; charset=utf-8');
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Not Found', message: 'Not Found' }));
    }
  }
  } catch (globalError) {
    console.error('Global error handler caught:', globalError);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Internal Server Error', message: globalError.message }));
    } else {
      res.end();
    }
  }
});

if (process.env.NODE_ENV !== 'test') {
  dbHelper.syncDatabaseWithDisk();
  runLibraryScan().catch(e => console.error("Library auto-scan error:", e));
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(` KuraStream server running at http://localhost:${PORT}`);
    console.log(`====================================================`);
  });
}
