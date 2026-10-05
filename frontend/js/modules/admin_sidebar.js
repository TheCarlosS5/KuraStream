/**
 * Administration panel wiring (sidebar, action buttons, library scan). Loaded on demand: only an administrator who
 * opens the panel downloads it (modules/navigation.js imports it with import()).
 */
import { toggleLaptopDisplayPower, startAdminStatsPolling, stopAdminStatsPolling, fetchAdminStats } from './admin_status.js';
import { getAuthHeaders } from './auth.js';
import { loadStagedImports } from './admin_staging.js';
import { saveShowTitleAndStatus, scrapeShowCover, loadAdminPanel } from './admin_library.js';
import { clearConsoleLogs, startAdminLogsPolling, stopAdminLogsPolling } from './admin_console.js';
import { initImportForm } from './admin_import.js';

export function switchAdminSubView(targetId) {
  const subviews = [
    'admin-sub-overview',
    'admin-sub-import',
    'admin-sub-library',
    'admin-sub-staging',
    'admin-sub-console'
  ];

  const target = targetId || 'admin-sub-overview';

  // 1. Update active tab button
  const navItems = document.querySelectorAll('.admin-nav-item');
  navItems.forEach(btn => {
    if (btn.getAttribute('data-target') === target) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // 2. Hide all subviews, show selected
  subviews.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id === target) {
        el.style.display = 'block';
        el.classList.add('active');
      } else {
        el.style.display = 'none';
        el.classList.remove('active');
      }
    }
  });

  // 3. Lifecycle & data loading per subview
  if (target === 'admin-sub-overview') {
    stopAdminLogsPolling();
    startAdminStatsPolling();
  } else if (target === 'admin-sub-staging') {
    stopAdminStatsPolling();
    stopAdminLogsPolling();
    loadStagedImports();
  } else if (target === 'admin-sub-import') {
    stopAdminStatsPolling();
    stopAdminLogsPolling();
    initImportForm();
  } else if (target === 'admin-sub-library') {
    stopAdminStatsPolling();
    stopAdminLogsPolling();
    loadAdminPanel();
  } else if (target === 'admin-sub-console') {
    stopAdminStatsPolling();
    startAdminLogsPolling();
  }

  // Refresh Lucide icons in newly visible view
  if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

if (typeof window !== 'undefined') {
  window.switchAdminSubView = switchAdminSubView;
}

export function stopAdminPolling() {
  stopAdminStatsPolling();
  stopAdminLogsPolling();
}

export function initAdminSidebar() {
  const navItems = document.querySelectorAll('.admin-nav-item');

  navItems.forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('data-target');
      switchAdminSubView(targetId);
    };
  });

  // Activate currently highlighted tab or default to overview tab
  const currentActive = document.querySelector('.admin-nav-item.active');
  const targetId = currentActive ? currentActive.getAttribute('data-target') : 'admin-sub-overview';
  switchAdminSubView(targetId);

  // Setup Admin Action Buttons
  setupAdminActionButtons();
}

/** Polls a background job until it is done or failed. Resolves {success, result} / {success:false, error}. */
async function waitForAdminJob(jobId, timeoutMs = 30 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const res = await fetch(`/api/admin/jobs/${encodeURIComponent(jobId)}`, { headers: getAuthHeaders() });
      const data = await res.json().catch(() => ({}));
      const job = data.job;
      if (!res.ok || !job) continue;
      if (job.status === 'done') return { success: true, result: job.result };
      if (job.status === 'failed') return { success: false, error: job.error || 'El trabajo falló' };
    } catch {
      // a network blip: keep waiting
    }
  }
  return { success: false, error: 'El trabajo sigue en curso; revisa el panel más tarde' };
}

