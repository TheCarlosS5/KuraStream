/**
 * KuraStream - Admin Torrents Module
 * Handles live Nyaa.si search, sequential 1-by-1 download queue, active WebTorrent monitor.
 */

import { getAuthHeaders, openAdminLoginModal } from './auth.js';

let torrentInterval = null;

export function startTorrentStatusPolling() {
  stopTorrentStatusPolling();
  fetchTorrentStatus();
  torrentInterval = setInterval(fetchTorrentStatus, 2000);
}

export function stopTorrentStatusPolling() {
  if (torrentInterval) {
    clearInterval(torrentInterval);
    torrentInterval = null;
  }
}

export async function fetchTorrentStatus() {
  try {
    const res = await fetch('/api/admin/autodownload/status', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const status = await res.json();
    updateTorrentUI(status);
  } catch (err) {
    console.warn('[Admin Torrents] Status fetch warning:', err.message);
  }
}

export function updateTorrentUI(status) {
  if (!status) return;

  const tmBadge = document.getElementById('torrent-manager-status-badge');
  const tmBtnToggle = document.getElementById('btn-toggle-torrent-manager');
  const tmActiveTitle = document.getElementById('tm-active-title');
  const tmActiveSubtitle = document.getElementById('tm-active-subtitle');
  const tmActivePercent = document.getElementById('tm-active-percent');
  const tmActiveBar = document.getElementById('tm-active-bar');
  const tmActiveStatus = document.getElementById('tm-active-status');
  const tmActiveMetrics = document.getElementById('tm-active-metrics');
  const tmQueueCount = document.getElementById('tm-queue-count');
  const tmQueueList = document.getElementById('tm-queue-list');
  const tmHistoryList = document.getElementById('tm-history-list');

  // Badges & Toggle Buttons
  const badgeText = status.isEnabled ? (status.isScanning ? 'Escaneando...' : 'Activo (30m)') : 'Inactivo';
  const badgeBg = status.isEnabled ? 'rgba(0, 224, 143, 0.2)' : 'rgba(255,255,255,0.1)';
  const badgeColor = status.isEnabled ? '#00e08f' : 'var(--text-muted)';
  const toggleHTML = status.isEnabled ?
    '<i data-lucide="power" style="width: 14px; height: 14px;"></i> Desactivar Auto-Scan' :
    '<i data-lucide="power" style="width: 14px; height: 14px;"></i> Activar Auto-Scan';

  if (tmBadge) {
    tmBadge.textContent = badgeText;
    tmBadge.style.background = badgeBg;
    tmBadge.style.color = badgeColor;
  }
  if (tmBtnToggle) tmBtnToggle.innerHTML = toggleHTML;

  // Active Download Progress Monitor
  if (status.currentDownload) {
    const cur = status.currentDownload;
    const titleText = `${cur.animeTitle} - Cap. ${cur.episode} (Temp. ${cur.season})`;
    const subtitleText = `Torrents en cola: ${status.downloadQueue ? status.downloadQueue.length : 0} pendientes.`;
    const isIngesting = cur.status === 'ingesting';
    const displayPercent = isIngesting ? 100 : cur.percent;
    const statusStr = isIngesting ? '✅ Descarga 100% completada. Procesando e ingresando a Por Organizar...' : 'Descargando torrent en servidor...';
    const metricsStr = isIngesting ? 'Completado - Ingestando a Staging' : `${cur.loadedMB} MB / ${cur.totalMB} MB (${cur.speedMBs} MB/s)`;

    if (tmActiveTitle) tmActiveTitle.textContent = titleText;
    if (tmActiveSubtitle) tmActiveSubtitle.textContent = subtitleText;
    if (tmActivePercent) tmActivePercent.textContent = `${displayPercent}%`;
    if (tmActiveBar) {
      tmActiveBar.style.transition = 'width 0.5s ease-in-out';
      tmActiveBar.style.width = `${displayPercent}%`;
    }
    if (tmActiveStatus) tmActiveStatus.textContent = `Estado: ${statusStr}`;
    if (tmActiveMetrics) tmActiveMetrics.textContent = metricsStr;
  } else {
    if (tmActiveTitle) tmActiveTitle.textContent = 'Sin descargas activas en este momento';
    if (tmActiveSubtitle) tmActiveSubtitle.textContent = 'El servidor está a la espera de nuevos capítulos o inicio de escaneo.';
    if (tmActivePercent) tmActivePercent.textContent = '0%';
    if (tmActiveBar) tmActiveBar.style.width = '0%';
    if (tmActiveStatus) tmActiveStatus.textContent = 'Estado: En espera';
    if (tmActiveMetrics) tmActiveMetrics.textContent = '0.0 MB / 0.0 MB (0.0 MB/s)';
  }

  // Queue List Rendering
  const queue = status.downloadQueue || [];
  if (tmQueueCount) tmQueueCount.textContent = `${queue.length} en cola`;
  if (tmQueueList) {
    if (queue.length === 0) {
      tmQueueList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; padding: 10px 0;">No hay capítulos pendientes en la cola de descarga.</p>';
    } else {
      tmQueueList.innerHTML = queue.map((item, idx) => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px;">
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%;">
            <strong style="color: #ffab00; font-size: 0.82rem;">#${idx + 1}</strong>
            <span style="color: var(--text-main); font-size: 0.88rem; margin-left: 6px;">${item.animeTitle || item.title}</span>
            <span style="color: var(--text-muted); font-size: 0.78rem;"> (Temp. ${item.season || 1} · Cap. ${item.episode || '?'})</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
            <span class="badge" style="font-size: 0.72rem; background: rgba(255,255,255,0.08); color: var(--text-muted);">En espera 1-a-1</span>
            <button type="button" class="btn btn-secondary btn-remove-queue-item" data-index="${idx}" style="padding: 4px 10px; font-size: 0.78rem; color: #ff5555; background: rgba(255, 85, 85, 0.1); border: 1px solid rgba(255, 85, 85, 0.25); cursor: pointer; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;">
              <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i> Quitar
            </button>
          </div>
        </div>
      `).join('');

      tmQueueList.querySelectorAll('.btn-remove-queue-item').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const index = parseInt(btn.getAttribute('data-index'), 10);
          try {
            const res = await fetch('/api/admin/autodownload/queue/remove', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify({ index })
            });
            const data = await res.json();
            if (data.status) updateTorrentUI(data.status);
          } catch (err) {
            console.error('Error removing queue item:', err);
          }
        });
      });
    }
  }

  // History List Rendering
  const history = status.history || [];
  if (tmHistoryList) {
    if (history.length === 0) {
      tmHistoryList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; padding: 10px 0;">No hay descargas recientes registradas en el historial.</p>';
    } else {
      tmHistoryList.innerHTML = history.map(item => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px;">
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 75%;">
            <strong style="color: var(--text-main); font-size: 0.88rem;">${item.anime_title || item.title || 'Anime'}</strong>
            <span style="color: var(--text-muted); font-size: 0.78rem;"> Cap. ${item.episode || '?'} (Temp. ${item.season || 1})</span>
          </div>
          <span class="badge" style="font-size: 0.72rem; background: rgba(0, 224, 143, 0.15); color: #00e08f;">Importado en Catálogo</span>
        </div>
      `).join('');
    }
  }

  if (window.lucide) window.lucide.createIcons();
}

export async function executeTorrentSearch() {
  const torrentSearchInput = document.getElementById('torrent-search-input');
  const torrentFilterSpanishCheck = document.getElementById('torrent-filter-spanish-check');
  const btnSearchTorrents = document.getElementById('btn-search-torrents');
  const torrentSearchResultsContainer = document.getElementById('torrent-search-results-container');
  const torrentResultsCount = document.getElementById('torrent-results-count');
  const torrentSearchResultsList = document.getElementById('torrent-search-results-list');

  const query = torrentSearchInput ? torrentSearchInput.value.trim() : '';
  const filterSpanish = torrentFilterSpanishCheck && torrentFilterSpanishCheck.checked ? '1' : '0';

  if (btnSearchTorrents) {
    btnSearchTorrents.disabled = true;
    btnSearchTorrents.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:6px;"></div> Buscando...`;
  }

  try {
    const res = await fetch(`/api/admin/torrents/search?q=${encodeURIComponent(query)}&filterSpanish=${filterSpanish}`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();

    if (res.ok && data.success) {
      const results = data.results || [];
      if (torrentSearchResultsContainer) torrentSearchResultsContainer.style.display = 'block';
      if (torrentResultsCount) torrentResultsCount.textContent = results.length;

      if (results.length === 0) {
        torrentSearchResultsList.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem; padding: 15px 0;">No se encontraron torrents en Nyaa con los términos indicados.</p>`;
      } else {
        torrentSearchResultsList.innerHTML = results.map((item) => `
          <div style="display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; margin-bottom: 4px;">
            <div style="font-size: 0.9rem; font-weight: 700; color: var(--text-main); line-height: 1.35; word-break: break-word;">${item.title}</div>
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">
              <div style="display: flex; gap: 14px; font-size: 0.8rem; color: var(--text-muted); align-items: center; flex-wrap: wrap;">
                <span style="background: rgba(255,255,255,0.08); padding: 2px 8px; border-radius: 4px; color: var(--text-main); font-weight: 600;">💾 ${item.size || 'N/A'}</span>
                <span style="color: #00e08f; font-weight: 600;">🟢 ${item.seeders || 0} Seeders</span>
                <span style="color: #ff5555; font-weight: 600;">🔴 ${item.leechers || 0} Leechers</span>
              </div>
              <button type="button" class="btn btn-primary btn-add-manual-torrent" data-link="${item.link}" data-title="${item.title.replace(/"/g, '&quot;')}" style="padding: 8px 18px; font-size: 0.82rem; font-weight: 700; white-space: nowrap; display: flex; align-items: center; gap: 6px; border-radius: 6px; cursor: pointer;">
                <i data-lucide="download" style="width: 15px; height: 15px;"></i> Descargar Torrent
              </button>
            </div>
          </div>
        `).join('');

        if (window.lucide) window.lucide.createIcons({ root: torrentSearchResultsList });

        torrentSearchResultsList.querySelectorAll('.btn-add-manual-torrent').forEach(btn => {
          btn.addEventListener('click', async () => {
            const torrentUrl = btn.getAttribute('data-link');
            const torrentTitle = btn.getAttribute('data-title');
            btn.disabled = true;
            btn.innerHTML = `<div class="spinner" style="width:12px;height:12px;border-width:2px;margin-right:4px;"></div> Añadiendo...`;

            try {
              const addRes = await fetch('/api/admin/torrents/add', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ torrentUrl, title: torrentTitle })
              });
              const addData = await addRes.json();
              if (addRes.ok && addData.success) {
                alert('¡Torrent añadido a la cola e iniciado con éxito!');
                fetchTorrentStatus();
              } else {
                alert('Error al añadir torrent: ' + (addData.error || 'Desconocido'));
              }
            } catch (err) {
              alert('Error de conexión: ' + err.message);
            } finally {
              btn.disabled = false;
              btn.innerHTML = `<i data-lucide="download" style="width: 14px; height: 14px;"></i> Descargar Torrent`;
              if (window.lucide) window.lucide.createIcons({ root: btn });
            }
          });
        });
      }
    } else {
      alert('Error en búsqueda de torrents: ' + (data.error || 'No se pudo conectar a Nyaa'));
    }
  } catch (err) {
    console.error(err);
    alert('Error de conexión con Nyaa.');
  } finally {
    if (btnSearchTorrents) {
      btnSearchTorrents.disabled = false;
      btnSearchTorrents.innerHTML = `<i data-lucide="search" style="width: 16px; height: 16px;"></i> Buscar Torrents`;
      if (window.lucide) window.lucide.createIcons({ root: btnSearchTorrents });
    }
  }
}

export async function startTorrentQueue() {
  const btn = document.getElementById('btn-start-download-queue');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/admin/autodownload/queue/start', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok && data.success) {
      if (data.status) updateTorrentUI(data.status);
      alert(data.message || 'Descargas iniciadas');
    } else {
      alert('No se pudo iniciar: ' + (data.error || 'Desconocido'));
    }
  } catch (err) {
    alert('Error al iniciar la cola: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function clearTorrentQueue() {
  if (!confirm('¿Seguro que deseas vaciar toda la cola de descargas?')) return;
  try {
    const res = await fetch('/api/admin/autodownload/queue/clear', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok && data.status) updateTorrentUI(data.status);
  } catch (err) {
    alert('Error al vaciar la cola: ' + err.message);
  }
}

export async function cancelActiveDownload() {
  if (!confirm('¿Seguro que deseas detener la descarga activa actual?')) return;
  try {
    const res = await fetch('/api/admin/autodownload/cancel-active', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok && data.status) updateTorrentUI(data.status);
  } catch (err) {
    alert('Error al cancelar la descarga: ' + err.message);
  }
}
