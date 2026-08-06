import test from 'node:test';
import assert from 'node:assert/strict';
import { dbHelper } from '../backend/db.js';

test('dbHelper supports downloaded_torrents operations', () => {
  const testTorrent = {
    info_hash: 'abc123hash',
    title: '[Fansub] Oshi no Ko - 01 [1080p Latino].mkv',
    anime_title: 'Oshi no Ko',
    season: 1,
    episode: 1,
    source_url: 'https://nyaa.si/download/123.torrent'
  };

  dbHelper.saveDownloadedTorrent(testTorrent);
  const isDownloaded = dbHelper.isTorrentDownloaded('abc123hash');
  assert.equal(isDownloaded, true);

  const history = dbHelper.getDownloadedTorrents();
  assert.ok(history.length > 0);
  assert.equal(history[0].info_hash, 'abc123hash');
});
