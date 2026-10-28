import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildRelease, parseGradleVersion } from '../scripts/generate_app_release.mjs';

const script = new URL('../scripts/generate_app_release.mjs', import.meta.url).pathname;
const realGradle = fs.readFileSync(new URL('../android/app/build.gradle.kts', import.meta.url), 'utf8');

test('reads versionName/versionCode from the real Gradle script', () => {
  const v = parseGradleVersion(realGradle);
  assert.match(v.version_name, /^\d+\.\d+\.\d+/);
  assert.ok(Number.isInteger(v.version_code) && v.version_code > 0);
});

test('rejects a script without version information and an unknown variant', () => {
  assert.throws(() => parseGradleVersion('android { }'), /not found/);
  assert.throws(() => buildRelease({ gradleSource: realGradle, variant: 'nightly' }), /variant/);
});

test('truncates notes to 1000 characters', () => {
  assert.equal(buildRelease({ gradleSource: realGradle, notes: 'x'.repeat(5000) }).notes.length, 1000);
});

test('the CLI writes app-release.json next to the APK and prints the real SHA-256 without storing it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kura-rel-'));
  try {
    const apk = path.join(dir, 'KuraStream.apk');
    fs.writeFileSync(apk, Buffer.from('not really an apk'));
    const run = spawnSync(process.execPath, [script, apk, '--variant', 'release', '--notes', 'Prueba', '--gradle', new URL('../android/app/build.gradle.kts', import.meta.url).pathname], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'app-release.json'), 'utf8'));
    assert.equal(json.variant, 'release');
    assert.equal(json.notes, 'Prueba');
    assert.ok(json.version_name && json.version_code);
    assert.ok(!('sha256' in json), 'the checksum must not be stored: the server hashes the file it serves');
    assert.ok(run.stdout.includes(createHash('sha256').update('not really an apk').digest('hex')), 'the build log shows the SHA-256');

    const missing = spawnSync(process.execPath, [script, path.join(dir, 'missing.apk')], { encoding: 'utf8' });
    assert.notEqual(missing.status, 0, 'a missing APK is an error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
