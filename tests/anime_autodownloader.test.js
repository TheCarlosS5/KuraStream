import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAnimeFilename, filterSpanishAnimeTorrents } from '../backend/scripts/anime_autodownloader.js';

test('parseAnimeFilename correctly extracts anime name, season, and episode', () => {
  const result1 = parseAnimeFilename('[Fansub] Oshi no Ko - S02E05 [1080p Latino].mkv');
  assert.equal(result1.animeTitle, 'Oshi no Ko');
  assert.equal(result1.season, 2);
  assert.equal(result1.episode, 5);

  const result2 = parseAnimeFilename('Solo Leveling - 08 [Sub Español] 1080p.mp4');
  assert.equal(result2.animeTitle, 'Solo Leveling');
  assert.equal(result2.season, 1);
  assert.equal(result2.episode, 8);
});

test('filterSpanishAnimeTorrents correctly filters torrent items with Spanish audio or sub', () => {
  const items = [
    { title: 'Random Anime - 01 [1080p Eng Sub].mkv', link: 'http://example.com/1', guid: 'hash1' },
    { title: 'Solo Leveling - 05 [1080p Latino].mkv', link: 'http://example.com/2', guid: 'hash2' },
    { title: 'Demon Slayer - S04E01 [Sub Español].mkv', link: 'http://example.com/3', guid: 'hash3' }
  ];
  const filtered = filterSpanishAnimeTorrents(items);
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].title, 'Solo Leveling - 05 [1080p Latino].mkv');
  assert.equal(filtered[1].title, 'Demon Slayer - S04E01 [Sub Español].mkv');
});

test('isBatchPack detects full season packs vs single episodes', async () => {
  const { isBatchPack } = await import('../backend/scripts/anime_autodownloader.js');
  assert.equal(isBatchPack('[Fansub] Naruto [01-220] [Batch Latino]'), true);
  assert.equal(isBatchPack('[Erai-raws] One Piece - 1172 [MultiSub]'), false);
});
