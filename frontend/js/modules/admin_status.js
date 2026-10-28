/**
 * KuraStream - Admin Status Module
 * Handles server stats, active streams polling, and laptop display power control.
 */

import { getAuthHeaders, openAdminLoginModal } from './auth.js';

let statsInterval = null;

export function startAdminStatsPolling() {
  stopAdminStatsPolling();
  fetchAdminStats();
  fetchDisplayStatus();
  fetchSystemHealth();
  setupDiagnosticsButton();
  setupBackupButton();
  statsInterval = setInterval(() => {
    fetchAdminStats();
    fetchDisplayStatus();
    fetchSystemHealth();
  }, 3000);
}

export function stopAdminStatsPolling() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
}

export async function fetchAdminStats() {
  // Element IDs match the overview markup in index.html (#admin-sub-overview).
  const statsGrid = document.querySelector('#admin-sub-overview .admin-stats-grid');
  if (!statsGrid) return;

  try {
    const res = await fetch('/api/admin/stats', { headers: getAuthHeaders() });
    if (res.status === 401 || res.status === 403) {
      stopAdminStatsPolling();
      statsGrid.innerHTML = `<div class="admin-card" style="text-align: center; padding: 25px;">
        <p style="color: #ff5555; font-weight: 600;">Sesión de administrador no autorizada.</p>
        <button type="button" class="btn btn-primary" id="btn-reauth-stats">Iniciar Sesión Administrador</button>
      </div>`;
      const btn = document.getElementById('btn-reauth-stats');
      if (btn) btn.onclick = openAdminLoginModal;
      return;
    }

    if (!res.ok) return;
    const data = await res.json();
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    setText('stat-shows', data.showsCount || 0);
    setText('stat-episodes', data.episodesCount || 0);
    setText('stat-size', data.librarySizeFormatted || '0 GB');
    setText('stat-duration', `${data.totalHours || 0} h`);
    setText('stat-library-folder-size', data.librarySizeFormatted || '0 GB');

    if (data.diskInfo) {
      const disk = data.diskInfo;
      const pct = Number(disk.usedPercent) || 0;
      setText('disk-usage-badge', `${pct.toFixed(1)}% USADO`);
      setText('stat-disk-used', disk.usedFormatted || '--');
      setText('stat-disk-free', disk.freeFormatted || '--');
      setText('stat-disk-total', disk.totalFormatted || '--');
      const bar = document.getElementById('disk-progress-bar');
      if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    }
  } catch (err) {
    console.warn('[Admin Status] Stats fetch warning:', err.message);
  }
}

export async function fetchDisplayStatus() {
  const badge = document.getElementById('display-status-badge');
  const btnOff = document.getElementById('btn-display-off');
  const btnOn = document.getElementById('btn-display-on');

  try {
    const res = await fetch('/api/admin/display/status', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();

    const isOff = data.state === 'off' || data.brightness === 0;
    if (badge) {
      badge.textContent = isOff ? 'APAGADA (MODO ANTI-CALENTAMIENTO)' : 'ENCENDIDA';
      badge.style.background = isOff ? 'rgba(168, 85, 247, 0.2)' : 'rgba(0, 224, 143, 0.2)';
      badge.style.color = isOff ? '#FB923C' : '#00e08f';
    }
    if (btnOff) btnOff.disabled = isOff;
    if (btnOn) btnOn.disabled = !isOff;
  } catch (err) {
    console.warn('[Admin Status] Display status fetch warning:', err.message);
  }
}

export async function toggleLaptopDisplayPower(power) {
  try {
    const res = await fetch('/api/admin/display/power', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ power })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      fetchDisplayStatus();
    } else {
      alert('Error al cambiar pantalla: ' + (data.error || 'Desconocido'));
    }
  } catch (err) {
    alert('Error de red al cambiar estado de pantalla: ' + err.message);
  }
}

export function setupDiagnosticsButton() {
  const btn = document.getElementById('btn-run-diagnostics');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = 'true';
    btn.onclick = () => runDiagnostics();
  }
}

