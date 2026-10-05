#!/usr/bin/env node
/**
 * Writes app-release.json next to a built APK so the server can show its version, notes and build variant.
 *
 *   node scripts/generate_app_release.mjs <apk> [--variant release|debug] [--notes "text"] [--gradle android/app/build.gradle.kts] [--out <file>]
 *
 * versionName/versionCode are read from the Gradle script that produced the APK. The SHA-256 is printed to
 * stdout for the build log but is NOT written to the file: the server always hashes the APK it serves, so a stale
 * or edited json can never vouch for a different file.
 */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function parseGradleVersion(source) {
  const name = source.match(/versionName\s*=\s*"([^"]+)"/);
  const code = source.match(/versionCode\s*=\s*(\d+)/);
  if (!name || !code) throw new Error('versionName/versionCode not found in the Gradle script');
  return { version_name: name[1], version_code: Number(code[1]) };
}

export function buildRelease({ gradleSource, variant = 'release', notes = '' }) {
  if (!['release', 'debug'].includes(variant)) throw new Error(`variant must be release or debug (got ${variant})`);
  return { ...parseGradleVersion(gradleSource), variant, notes: String(notes).slice(0, 1000) };
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', c => hash.update(c)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

async function main(argv) {
  const args = { variant: 'release', notes: '', gradle: 'android/app/build.gradle.kts', out: null, apk: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--variant') args.variant = argv[++i];
    else if (a === '--notes') args.notes = argv[++i] ?? '';
    else if (a === '--gradle') args.gradle = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (!args.apk) args.apk = a;
    else throw new Error(`Unexpected argument: ${a}`);
  }
  if (!args.apk) throw new Error('Usage: generate_app_release.mjs <apk> [--variant release|debug] [--notes text] [--gradle file] [--out file]');
  if (!statSync(args.apk).isFile()) throw new Error(`${args.apk} is not a file`);

  const release = buildRelease({ gradleSource: readFileSync(args.gradle, 'utf8'), variant: args.variant, notes: args.notes });
  const out = args.out ?? path.join(path.dirname(args.apk), 'app-release.json');
  writeFileSync(out, JSON.stringify(release, null, 2) + '\n');
  console.log(`Wrote ${out}`);
  console.log(`${release.version_name} (${release.version_code}) ${release.variant}`);
  console.log(`sha256 ${await sha256(args.apk)}  ${path.basename(args.apk)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch(err => { console.error(err.message); process.exit(1); });
}
