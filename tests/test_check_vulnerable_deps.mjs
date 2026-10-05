import assert from 'node:assert/strict';
import test from 'node:test';
import { npmPackages, mavenPackages } from '../scripts/check_vulnerable_deps.mjs';

test('npm lockfile entries become OSV queries (nested node_modules keep the last segment)', () => {
  const pkgs = npmPackages({ packages: { '': { name: 'root' }, 'node_modules/a': { version: '1.0.0' }, 'node_modules/a/node_modules/@s/b': { version: '2.1.0' } } });
  assert.deepEqual(pkgs.map((p) => `${p.name}@${p.version}`), ['a@1.0.0', '@s/b@2.1.0']);
});

test('Gradle output: the resolved version after -> wins and duplicates collapse', () => {
  const text = `
+--- com.squareup.okhttp3:okhttp:4.12.0
|    \\--- org.jetbrains.kotlin:kotlin-stdlib:1.8.21 -> 2.1.10
+--- org.jetbrains.kotlin:kotlin-stdlib:2.1.10 (*)
\\--- androidx.core:core-ktx:1.15.0`;
  const pkgs = mavenPackages(text);
  assert.deepEqual(pkgs.map((p) => `${p.name}@${p.version}`).sort(), ['androidx.core:core-ktx@1.15.0', 'com.squareup.okhttp3:okhttp@4.12.0', 'org.jetbrains.kotlin:kotlin-stdlib@2.1.10']);
});
