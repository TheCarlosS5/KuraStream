import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const workspaceRoot = process.cwd();
const bundledPhp = path.join(
  workspaceRoot,
  '.tools',
  'php',
  process.platform === 'win32' ? 'php.exe' : 'php',
);
const phpBin = process.env.PHP_BINARY || (existsSync(bundledPhp) ? bundledPhp : 'php');
const result = spawnSync(phpBin, process.argv.slice(2), {
  cwd: workspaceRoot,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`No se pudo ejecutar PHP (${phpBin}): ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
