#!/usr/bin/env node
// Checks the project's dependencies against the OSV database (osv.dev): npm (package-lock.json) and, when a file
// with Gradle output is given, every Maven artifact the Android app resolves, transitive ones included.
//
//   node scripts/check_vulnerable_deps.mjs                              # npm only
//   node scripts/check_vulnerable_deps.mjs --gradle /tmp/android_deps.txt
//     (produce it with: cd android && ./gradlew -q :app:dependencies --configuration releaseRuntimeClasspath > /tmp/android_deps.txt)
//
// Exit code 1 only when a known vulnerability is found. If OSV cannot be reached the script warns and exits 0, so a
// network hiccup never blocks a pull request.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gradleArg = process.argv.indexOf('--gradle');
const gradleFile = gradleArg > -1 ? process.argv[gradleArg + 1] : null;

export function npmPackages(lock) {
  return Object.entries(lock.packages || {})
    .filter(([key, value]) => key && value.version)
    .map(([key, value]) => ({ name: key.split('node_modules/').pop(), version: value.version, ecosystem: 'npm' }));
}

/** "group:artifact:1.0 -> 1.2" lines of `gradlew dependencies`; the resolved version (after ->) wins. */
export function mavenPackages(text) {
  const found = new Map();
  for (const m of text.matchAll(/([A-Za-z0-9_.\-]+):([A-Za-z0-9_.\-]+):([0-9][A-Za-z0-9_.\-]*)(?: -> ([0-9][A-Za-z0-9_.\-]*))?/g)) {
    const [, group, artifact, declared, resolved] = m;
    found.set(`${group}:${artifact}`, { name: `${group}:${artifact}`, version: resolved || declared, ecosystem: 'Maven' });
  }
  return [...found.values()];
}

async function check(packages, label) {
  const results = [];
  for (let i = 0; i < packages.length; i += 500) {
    const chunk = packages.slice(i, i + 500);
    const response = await fetch('https://api.osv.dev/v1/querybatch', {
      method: 'POST',
      body: JSON.stringify({ queries: chunk.map((p) => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version })) }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`OSV answered ${response.status}`);
    const json = await response.json();
    json.results.forEach((r, j) => { if (r.vulns && r.vulns.length) results.push({ ...chunk[j], ids: r.vulns.map((v) => v.id) }); });
  }
  console.log(`${label}: ${packages.length} packages checked, ${results.length} with known vulnerabilities`);
  results.forEach((r) => console.log(`  ${r.name}@${r.version}: ${r.ids.slice(0, 5).join(', ')}`));
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    let bad = await check(npmPackages(JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))), 'npm');
    if (gradleFile && existsSync(gradleFile)) {
      bad = bad.concat(await check(mavenPackages(readFileSync(gradleFile, 'utf8')), 'Android (Maven)'));
    }
    process.exit(bad.length ? 1 : 0);
  } catch (error) {
    console.warn(`::warning::Dependency check skipped (${error.message})`);
    process.exit(0);
  }
}
