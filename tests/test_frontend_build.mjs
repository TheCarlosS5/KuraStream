// The production build (scripts/build.mjs): what it writes and that the result is coherent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fe = path.join(root, 'frontend');
const manifest = await build({ quiet: true });
const dist = path.join(fe, 'dist');
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');

test('index.html references hashed files that exist, with no cache-busting queries left', () => {
  const refs = [...html.matchAll(/(?:src|href)="(\/dist\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 6, 'scripts, stylesheet and preloads are rewritten');
  for (const ref of refs) assert.ok(fs.existsSync(path.join(fe, ref)), `${ref} exists`);
  assert.ok(!/\?v=\d{4}\./.test(html), 'no ?v= query strings');
  assert.ok(!html.includes('/vendor/lucide/lucide.min.js'), 'the 411 KB icon set is replaced by the subset');
  assert.ok(!/<link rel="preload" href="\/css\//.test(html), 'no preloads of the unbundled stylesheets');
  assert.ok(!/<script>[^<]/.test(html), 'no inline scripts (strict CSP)');
  assert.ok(/<link rel="modulepreload" href="\/dist\/chunks\//.test(html), 'shared chunks are preloaded');
  for (const file of Object.values(manifest.entries)) assert.ok(/-[A-Za-z0-9]{8}\.(js|css)$/.test(file), `${file} carries a content hash`);
});

test('code is split: the admin panel is not in the entry bundles', () => {
  const chunks = fs.readdirSync(path.join(dist, 'chunks')).filter((f) => f.endsWith('.js'));
  assert.ok(chunks.some((f) => f.startsWith('admin_sidebar-')), 'admin_sidebar is its own chunk');
  const main = fs.readFileSync(path.join(fe, manifest.entries.main), 'utf8');
  assert.ok(main.includes('admin_sidebar-'), 'and is loaded with import()');
  assert.ok(!html.includes('admin_sidebar'), 'but never preloaded');
});

test('every icon the sources use is in the Lucide subset', () => {
  const lucideCode = fs.readFileSync(path.join(fe, manifest.entries.lucide), 'utf8');
  const context = { document: {} };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(lucideCode, context);
  const icons = context.lucide.icons;
  assert.equal(typeof context.lucide.createIcons, 'function');
  const pascal = (name) => name.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
  const files = [path.join(fe, 'index.html'), path.join(fe, 'player.js')];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  })(path.join(fe, 'js'));
  // Every literal data-lucide="..." in the page and the scripts must resolve (icons chosen at runtime are listed below).
  const strict = [];
  for (const file of files) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/data-lucide="([a-z0-9-]+)"/g)) {
      if (!icons[pascal(m[1])]) strict.push(`${m[1]} (${path.basename(file)})`);
    }
  }
  assert.deepEqual(strict, [], 'data-lucide names missing from the subset');
  for (const name of ['play', 'pause', 'skip-forward', 'volume-x', 'volume-1', 'volume-2', 'minimize', 'maximize', 'users', 'shield-check']) {
    assert.ok(icons[pascal(name)], `${name} is in the subset`);
  }
});

test('the built service worker precaches exactly this build and keeps its safety rules', () => {
  assert.ok(sw.includes(`kurastream-${manifest.buildId}`), 'cache name carries the build id');
  for (const file of manifest.files) assert.ok(sw.includes(JSON.stringify(file)), `${file} is precached`);
  assert.ok(!sw.includes('@@SHELL_ASSETS'), 'markers replaced');
  assert.ok(sw.includes('name !== CACHE_NAME') && sw.includes('url.origin !== self.location.origin'));
  assert.ok(!sw.includes('/js/main.js'), 'no unbundled module paths in the precache list');
});

test('builds are reproducible: the same sources give the same file names', async () => {
  const again = await build({ quiet: true });
  assert.deepEqual(again.entries, manifest.entries);
  assert.equal(again.buildId, manifest.buildId);
});
