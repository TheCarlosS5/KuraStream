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
const args = process.argv.slice(2);
const env = { ...process.env };

// php.ini points extension_dir at the Windows PHP layout ("ext"); elsewhere it would stop pdo_mysql from loading.
const iniIndex = args.indexOf('-c');
if (process.platform !== 'win32' && iniIndex !== -1 && args[iniIndex + 1] === 'php.ini') {
  args.splice(iniIndex, 2);
}

// The built-in server (`php -S`) answers one request at a time unless it forks workers, so a playing
// video or a watch-party event stream would freeze every other client. Workers are not available on Windows.
if (args.includes('-S')) {
  if (process.platform === 'win32') {
    console.warn('[KuraStream] Aviso: en Windows el servidor integrado de PHP atiende una petición a la vez; '
      + 'para varios dispositivos a la vez usa Linux/Docker.');
  } else if (!env.PHP_CLI_SERVER_WORKERS) {
    env.PHP_CLI_SERVER_WORKERS = '16';
  }
}

const result = spawnSync(phpBin, args, {
  cwd: workspaceRoot,
  stdio: 'inherit',
  env,
});

if (result.error) {
  console.error(`No se pudo ejecutar PHP (${phpBin}): ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