export async function runDiagnostics() {
  const btn = document.getElementById('btn-run-diagnostics');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm mr-5"></span> Comprobando...';
  }

  try {
    const res = await fetch('/api/admin/diagnostics', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const d = data.diagnostics || data;

    const setField = (id, val, isSuccess = null) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = val !== undefined && val !== null ? String(val) : '--';
      if (isSuccess === true) {
        el.style.color = '#00e08f';
      } else if (isSuccess === false) {
        el.style.color = '#ff5555';
      } else {
        el.style.color = '';
      }
    };

    if (d.database) {
      const dbOk = d.database.connected || d.database.status === 'connected' || d.database.label === 'OK';
      setField('diag-database', d.database.label || (dbOk ? 'OK' : 'Error'), dbOk);
    }
    if (d.storage) {
      const storageOk = d.storage.exists && d.storage.readable;
      setField('diag-lib-path', d.storage.library_dir || d.storage.label || 'OK', storageOk);
      setField('diag-lib-writable', d.storage.writable_label || (d.storage.writable ? 'Yes' : 'No'), Boolean(d.storage.writable));
    }
    if (d.ffmpeg) {
      const ffmpegOk = d.ffmpeg.installed !== false && d.ffmpeg.version !== 'missing';
      setField('diag-ffmpeg', d.ffmpeg.label || d.ffmpeg.version || (ffmpegOk ? 'OK' : 'missing'), ffmpegOk);
    }
    if (d.ffprobe) {
      const ffprobeOk = d.ffprobe.installed !== false && d.ffprobe.version !== 'missing';
      setField('diag-ffprobe', d.ffprobe.label || d.ffprobe.version || (ffprobeOk ? 'OK' : 'missing'), ffprobeOk);
    }
    if (d.tmdb) {
      const tmdbConfigured = d.tmdb.configured || d.tmdb.configured_label === 'Yes';
      const tmdbAuthOk = d.tmdb.auth === 'OK' && d.tmdb.reachable === 'OK';
      setField('diag-tmdb-config', d.tmdb.configured_label || (tmdbConfigured ? 'Yes' : 'No'), tmdbConfigured);
      setField('diag-tmdb-auth', d.tmdb.auth_label || (tmdbAuthOk ? 'OK' : 'Error'), tmdbAuthOk);
    }
    if (d.php) {
      setField('diag-php-upload', d.php.upload_max_filesize || '4G');
      setField('diag-php-post', d.php.post_max_size || '4G');
    }
    if (d.subtitle_assets) {
      const subsOk = d.subtitle_assets.octopus_available || d.subtitle_assets.label === 'OK';
      setField('diag-subs-assets', d.subtitle_assets.label || (subsOk ? 'OK' : 'Error'), subsOk);
      setField('diag-subs-cache', d.subtitle_assets.cache_writable_label || (d.subtitle_assets.cache_writable ? 'Yes' : 'No'), Boolean(d.subtitle_assets.cache_writable));
    }
    if (d.transcode) {
      setField('diag-transcode-workers', d.transcode.label || `${d.transcode.active_workers || 0} / ${d.transcode.max_workers || 2}`);
    }
  } catch (err) {
    console.error('Failed to run multimedia diagnostics:', err);
    alert('Error al ejecutar diagnóstico multimedia: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// System health, backups and background jobs
// ---------------------------------------------------------------------------------------------------------------

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 ** 4) return `${(value / 1024 ** 4).toFixed(1)} TB`;
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

function formatWhen(iso) {
  if (!iso) return 'nunca';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString();
}

const JOB_LABELS = { library_scan: 'Escaneo de la biblioteca', season_sync: 'Sincronizar temporadas', season_sync_stale: 'Temporadas pendientes', backup: 'Respaldo de la base de datos', subtitles_prepare: 'Preparar subtítulos y fuentes' };
const JOB_STATUS = { queued: 'En cola', running: 'En curso', done: 'Listo', failed: 'Falló' };

/** Builds the metric tiles. Pure data -> DOM with textContent only (nothing from the server becomes markup). */
export function renderSystemHealth(grid, health, transcode) {
  grid.textContent = '';
  const tile = (label, value, level = '') => {
    const box = document.createElement('div');
    box.className = 'admin-storage-metric-box' + (level ? ` is-${level}` : '');
    const l = document.createElement('div');
    l.className = 'admin-storage-metric-label';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'admin-storage-metric-value';
    v.textContent = value;
    box.append(l, v);
    grid.appendChild(box);
  };
  const disk = (d) => (d ? `${formatBytes(d.free_bytes)} libres (${d.used_percent}% usado)` : '--');
  const load = health.load_average ? health.load_average.join(' / ') : '--';
  const cores = health.cpu_cores ? ` · ${health.cpu_cores} núcleos` : '';
  tile('Transcodificaciones', `${transcode.active} / ${transcode.max}`, transcode.active >= transcode.max ? 'warn' : '');
  tile('Procesos ffmpeg', String(health.processes.ffmpeg));
  tile('Espectadores en Watch Party', String(health.party_viewers));
  tile('Carga del equipo (1/5/15 min)', load + cores);
  tile('Disco de la biblioteca', disk(health.disk.library), health.disk.library && health.disk.library.used_percent >= 90 ? 'warn' : '');
  tile('Disco de respaldos', disk(health.disk.backups), health.disk.backups && health.disk.backups.used_percent >= 90 ? 'warn' : '');
  tile('Reproducción directa por nginx', health.direct_play_offload ? 'Activa (sin ocupar PHP)' : 'No (PHP envía los bytes)');
  tile('Servidor web', health.server_software);
  tile('Último respaldo', health.backups.last_at ? formatWhen(health.backups.last_at) : (health.backups.available ? 'Aún no hay' : 'mysqldump no instalado'), !health.backups.last_at ? 'warn' : '');
  tile('Trabajos', `${health.jobs.queued} en cola · ${health.jobs.running} en curso · ${health.jobs.failed_24h} fallidos (24 h)`, health.jobs.failed_24h > 0 ? 'warn' : '');
  if (!health.migrations_ok) tile('Base de datos', 'Una migración falló: revisa el registro del servidor', 'warn');
}

export function renderJobList(list, jobs) {
  list.textContent = '';
  if (!jobs.length) {
    const item = document.createElement('li');
    item.className = 'admin-simple-empty';
    item.textContent = 'Todavía no hay trabajos.';
    list.appendChild(item);
    return;
  }
  jobs.forEach((job) => {
    const item = document.createElement('li');
    item.className = `admin-simple-item job-${job.status}`;
    const name = JOB_LABELS[job.type] || job.type;
    const progress = job.status === 'running' ? ` ${job.progress}%${job.message ? ` · ${job.message}` : ''}` : '';
    const error = job.status === 'failed' && job.error ? ` — ${job.error}` : '';
    item.textContent = `${name}: ${JOB_STATUS[job.status] || job.status}${progress}${error}`;
    list.appendChild(item);
  });
}

export function renderBackupList(list, backups, onDownload) {
  list.textContent = '';
  if (!backups.length) {
    const item = document.createElement('li');
    item.className = 'admin-simple-empty';
    item.textContent = 'No hay respaldos todavía (el worker hace uno al día).';
    list.appendChild(item);
    return;
  }
  backups.forEach((backup) => {
    const item = document.createElement('li');
    item.className = 'admin-simple-item';
    const label = document.createElement('span');
    label.textContent = `${formatWhen(new Date(backup.modified * 1000).toISOString())} · ${formatBytes(backup.size)} `;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-secondary';
    button.textContent = 'Descargar';
    button.addEventListener('click', () => onDownload(backup.file, button));
    item.append(label, button);
    list.appendChild(item);
  });
}

async function downloadBackup(file, button) {
  button.disabled = true;
  try {
    const res = await fetch(`/api/admin/backups/${encodeURIComponent(file)}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = file;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    window.showToast?.(`No se pudo descargar el respaldo (${err.message})`, 'error');
  } finally {
    button.disabled = false;
  }
}

export async function fetchSystemHealth() {
  const grid = document.getElementById('system-health-grid');
  if (!grid) return;
  try {
    const res = await fetch('/api/admin/system', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    renderSystemHealth(grid, data.system, data.transcode);
    const badge = document.getElementById('system-worker-badge');
    if (badge) {
      badge.textContent = data.system.worker.alive ? 'WORKER ACTIVO' : 'SIN WORKER (tareas dentro de la petición)';
      badge.classList.toggle('is-ok', data.system.worker.alive);
    }
    const jobs = document.getElementById('jobs-list');
    if (jobs) renderJobList(jobs, data.jobs);
    const backups = document.getElementById('backup-list');
    if (backups) renderBackupList(backups, data.backups, downloadBackup);
  } catch (err) {
    console.warn('[Admin Status] System health warning:', err.message);
  }
}

export function setupBackupButton() {
  const btn = document.getElementById('btn-create-backup');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = 'true';
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const res = await fetch('/api/admin/backups', { method: 'POST', headers: getAuthHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      window.showToast?.(data.queued ? 'Respaldo en cola: el worker lo hará en unos segundos' : 'Respaldo creado', 'success');
      fetchSystemHealth();
    } catch (err) {
      window.showToast?.(`No se pudo crear el respaldo: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  };
}
