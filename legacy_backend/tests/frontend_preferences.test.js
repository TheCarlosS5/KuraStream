import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('frontend index.html contains auto-skip intro toggle switch element', () => {
  const indexPath = path.join(process.cwd(), 'frontend', 'index.html');
  const content = fs.readFileSync(indexPath, 'utf8');

  assert.ok(content.includes('id="autoSkipIntroToggle"'), 'index.html must include input with id autoSkipIntroToggle');
  assert.ok(content.includes('Saltar Intro / Outro Automáticamente'), 'index.html must include label text for auto-skip toggle');
  assert.ok(content.includes('class="switch"'), 'index.html must include switch container class');
  assert.ok(content.includes('class="slider round"'), 'index.html must include slider round span');
});

test('frontend app.js contains userPreferences state and loadUserPreferences logic', () => {
  const appPath = path.join(process.cwd(), 'frontend', 'app.js');
  const content = fs.readFileSync(appPath, 'utf8');

  assert.ok(content.includes('window.userPreferences ='), 'app.js must declare window.userPreferences');
  assert.ok(content.includes('auto_skip_intro:'), 'app.js must define auto_skip_intro');
  assert.ok(content.includes('async function loadUserPreferences()'), 'app.js must implement loadUserPreferences()');
  assert.ok(content.includes("fetch('/api/user/preferences'"), 'app.js must call GET /api/user/preferences');
  assert.ok(content.includes("localStorage.setItem('kurastream_auto_skip_intro'"), 'app.js must persist auto_skip_intro in localStorage');
});
