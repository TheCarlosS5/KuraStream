#!/usr/bin/env node
/**
 * Production build of the web app -> frontend/dist/
 *
 *   npm run build
 *
 * - bundles js/main.js and player.js (ES modules, code splitting, minified) and style.css (its @imports inlined);
 *   every file name carries a content hash, so a browser can cache them forever and a deploy can never be a mix
 *   of old and new modules (the cause of the blank page after an update);
 *   ((the unbundled sources keep working: `npm run dev` serves them as they are))
 * - builds a Lucide icon bundle with only the icons the sources use (window.lucide, same API) instead of the 411 KB
 *   full set;
 * - writes dist/index.html (hashed references, modulepreload hints), dist/sw.js (precache list of the build) and
 *   dist/asset-manifest.json.
 *
 * The server serves dist/ automatically when it exists (php_backend/router.php, deploy/nginx).
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fe = path.join(root, 'frontend');
const dist = path.join(fe, 'dist');

function walk(dir, filter, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['vendor', 'dist', 'node_modules'].includes(entry.name)) walk(full, filter, out);
    } else if (filter(full)) {
      out.push(full);
    }
  }
  return out;
}

const hash8 = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 8);
const rel = (file) => '/' + path.relative(fe, file).split(path.sep).join('/');

/** Sources import `./x.js?v=...` to bust caches; the build hashes file names instead, so the query is dropped. */
const stripVersionQueries = {
  name: 'strip-version-queries',
  setup(b) {
    b.onResolve({ filter: /\?v=[^/]*$/ }, async (args) => {
      const clean = args.path.replace(/\?v=[^/]*$/, '');
      const result = await b.resolve(clean, { importer: args.importer, resolveDir: args.resolveDir, kind: args.kind });
      return result.errors.length ? { errors: result.errors } : { path: result.path };
    });
  },
};

