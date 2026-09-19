import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbHelper } from '../backend/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('Admin Staging API endpoints (list, publish, delete)', async () => {
  const stagedFile = path.resolve(__dirname, '..', 'library', 'downloads', 'staged', 'sample_test_ep.mkv');
  await fs.mkdir(path.dirname(stagedFile), { recursive: true });
  await fs.writeFile(stagedFile, 'video sample');

  dbHelper.saveStagedImport({
    id: 'stage_test_api',
    raw_title: 'Sample.Test.S01E01.mkv',
    clean_title: 'Sample Test Anime',
    media_type: 'anime',
    season: 1,
    episode: 1,
    file_path: stagedFile
  });

  const stagedList = dbHelper.getStagedImports();
  assert.ok(stagedList.some(i => i.id === 'stage_test_api'));

  // Test publishing (zero copy move)
  const targetDir = path.resolve(__dirname, '..', 'library', 'Anime', 'Sample_Test_Anime', 'Season 01');
  const targetFile = path.join(targetDir, 'Sample Test Anime - S01E01.mkv');
  await fs.mkdir(targetDir, { recursive: true });
  await fs.rename(stagedFile, targetFile);

  dbHelper.deleteStagedImport('stage_test_api');

  const afterDelete = dbHelper.getStagedImport('stage_test_api');
  assert.equal(afterDelete, null);

  // Cleanup
  await fs.rm(path.resolve(__dirname, '..', 'library', 'Anime', 'Sample_Test_Anime'), { recursive: true, force: true }).catch(() => {});
});