async function runLibraryScan(btn, endpoint) {
  if (btn.disabled) return;
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Escaneando biblioteca...';
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: getAuthHeaders() });
    let data = await res.json().catch(() => ({}));
    if (res.status === 202 && data.job_id) {
      // The server's background worker runs the scan: follow the job until it ends.
      btn.textContent = 'Escaneando en segundo plano...';
      data = await waitForAdminJob(data.job_id);
      if (data.success) data = data.result || {};
      data.success = data.success !== false && !data.error;
    }
    if (data.success) {
      window.showToast?.(`Escaneo completado: ${data.shows_count ?? 0} títulos, ${data.scanned_count ?? 0} archivos`, 'success');
      fetchAdminStats();
    } else {
      window.showToast?.(data.error || 'No se pudo escanear la biblioteca', 'error');
    }
  } catch {
    window.showToast?.('Error de red al escanear la biblioteca', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

function setupAdminActionButtons() {
  // Library scan / repair (both re-index the media folders and fix stale paths)
  const btnScan = document.getElementById('btn-scan-library');
  const btnRepair = document.getElementById('btn-repair-server');
  if (btnScan) btnScan.onclick = () => runLibraryScan(btnScan, '/api/admin/scan');
  if (btnRepair) btnRepair.onclick = () => runLibraryScan(btnRepair, '/api/admin/repair-library');

  // Display Power Control
  const btnOff = document.getElementById('btn-display-off');
  const btnOn = document.getElementById('btn-display-on');
  if (btnOff) btnOff.onclick = () => toggleLaptopDisplayPower('off');
  if (btnOn) btnOn.onclick = () => toggleLaptopDisplayPower('on');

  // Staging Refresh Button
  const btnRefreshStaging = document.getElementById('btn-refresh-staging');
  if (btnRefreshStaging) btnRefreshStaging.onclick = loadStagedImports;

  // Console Clear Logs
  const btnClearLogs = document.getElementById('btn-clear-logs');
  if (btnClearLogs) btnClearLogs.onclick = clearConsoleLogs;

  // Show Rename and Scrape Cover Modal Buttons
  const btnSaveTitle = document.getElementById('btn-save-show-title');
  const btnScrapeCover = document.getElementById('btn-scrape-show-cover');
  const showIdInput = document.getElementById('edit-show-id');
  const showTitleInput = document.getElementById('edit-show-title-input');

  if (btnSaveTitle) {
    btnSaveTitle.onclick = () => {
      if (showIdInput && showTitleInput) {
        const statusSelect = document.getElementById('edit-show-status-select');
        saveShowTitleAndStatus(showIdInput.value, showTitleInput.value, statusSelect ? statusSelect.value : '');
      }
    };
  }

  // Library: re-detect airing/finished for every show from TMDB (the button had no handler)
  const btnSyncStatuses = document.getElementById('btn-sync-all-statuses');
  if (btnSyncStatuses) {
    btnSyncStatuses.onclick = async () => {
      btnSyncStatuses.disabled = true;
      try {
        const res = await fetch('/api/admin/sync-statuses', { method: 'POST', headers: getAuthHeaders() });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          const n = Array.isArray(data.updated) ? data.updated.length : (data.updated_count ?? null);
          alert(n === null ? 'Estados sincronizados con TMDB.' : `Estados sincronizados con TMDB (${n} actualizados).`);
          loadAdminPanel();
        } else {
          alert('Error al sincronizar estados: ' + (data.error || res.status));
        }
      } catch (err) {
        alert('Error de red: ' + err.message);
      } finally {
        btnSyncStatuses.disabled = false;
      }
    };
  }

  // Branding: custom header logo upload / reset (both controls had no handler)
  const logoZone = document.getElementById('logo-drop-zone');
  const logoInput = document.getElementById('logo-file-input');
  const uploadLogo = async (file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    const headers = getAuthHeaders();
    delete headers['Content-Type'];
    try {
      const res = await fetch('/api/admin/upload-logo', { method: 'POST', headers, body: formData });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        refreshHeaderLogo();
        alert('Logotipo actualizado.');
      } else {
        alert('Error al subir el logotipo: ' + (data.error || res.status));
      }
    } catch (err) {
      alert('Error de red: ' + err.message);
    } finally {
      if (logoInput) logoInput.value = '';
    }
  };
  if (logoZone && logoInput) {
    logoZone.onclick = () => logoInput.click();
    logoInput.onchange = () => uploadLogo(logoInput.files && logoInput.files[0]);
    logoZone.ondragover = (e) => { e.preventDefault(); logoZone.classList.add('dragover'); };
    logoZone.ondragleave = () => logoZone.classList.remove('dragover');
    logoZone.ondrop = (e) => {
      e.preventDefault();
      logoZone.classList.remove('dragover');
      uploadLogo(e.dataTransfer.files && e.dataTransfer.files[0]);
    };
  }
  const btnResetLogo = document.getElementById('btn-reset-logo');
  if (btnResetLogo) {
    btnResetLogo.onclick = async () => {
      if (!confirm('¿Restablecer el logotipo original de KuraStream?')) return;
      try {
        const res = await fetch('/api/admin/reset-logo', { method: 'POST', headers: getAuthHeaders() });
        if (res.ok) {
          refreshHeaderLogo();
          alert('Logotipo restablecido.');
        } else {
          alert('Error al restablecer el logotipo.');
        }
      } catch (err) {
        alert('Error de red: ' + err.message);
      }
    };
  }
  if (btnScrapeCover) {
    btnScrapeCover.onclick = () => {
      if (showIdInput) scrapeShowCover(showIdInput.value);
    };
  }
}

/** Reloads the header logo after an upload/reset (cache-busted so the new image shows at once). */
function refreshHeaderLogo() {
  const img = document.getElementById('custom-logo');
  const fallback = document.getElementById('fallback-logo');
  if (!img) return;
  img.style.display = '';
  if (fallback) fallback.style.display = 'none';
  img.src = `/library/logo.png?t=${Date.now()}`;
}
