import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWeeklyCalendar } from '../backend/anime_calendar.js';

test('fetchWeeklyCalendar returns grouped days schedule', async () => {
  const schedule = await fetchWeeklyCalendar();
  assert.ok(schedule, 'Schedule object should exist');
  assert.ok(schedule.Monday || schedule.monday || Object.keys(schedule).length > 0, 'Schedule should contain days');
});
