import test from 'node:test';
import assert from 'node:assert/strict';
import { dbHelper } from '../backend/db.js';

test('shows schema includes status column and supports filtering', () => {
  const showId = 'test_airing_show_' + Date.now();
  dbHelper.saveShow({
    id: showId,
    title: 'Test Airing Anime',
    media_type: 'anime',
    status: 'airing'
  });
  
  const fetched = dbHelper.getShow(showId);
  assert.equal(fetched.status, 'airing');
  
  const allAiring = dbHelper.getShows('anime').filter(s => s.status === 'airing');
  assert.ok(allAiring.some(s => s.id === showId));
  
  dbHelper.deleteShow(showId);
});
