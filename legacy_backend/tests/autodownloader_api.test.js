import test from 'node:test';
import assert from 'node:assert/strict';
import { getAutoDownloaderStatus, startAutoDownloader, stopAutoDownloader } from '../backend/scripts/anime_autodownloader.js';

test('AutoDownloader module toggle and status API logic works correctly', () => {
  stopAutoDownloader();
  let status = getAutoDownloaderStatus();
  assert.equal(status.isEnabled, false);

  startAutoDownloader(3600000);
  status = getAutoDownloaderStatus();
  assert.equal(status.isEnabled, true);

  stopAutoDownloader();
  status = getAutoDownloaderStatus();
  assert.equal(status.isEnabled, false);
});
