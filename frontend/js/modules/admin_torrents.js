/**
 * KuraStream - Admin Torrents Module
 * Handles live Nyaa.si search, missing episodes discovery, sequential aria2c download queue,
 * and staging ingestion monitor for "Por Organizar".
 */

import { getAuthHeaders, openAdminLoginModal } from './auth.js';

let torrentInterval = null;
let lastActiveDownloadId = null;

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
  if (window.location.hash !== '#/admin') {
    stopTorrentStatusPolling();
    return;
  }

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
  const tmBtnPauseActive = document.getElementById('btn-pause-active-download');
  const tmBtnCancelActive = document.getElementById('btn-cancel-active-download');
  const tmQueueCount = document.getElementById('tm-queue-count');
  const tmQueueList = document.getElementById('tm-queue-list');
  const tmHistoryList = document.getElementById('tm-history-list');

  // Badges & Toggle Buttons
  const badgeText = status.isEnabled ? (status.isScanning ? 'Escaneando...' : 'Activo (Auto-Scan)') : 'Inactivo';
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
    const isNewDownload = (lastActiveDownloadId !== cur.id);
    lastActiveDownloadId = cur.id;

    // Guaranteed Anime Name
    const animeName = cur.cleanTitle || cur.animeTitle || cur.title || 'Anime en Descarga';
    const epStr = cur.isBatch
      ? '(Temporada Completa / Batch)'
      : `Capítulo ${cur.episode || 1} · Temporada ${cur.season || 1}`;

    const titleHTML = `
      <div style="display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;">
        <span style="font-size: 1.15rem; font-weight: 800; color: #fff;">${animeName}</span>
        <span style="color: var(--accent-color); font-size: 0.92rem; font-weight: 700;">— ${epStr}</span>
      </div>
    `;

    const queueCount = status.downloadQueue ? status.downloadQueue.length : 0;
    const subtitleText = `Archivo: ${cur.title || cur.cleanTitle} | ${queueCount} pendiente${queueCount === 1 ? '' : 's'} en cola. Destino: "Por Organizar".`;

    const isIngesting = cur.status === 'ingesting';
    const isPaused = cur.status === 'paused';
    const displayPercent = isIngesting ? 100 : Math.max(0, Math.min(100, cur.percent || 0));

    let statusStr = 'Descargando con aria2c en servidor...';
    if (isIngesting) statusStr = '✅ Descarga 100% completada. Procesando video e ingresando a "Por Organizar"...';
    if (isPaused) statusStr = '⏸️ Descarga en Pausa.';

    const metricsStr = isIngesting ? 'Completado' : `${cur.loadedMB || '0.0 MB'} / ${cur.totalMB || '0.0 MB'} (${cur.speedMBs || '0.0'} MB/s)`;

    if (tmActiveTitle) tmActiveTitle.innerHTML = titleHTML;
    if (tmActiveSubtitle) tmActiveSubtitle.textContent = subtitleText;
    if (tmActivePercent) tmActivePercent.textContent = `${displayPercent}%`;

    // Reset progress bar without backward glitch if this is a newly started download
    if (tmActiveBar) {
      if (isNewDownload) {
        tmActiveBar.style.transition = 'none';
        tmActiveBar.style.width = '0%';
        void tmActiveBar.offsetWidth; // trigger reflow
      }
      tmActiveBar.style.transition = 'width 0.4s ease-out';
      tmActiveBar.style.width = `${displayPercent}%`;
      tmActiveBar.style.background = isPaused ? '#ffab00' : 'linear-gradient(90deg, var(--accent-color), #00e08f)';
    }

    if (tmActiveStatus) tmActiveStatus.textContent = `Estado: ${statusStr}`;
    if (tmActiveMetrics) tmActiveMetrics.textContent = metricsStr;

    // Active Pause Button
    if (tmBtnPauseActive) {
      tmBtnPauseActive.style.display = 'inline-flex';
      if (isPaused) {
        tmBtnPauseActive.style.color = '#00e08f';
        tmBtnPauseActive.style.background = 'rgba(0, 224, 143, 0.15)';
        tmBtnPauseActive.style.border = '1px solid rgba(0, 224, 143, 0.35)';
        tmBtnPauseActive.innerHTML = '<i data-lucide="play" style="width: 14px; height: 14px;"></i> <span>Reanudar</span>';
      } else {
        tmBtnPauseActive.style.color = '#ffab00';
        tmBtnPauseActive.style.background = 'rgba(255, 171, 0, 0.12)';
        tmBtnPauseActive.style.border = '1px solid rgba(255, 171, 0, 0.3)';
        tmBtnPauseActive.innerHTML = '<i data-lucide="pause" style="width: 14px; height: 14px;"></i> <span>Pausar</span>';
      }

      tmBtnPauseActive.onclick = async (e) => {
        e.preventDefault();
        tmBtnPauseActive.disabled = true;
        try {
          const endpoint = isPaused ? '/api/admin/autodownload/queue/resume' : '/api/admin/autodownload/queue/pause';
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ id: cur.id })
          });
          const data = await res.json();
          if (data.status) updateTorrentUI(data.status);
        } catch (err) {
          console.error('Error toggling active pause:', err);
        } finally {
          tmBtnPauseActive.disabled = false;
        }
      };
    }

    // Active Cancel Button
    if (tmBtnCancelActive) {
      tmBtnCancelActive.style.display = 'inline-flex';
    }
  } else {
    lastActiveDownloadId = null;
    if (tmActiveTitle) tmActiveTitle.textContent = 'Sin descargas activas en este momento';
    if (tmActiveSubtitle) tmActiveSubtitle.textContent = 'El servidor está a la espera de nuevos capítulos o inicio de escaneo.';
    if (tmActivePercent) tmActivePercent.textContent = '0%';
    if (tmActiveBar) {
      tmActiveBar.style.transition = 'none';
      tmActiveBar.style.width = '0%';
    }
    if (tmActiveStatus) tmActiveStatus.textContent = 'Estado: En espera';
    if (tmActiveMetrics) tmActiveMetrics.textContent = '0.0 MB / 0.0 MB (0.0 MB/s)';
    if (tmBtnPauseActive) tmBtnPauseActive.style.display = 'none';
    if (tmBtnCancelActive) tmBtnCancelActive.style.display = 'none';
  }

  // Queue List Rendering
  const queue = status.downloadQueue || [];
  if (tmQueueCount) tmQueueCount.textContent = `${queue.length} en cola`;
  if (tmQueueList) {
    if (queue.length === 0) {
      tmQueueList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; padding: 10px 0;">No hay capítulos pendientes en la cola de descarga.</p>';
    } else {
      tmQueueList.innerHTML = queue.map((item, idx) => {
        const isPaused = item.status === 'paused';
        const epLabel = item.isBatch ? 'Batch / Temp. Completa' : `Temp. ${item.season || 1} · Cap. ${item.episode || '?'}`;
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; flex-wrap: wrap; gap: 8px;">
            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%;">
              <strong style="color: #ffab00; font-size: 0.82rem;">#${idx + 1}</strong>
              <span style="color: var(--text-main); font-size: 0.88rem; margin-left: 6px; font-weight: 600;">${item.cleanTitle || item.title}</span>
              <span style="color: var(--text-muted); font-size: 0.78rem;"> (${epLabel})</span>
              <span style="color: var(--text-muted); font-size: 0.72rem; margin-left: 6px; background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px;">💾 ${item.size || 'N/A'}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
              ${isPaused ? `
                <button type="button" class="btn btn-secondary btn-resume-queue-item" data-id="${item.id}" style="padding: 4px 10px; font-size: 0.75rem; color: #00e08f; background: rgba(0, 224, 143, 0.12); border: 1px solid rgba(0, 224, 143, 0.3); border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
                  <i data-lucide="play" style="width: 12px; height: 12px;"></i> Reanudar
                </button>
              ` : `
                <button type="button" class="btn btn-secondary btn-pause-queue-item" data-id="${item.id}" style="padding: 4px 10px; font-size: 0.75rem; color: #ffab00; background: rgba(255, 171, 0, 0.12); border: 1px solid rgba(255, 171, 0, 0.3); border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
                  <i data-lucide="pause" style="width: 12px; height: 12px;"></i> Pausar
                </button>
              `}
              <button type="button" class="btn btn-secondary btn-remove-queue-item" data-id="${item.id}" style="padding: 4px 10px; font-size: 0.75rem; color: #ff5555; background: rgba(255, 85, 85, 0.1); border: 1px solid rgba(255, 85, 85, 0.25); cursor: pointer; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;">
                <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i> Quitar
              </button>
              <button type="button" class="btn btn-secondary btn-dismiss-queue-item" data-guid="${item.guid || item.torrentUrl}" title="Descartar (no volver a descargar automáticamente)" style="padding: 4px 8px; font-size: 0.72rem; color: var(--text-muted); background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); cursor: pointer; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;">
                <i data-lucide="ban" style="width: 12px; height: 12px;"></i> Ignorar
              </button>
            </div>
          </div>
        `;
      }).join('');

      // Wire Pause
      tmQueueList.querySelectorAll('.btn-pause-queue-item').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          await fetch('/api/admin/autodownload/queue/pause', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ id })
          });
          fetchTorrentStatus();
        };
      });

      // Wire Resume
      tmQueueList.querySelectorAll('.btn-resume-queue-item').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          await fetch('/api/admin/autodownload/queue/resume', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ id })
          });
          fetchTorrentStatus();
        };
      });

      // Wire Remove
      tmQueueList.querySelectorAll('.btn-remove-queue-item').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          await fetch('/api/admin/autodownload/queue/remove', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ id })
          });
          fetchTorrentStatus();
        };
      });

      // Wire Dismiss
      tmQueueList.querySelectorAll('.btn-dismiss-queue-item').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const guid = btn.getAttribute('data-guid');
          await fetch('/api/admin/autodownload/dismiss', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ guid })
          });
          alert('Torrent descartado. El auto-descargador no volverá a incluirlo.');
          fetchTorrentStatus();
        };
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
          <span class="badge" style="font-size: 0.72rem; background: rgba(0, 224, 143, 0.15); color: #00e08f;">Enviado a "Por Organizar"</span>
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
          <div style="display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; margin-bottom: 6px;">
            <div style="font-size: 0.92rem; font-weight: 700; color: var(--text-main); line-height: 1.35; word-break: break-word;">${item.title}</div>
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 10px;">
              <div style="display: flex; gap: 12px; font-size: 0.8rem; color: var(--text-muted); align-items: center; flex-wrap: wrap;">
                <span style="background: rgba(255,255,255,0.08); padding: 2px 8px; border-radius: 4px; color: var(--text-main); font-weight: 600;">💾 ${item.size || 'N/A'}</span>
                <span style="color: #00e08f; font-weight: 600;">🟢 ${item.seeders || 0} Seeders</span>
                <span style="color: #ff5555; font-weight: 600;">🔴 ${item.leechers || 0} Leechers</span>
              </div>
              <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                <button type="button" class="btn btn-secondary btn-find-all-episodes" data-title="${item.title.replace(/"/g, '&quot;')}" style="padding: 7px 14px; font-size: 0.78rem; font-weight: 600; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 5px;">
                  <i data-lucide="package" style="width: 14px; height: 14px; color: var(--accent-color);"></i> Buscar Temporada
                </button>
                <button type="button" class="btn btn-primary btn-add-manual-torrent" data-link="${item.link}" data-title="${item.title.replace(/"/g, '&quot;')}" data-guid="${item.guid || ''}" data-size="${item.size || ''}" data-seeds="${item.seeders || 0}" style="padding: 7px 16px; font-size: 0.82rem; font-weight: 700; white-space: nowrap; display: flex; align-items: center; gap: 6px; border-radius: 6px; cursor: pointer;">
                  <i data-lucide="download" style="width: 14px; height: 14px;"></i> Descargar
                </button>
              </div>
            </div>
            <!-- Sub-container for all episodes lookup -->
            <div class="all-episodes-panel" style="display: none; background: rgba(0,0,0,0.3); border: 1px dashed var(--border-color); border-radius: 6px; padding: 12px; margin-top: 8px;">
              <div class="all-episodes-loading" style="font-size: 0.8rem; color: var(--text-muted);"><div class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></div> Explorando todos los capítulos disponibles de la serie...</div>
              <div class="all-episodes-content"></div>
            </div>
          </div>
        `).join('');

        if (window.lucide) window.lucide.createIcons({ root: torrentSearchResultsList });

        // Wire Single Download
        torrentSearchResultsList.querySelectorAll('.btn-add-manual-torrent').forEach(btn => {
          btn.addEventListener('click', async () => {
            const torrentUrl = btn.getAttribute('data-link');
            const torrentTitle = btn.getAttribute('data-title');
            const guid = btn.getAttribute('data-guid');
            const size = btn.getAttribute('data-size');
            const seeders = parseInt(btn.getAttribute('data-seeds') || 0, 10);

            btn.disabled = true;
            btn.innerHTML = `<div class="spinner" style="width:12px;height:12px;border-width:2px;margin-right:4px;"></div> Añadiendo...`;

            try {
              const addRes = await fetch('/api/admin/torrents/add', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ torrentUrl, title: torrentTitle, guid, size, seeders })
              });
              const addData = await addRes.json();
              if (addRes.ok && addData.success) {
                alert('¡Torrent añadido a la cola e iniciado con éxito! Todo lo descargado irá directo a "Por Organizar".');
                fetchTorrentStatus();
              } else {
                alert('Error al añadir torrent: ' + (addData.error || 'Desconocido'));
              }
            } catch (err) {
              alert('Error de conexión: ' + err.message);
            } finally {
              btn.disabled = false;
              btn.innerHTML = `<i data-lucide="download" style="width: 14px; height: 14px;"></i> Descargar`;
              if (window.lucide) window.lucide.createIcons({ root: btn });
            }
          });
        });

        // Wire Find All Episodes
        torrentSearchResultsList.querySelectorAll('.btn-find-all-episodes').forEach(btn => {
          btn.addEventListener('click', async () => {
            const rawTitle = btn.getAttribute('data-title');
            const parentCard = btn.closest('div[style*="flex-direction: column"]');
            if (!parentCard) return;

            const panel = parentCard.querySelector('.all-episodes-panel');
            const loading = parentCard.querySelector('.all-episodes-loading');
            const content = parentCard.querySelector('.all-episodes-content');

            if (panel.style.display === 'block') {
              panel.style.display = 'none';
              return;
            }

            panel.style.display = 'block';
            loading.style.display = 'block';
            content.innerHTML = '';

            try {
              const res = await fetch(`/api/admin/torrents/search-episodes?title=${encodeURIComponent(rawTitle)}`, {
                headers: getAuthHeaders()
              });
              const data = await res.json();
              loading.style.display = 'none';

              if (res.ok && data.success) {
                const epList = data.episodes || [];
                if (epList.length === 0) {
                  content.innerHTML = '<p style="color: var(--text-muted); font-size: 0.8rem; margin: 0;">No se encontraron capítulos adicionales para este anime.</p>';
                } else {
                  content.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                      <strong style="font-size: 0.82rem; color: var(--text-main);">Capítulos de la serie (${epList.length} encontrados):</strong>
                      <button type="button" class="btn btn-primary btn-queue-all-missing" style="padding: 4px 12px; font-size: 0.74rem; font-weight: 700; border-radius: 4px; cursor: pointer;">
                        ➕ Añadir Todos los Faltantes a la Cola
                      </button>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 4px; max-height: 200px; overflow-y: auto;">
                      ${epList.map(ep => `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(255,255,255,0.02); border-radius: 4px; font-size: 0.78rem;">
                          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%;">
                            <span style="color: ${ep.alreadyInLibrary ? '#00e08f' : '#ffab00'}; font-weight: 600;">
                              ${ep.alreadyInLibrary ? '✔ En Biblioteca / Cola' : '⏳ Faltante'}
                            </span>
                            <span style="color: var(--text-main); margin-left: 6px;">${ep.title}</span>
                          </div>
                          ${ep.alreadyInLibrary ? '' : `
                            <button type="button" class="btn btn-secondary btn-add-sub-torrent" data-link="${ep.link}" data-title="${ep.title.replace(/"/g, '&quot;')}" data-guid="${ep.guid || ''}" data-size="${ep.size || ''}" data-seeds="${ep.seeders || 0}" style="padding: 3px 8px; font-size: 0.72rem; border-radius: 4px; cursor: pointer;">
                              ⬇️ Añadir
                            </button>
                          `}
                        </div>
                      `).join('')}
                    </div>
                  `;

                  // Wire Queue All Missing
                  const queueAllBtn = content.querySelector('.btn-queue-all-missing');
                  if (queueAllBtn) {
                    queueAllBtn.onclick = async () => {
                      const missing = epList.filter(e => !e.alreadyInLibrary);
                      if (missing.length === 0) {
                        alert('¡Todos los capítulos ya se encuentran en tu biblioteca o en la cola!');
                        return;
                      }

                      queueAllBtn.disabled = true;
                      queueAllBtn.textContent = `Añadiendo ${missing.length} capítulos...`;

                      for (const ep of missing) {
                        try {
                          await fetch('/api/admin/torrents/add', {
                            method: 'POST',
                            headers: getAuthHeaders(),
                            body: JSON.stringify({
                              torrentUrl: ep.link,
                              title: ep.title,
                              guid: ep.guid,
                              size: ep.size,
                              seeders: ep.seeders
                            })
                          });
                        } catch (e) {}
                      }

                      alert(`¡${missing.length} capítulos faltantes añadidos a la cola! Se descargarán 1 por 1 y pasarán a "Por Organizar".`);
                      fetchTorrentStatus();
                      panel.style.display = 'none';
                    };
                  }

                  // Wire individual missing downloads inside sub-list
                  content.querySelectorAll('.btn-add-sub-torrent').forEach(subBtn => {
                    subBtn.onclick = async () => {
                      const torrentUrl = subBtn.getAttribute('data-link');
                      const torrentTitle = subBtn.getAttribute('data-title');
                      const guid = subBtn.getAttribute('data-guid');
                      const size = subBtn.getAttribute('data-size');
                      const seeders = parseInt(subBtn.getAttribute('data-seeds') || 0, 10);

                      subBtn.disabled = true;
                      await fetch('/api/admin/torrents/add', {
                        method: 'POST',
                        headers: getAuthHeaders(),
                        body: JSON.stringify({ torrentUrl, title: torrentTitle, guid, size, seeders })
                      });
                      subBtn.textContent = 'En cola ✔';
                      fetchTorrentStatus();
                    };
                  });
                }
              }
            } catch (err) {
              loading.style.display = 'none';
              content.innerHTML = '<p style="color: #ff5555; font-size: 0.8rem;">Error al buscar capítulos: ' + err.message + '</p>';
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

export async function toggleTorrentManager() {
  try {
    const res = await fetch('/api/admin/autodownload/toggle', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok && data.status) {
      updateTorrentUI(data.status);
    }
  } catch (err) {
    alert('Error al alternar Auto-Scan: ' + err.message);
  }
}

export async function scanTorrentManagerNow() {
  const btn = document.getElementById('btn-scan-torrent-manager-now');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:6px;"></div> Escaneando novedades...`;
  }
  try {
    const res = await fetch('/api/admin/autodownload/scan', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok && data.status) {
      updateTorrentUI(data.status);
      alert(`Escaneo completado. Se encolaron ${data.enqueued || 0} nuevos capítulos no duplicados.`);
    }
  } catch (err) {
    alert('Error al escanear: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i> Escanear Ahora`;
      if (window.lucide) window.lucide.createIcons({ root: btn });
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
  if (!confirm('¿Seguro que deseas detener y cancelar la descarga activa actual?')) return;
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