export async function build({ quiet = false } = {}) {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  // ---- 1. app code ------------------------------------------------------------------------------------------------
  const app = await esbuild.build({
    absWorkingDir: root,
    entryPoints: {
      main: 'frontend/js/main.js',
      player: 'frontend/player.js',
      style: 'frontend/style.css',
      'boot-perf': 'frontend/js/boot/perf_mode.js',
      'boot-errors': 'frontend/js/boot/error_log.js',
      'boot-sw': 'frontend/js/boot/sw_register.js',
    },
    bundle: true,
    splitting: true,
    format: 'esm',
    outdir: 'frontend/dist',
    entryNames: '[name]-[hash]',
    chunkNames: 'chunks/[name]-[hash]',
    assetNames: 'media/[name]-[hash]',
    minify: true,
    sourcemap: 'linked',
    target: 'es2020',
    plugins: [stripVersionQueries],
    // Absolute URLs in CSS/JS point at files the server serves as they are.
    external: ['/assets/*', '/vendor/*', '/library/*', '/api/*', '/css/*'],
    metafile: true,
    legalComments: 'none',
    logLevel: quiet ? 'silent' : 'warning',
  });

  // ---- 2. Lucide subset ------------------------------------------------------------------------------------------
  const { icons } = await import('lucide');
  const sources = walk(fe, (f) => /\.(js|html)$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const toPascal = (name) => name.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
  const tokens = new Set(sources.match(/[a-z][a-z0-9]*(?:-[a-z0-9]+)*/g) || []);
  const used = [...new Set([...tokens].map(toPascal).filter((name) => icons[name]))].sort();
  const lucideEntry = `
    import { createIcons, ${used.join(', ')} } from 'lucide';
    const icons = { ${used.join(', ')} };
    window.lucide = { icons, createIcons: (options = {}) => createIcons({ icons, ...options }) };
  `;
  const lucideBuild = await esbuild.build({
    absWorkingDir: root,
    stdin: { contents: lucideEntry, resolveDir: root, loader: 'js' },
    bundle: true,
    format: 'iife',
    outfile: 'frontend/dist/lucide.js',
    minify: true,
    write: false,
    legalComments: 'none',
    logLevel: quiet ? 'silent' : 'warning',
  });
  const lucideCode = lucideBuild.outputFiles[0].text;
  const lucideName = `lucide-${hash8(lucideCode)}.js`;
  fs.writeFileSync(path.join(dist, lucideName), lucideCode);

  // ---- 3. what was produced -------------------------------------------------------------------------------------
  const outputs = app.metafile.outputs;
  const byEntry = {};
  for (const [file, info] of Object.entries(outputs)) {
    if (info.entryPoint) byEntry[path.basename(info.entryPoint)] = { file: '/' + file.replace(/^frontend\//, ''), imports: info.imports, cssBundle: info.cssBundle };
  }
  const urlOf = (entryBase) => {
    const found = byEntry[entryBase];
    if (!found) throw new Error(`build: no output for ${entryBase}`);
    return found.file;
  };
  // Static chunk graph of an entry (what the browser needs before the entry can run): modulepreload hints.
  const chunkGraph = (file) => {
    const seen = new Set();
    const visit = (f) => {
      const info = outputs['frontend' + f];
      if (!info) return;
      for (const imp of info.imports) {
        if (imp.kind === 'import-statement' && !seen.has(imp.path)) {
          seen.add(imp.path);
          visit('/' + imp.path.replace(/^frontend\//, ''));
        }
      }
    };
    visit(file);
    return [...seen].map((p) => '/' + p.replace(/^frontend\//, ''));
  };
  const mainFile = urlOf('main.js');
  const playerFile = urlOf('player.js');
  const styleFile = urlOf('style.css');
  const bootFiles = { perf: urlOf('perf_mode.js'), errors: urlOf('error_log.js'), sw: urlOf('sw_register.js') };
  const lucideFile = '/dist/' + lucideName;

  // ---- 4. index.html ---------------------------------------------------------------------------------------------
  let html = fs.readFileSync(path.join(fe, 'index.html'), 'utf8');
  const replaceOnce = (pattern, replacement, label) => {
    if (!pattern.test(html)) throw new Error(`build: index.html has no ${label}`);
    html = html.replace(pattern, replacement);
  };
  replaceOnce(/<script src="\/js\/boot\/perf_mode\.js"><\/script>/, `<script src="${bootFiles.perf}"></script>`, 'perf_mode script');
  replaceOnce(/<script src="\/js\/boot\/error_log\.js"><\/script>/, `<script src="${bootFiles.errors}"></script>`, 'error_log script');
  replaceOnce(/<script src="\/js\/boot\/sw_register\.js"><\/script>/, `<script src="${bootFiles.sw}"></script>`, 'sw_register script');
  html = html.replace(/\s*<link rel="preload" href="\/css\/[a-z]+\.css" as="style">/g, '');
  replaceOnce(/<link rel="stylesheet" href="style\.css[^"]*">/, `<link rel="stylesheet" href="${styleFile}">`, 'style.css link');
  replaceOnce(/<script src="\/vendor\/lucide\/lucide\.min\.js"><\/script>/, `<script src="${lucideFile}"></script>`, 'lucide script');
  replaceOnce(/<script src="\/js\/main\.js[^"]*" type="module"><\/script>/, `<script src="${mainFile}" type="module"></script>`, 'main.js script');
  replaceOnce(/<script src="player\.js[^"]*" type="module"><\/script>/, `<script src="${playerFile}" type="module"></script>`, 'player.js script');
  const preloads = [...new Set([...chunkGraph(mainFile), ...chunkGraph(playerFile)])]
    .map((chunk) => `  <link rel="modulepreload" href="${chunk}">`).join('\n');
  if (preloads) html = html.replace('</head>', `${preloads}\n</head>`);
  fs.writeFileSync(path.join(dist, 'index.html'), html);

  // ---- 5. service worker -----------------------------------------------------------------------------------------
  const distFiles = walk(dist, (f) => !f.endsWith('.map') && !f.endsWith('index.html')).map(rel).map((p) => '/dist' + p.replace(/^\/dist/, ''));
  const staticShell = [
    '/', '/manifest.json', '/offline.html',
    '/assets/illustrations/poster_placeholder.svg', '/assets/illustrations/backdrop_placeholder.svg',
    '/assets/illustrations/empty_watchlist.svg', '/assets/illustrations/empty_history.svg', '/assets/illustrations/empty_search.svg',
    '/assets/branding/brand_mark.svg',
    '/assets/fonts/inter-latin-300-700.woff2', '/assets/fonts/outfit-latin-400-800.woff2',
  ].filter((p) => p === '/' || fs.existsSync(path.join(fe, p)));
  const precache = [...staticShell, ...distFiles];
  const buildId = hash8(JSON.stringify(precache));
  let sw = fs.readFileSync(path.join(fe, 'sw.js'), 'utf8');
  sw = sw.replace(/const CACHE_NAME = '[^']*';/, `const CACHE_NAME = 'kurastream-${buildId}';`);
  sw = sw.replace(/\/\/ @@SHELL_ASSETS_START[^\n]*\nconst SHELL_ASSETS = \[[\s\S]*?\];\n\/\/ @@SHELL_ASSETS_END/,
    `const SHELL_ASSETS = ${JSON.stringify(precache, null, 2)};`);
  if (!sw.includes(`kurastream-${buildId}`) || !sw.includes(distFiles[0])) throw new Error('build: could not inject the precache list into sw.js');
  fs.writeFileSync(path.join(dist, 'sw.js'), sw);

  // ---- 6. manifest -------------------------------------------------------------------------------------------------
  const manifest = {
    buildId,
    builtAt: new Date().toISOString(),
    entries: { main: mainFile, player: playerFile, style: styleFile, lucide: lucideFile, ...Object.fromEntries(Object.entries(bootFiles).map(([k, v]) => [`boot-${k}`, v])) },
    icons: used.length,
    files: distFiles,
  };
  fs.writeFileSync(path.join(dist, 'asset-manifest.json'), JSON.stringify(manifest, null, 2));

  if (!quiet) {
    const size = (f) => (fs.statSync(path.join(fe, f)).size / 1024).toFixed(1) + ' KB';
    console.log(`build ${buildId}: main ${size(mainFile)}, player ${size(playerFile)}, style ${size(styleFile)}, lucide ${size(lucideFile)} (${used.length} icons), ${distFiles.length} files`);
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
