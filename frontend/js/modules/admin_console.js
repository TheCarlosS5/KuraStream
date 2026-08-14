/**
 * KuraStream - Admin Console Module
 * Handles real-time server logs streaming and terminal output controls.
 */

import { getAuthHeaders, openAdminLoginModal } from './auth.js';

let logsInterval = null;

export function startAdminLogsPolling() {
  stopAdminLogsPolling();
  fetchServerLogs();
  logsInterval = setInterval(fetchServerLogs, 2500);
}

export function stopAdminLogsPolling() {
  if (logsInterval) {
    clearInterval(logsInterval);
    logsInterval = null;
  }
}

export async function fetchServerLogs() {
  const terminal = document.getElementById('terminal-box');
  if (!terminal) return;

  try {
    const res = await fetch('/api/admin/logs', { headers: getAuthHeaders() });
    if (res.status === 401 || res.status === 403) {
      terminal.innerHTML = `<div style="color: #ff5555; padding: 15px;">Acceso denegado a la consola. Sesión no autorizada.</div>`;
      return;
    }
    if (!res.ok) return;

    const data = await res.json();
    const logList = Array.isArray(data.lines) ? data.lines : (Array.isArray(data.logs) ? data.logs : (typeof data.logs === 'string' ? data.logs.split('\n') : []));

    if (logList.length > 0) {
      terminal.innerHTML = logList.map(line => {
        const isErr = line.includes('ERROR') || line.includes('Error') || line.includes('Failed') || line.includes('Fatal');
        const color = isErr ? '#ff5555' : 'var(--text-muted)';
        return `<div style="color: ${color}; font-family: monospace; font-size: 0.82rem; line-height: 1.4; word-break: break-all;">${line.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
      }).join('');
      terminal.scrollTop = terminal.scrollHeight;
    }
  } catch (err) {
    console.warn('[Admin Console] Logs fetch warning:', err.message);
  }
}

export function clearConsoleLogs() {
  const terminal = document.getElementById('terminal-box');
  if (terminal) {
    terminal.innerHTML = '<div style="color: var(--text-muted); font-family: monospace;">Pantalla limpia. Esperando nuevos registros...</div>';
  }
}
