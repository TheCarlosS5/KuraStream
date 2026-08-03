import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const remoteHost = "dserver-calos@192.168.18.38";
const remoteDir = "/home/dserver-calos/KuraStream";

// Directories/files to ignore during live synchronization
const ignorePatterns = [
  /\.git/,
  /node_modules/,
  /library/,
  /kurastream\.db/,
  /check_remote/,
  /test_ssh_capabilities/,
  /\.log$/,
  /tmp/
];

function shouldIgnore(filePath) {
  return ignorePatterns.some(pattern => pattern.test(filePath));
}

console.log(`=== Live Sync Watcher Started ===`);
console.log(`Watching local project: ${projectRoot}`);
console.log(`Syncing changes to: ${remoteHost}:${remoteDir}`);
console.log(`Press Ctrl+C to stop.`);

let debounceTimer = null;
const changedFiles = new Set();

// Recursive watch (supported natively on Linux/macOS/Windows)
fs.watch(projectRoot, { recursive: true }, (eventType, filename) => {
  if (!filename) return;
  
  const localPath = path.join(projectRoot, filename);
  if (shouldIgnore(filename)) return;

  changedFiles.add(filename);

  // Debounce multiple fast events (like editor autosave triggers)
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    for (const file of changedFiles) {
      const src = path.join(projectRoot, file);
      const dest = path.join(remoteDir, file);
      const destDir = path.dirname(dest);

      // Verify file still exists (could have been deleted or renamed)
      fs.stat(src, (err, stats) => {
        if (err) {
          // File deleted locally, remove remotely
          console.log(`[DELETE] ${file} removed locally. Deleting remotely...`);
          exec(`ssh -o StrictHostKeyChecking=no ${remoteHost} "rm -f ${dest}"`, (sshErr) => {
            if (sshErr) console.error(`[ERROR] Failed to delete remote ${file}:`, sshErr.message);
          });
          return;
        }

        if (stats.isDirectory()) return;

        // Ensure remote directory structure exists, then transfer file
        const syncCmd = `ssh -o StrictHostKeyChecking=no ${remoteHost} "mkdir -p ${destDir}" && scp -o StrictHostKeyChecking=no "${src}" "${remoteHost}:${dest}"`;
        exec(syncCmd, (scpErr) => {
          if (scpErr) {
            console.error(`[ERROR] Failed to sync ${file}:`, scpErr.message);
          } else {
            console.log(`[SYNCED] ${file} -> ${remoteHost}:${dest}`);
          }
        });
      });
    }
    changedFiles.clear();
  }, 300);
});
