import test from 'node:test';
import assert from 'node:assert/strict';
import { dbHelper } from '../backend/db.js';
import { ingestCompletedDownloads } from '../backend/scripts/anime_autodownloader.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('ingestCompletedDownloads redirects downloaded files to staged_imports', async () => {
  const stagedDir = path.resolve(__dirname, '..', 'library', 'downloads', 'staged');
  const tempDir = path.resolve(__dirname, '..', 'library', 'downloads', 'temp');
  await fs.mkdir(tempDir, { recursive: true });

  const dummyFile = path.join(tempDir, 'Test.Anime.S01E01.1080p.mkv');
  await fs.writeFile(dummyFile, 'dummy video content');

  await ingestCompletedDownloads();

  const stagedItems = dbHelper.getStagedImports();
  assert.ok(stagedItems.some(i => i.raw_title.includes('Test.Anime.S01E01')));

  // Cleanup
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  await fs.rm(stagedDir, { recursive: true, force: true }).catch(() => {});
});
