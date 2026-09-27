/**
 * KuraStream - Admin Import Module
 * Handles file picking, bulk season detection, multi-file sequential upload with progress,
 * and 1-Click TMDB wizard metadata scraping.
 */

import { getAuthHeaders } from './auth.js';

let stagedFiles = [];

export function initImportForm() {
  const fileInput = document.getElementById('import-file');
  const btnSelectFile = document.getElementById('btn-select-file');
  const importForm = document.getElementById('import-form');
  const btnWizardSearch = document.getElementById('btn-tmdb-wizard-search');
  const wizardInput = document.getElementById('tmdb-wizard-input');
  const btnSearchTmdb = document.getElementById('btn-search-tmdb');
  const showSelector = document.getElementById('import-show-selector');

  if (btnSelectFile && fileInput) {
    btnSelectFile.onclick = () => fileInput.click();
  }

  if (fileInput) {
    fileInput.onchange = handleFilesSelected;
  }

  if (btnWizardSearch) {
    btnWizardSearch.onclick = searchTmdbWizard;
  }

  if (wizardInput) {
    wizardInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchTmdbWizard();
      }
    };
  }

  if (btnSearchTmdb) {
    btnSearchTmdb.onclick = previewTMDBMetadata;
  }

  if (importForm) {
    importForm.onsubmit = handleFormSubmit;
  }

  loadExistingShowsIntoSelector(showSelector);
}

async function loadExistingShowsIntoSelector(showSelector) {
  if (!showSelector) return;
  try {
    const res = await fetch('/api/shows', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const shows = data.shows || (Array.isArray(data) ? data : []);

    showSelector.innerHTML = '<option value="new">-- Crear Nueva Serie / Película --</option>';
    shows.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.title} (${s.media_type === 'movie' ? 'Película' : 'Anime'})`;
      opt.dataset.title = s.title;
      opt.dataset.type = s.media_type || 'anime';
      opt.dataset.tmdbId = s.tmdb_id || '';
      showSelector.appendChild(opt);
    });

    showSelector.onchange = () => {
      const selected = showSelector.options[showSelector.selectedIndex];
      const titleInput = document.getElementById('import-title');
      const typeInput = document.getElementById('import-type');
      const tmdbInput = document.getElementById('import-tmdb');
      const newFields = document.getElementById('import-new-show-fields');

      if (showSelector.value === 'new') {
        if (titleInput) titleInput.value = '';
        if (tmdbInput) tmdbInput.value = '';
        if (newFields) newFields.style.display = 'block';
      } else {
        if (titleInput) titleInput.value = selected.dataset.title || '';
        if (typeInput) typeInput.value = selected.dataset.type || 'anime';
        if (tmdbInput) tmdbInput.value = selected.dataset.tmdbId || '';
        if (newFields) newFields.style.display = 'none';
        if (selected.dataset.title) previewTMDBMetadata();
      }
    };
  } catch {
    // Ignore error loading shows
  }
}

function handleFilesSelected(e) {
  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;

  stagedFiles = files.map((file, idx) => {
    const meta = parseEpisodeFilename(file.name, idx + 1);
    return {
      file,
      name: file.name,
      season: meta.season,
      episode: meta.episode
    };
  });

  updateSelectedFilesUI();
}

function parseEpisodeFilename(filename, defaultEp = 1) {
  let season = 1;
  let episode = defaultEp;

  // Regex S01E02 or Season 1 Episode 2
  const sPattern = /(?:s|season\s*)(\d+)[._\s-]*(?:e|episode\s*|ep\s*)(\d+)/i;
  const m1 = filename.match(sPattern);
  if (m1) {
    season = parseInt(m1[1], 10);
    episode = parseInt(m1[2], 10);
    return { season, episode };
  }

  // Regex E02 or EP 02 or #02
  const ePattern = /(?:e|episode\s*|ep\s*|#\s*)(\d+)/i;
  const m2 = filename.match(ePattern);
  if (m2) {
    episode = parseInt(m2[1], 10);
    return { season, episode };
  }

  return { season, episode };
}

function updateSelectedFilesUI() {
  const label = document.getElementById('selected-file-label');
  const container = document.getElementById('bulk-files-container');
  const countBadge = document.getElementById('bulk-file-count');
  const listEl = document.getElementById('bulk-files-list');

  if (stagedFiles.length === 0) {
    if (label) label.textContent = 'Ningún archivo seleccionado';
    if (container) container.style.display = 'none';
    return;
  }

  if (label) {
    label.textContent = stagedFiles.length === 1
      ? stagedFiles[0].name
      : `${stagedFiles.length} archivos seleccionados`;
  }

  if (container) container.style.display = 'block';
  if (countBadge) countBadge.textContent = `${stagedFiles.length} archivos`;

  if (listEl) {
    listEl.innerHTML = '';
    stagedFiles.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'bulk-file-item';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '10px';
      row.style.padding = '8px 12px';
      row.style.borderBottom = '1px solid rgba(255,255,255,0.06)';

      row.innerHTML = `
        <span style="flex: 1; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.name}">${item.name}</span>
        <label style="font-size: 0.75rem; color: var(--text-muted); display: flex; align-items: center; gap: 4px;">
          T: <input type="number" min="1" value="${item.season}" style="width: 50px; padding: 2px 4px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1); background: #0c0f17; color: #fff;" data-idx="${idx}" class="bulk-season-input">
        </label>
        <label style="font-size: 0.75rem; color: var(--text-muted); display: flex; align-items: center; gap: 4px;">
          Cap: <input type="number" min="1" value="${item.episode}" style="width: 55px; padding: 2px 4px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1); background: #0c0f17; color: #fff;" data-idx="${idx}" class="bulk-episode-input">
        </label>
        <button type="button" style="background: none; border: none; color: #ff5555; cursor: pointer; padding: 4px;" data-idx="${idx}" class="bulk-remove-btn">&times;</button>
      `;

      listEl.appendChild(row);
    });

    listEl.querySelectorAll('.bulk-season-input').forEach(inp => {
      inp.onchange = (e) => {
        const i = parseInt(e.target.dataset.idx, 10);
        stagedFiles[i].season = parseInt(e.target.value, 10) || 1;
      };
    });

    listEl.querySelectorAll('.bulk-episode-input').forEach(inp => {
      inp.onchange = (e) => {
        const i = parseInt(e.target.dataset.idx, 10);
        stagedFiles[i].episode = parseInt(e.target.value, 10) || 1;
      };
    });

    listEl.querySelectorAll('.bulk-remove-btn').forEach(btn => {
      btn.onclick = (e) => {
        const i = parseInt(e.target.dataset.idx, 10);
        stagedFiles.splice(i, 1);
        updateSelectedFilesUI();
      };
    });
  }
}

export async function searchTmdbWizard() {
  const input = document.getElementById('tmdb-wizard-input');
  const typeSelect = document.getElementById('tmdb-wizard-type');
  const resultsContainer = document.getElementById('tmdb-wizard-results');

  const query = input?.value.trim();
  const type = typeSelect?.value || 'anime';

  if (!query) {
    alert('Ingresa el título a buscar en TMDB');
    return;
  }

  if (resultsContainer) {
    resultsContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);"><div class="spinner" style="width: 24px; height: 24px; margin: 0 auto 10px;"></div>Buscando en TMDB...</div>';
  }

  try {
    const res = await fetch(`/api/admin/search-tmdb?q=${encodeURIComponent(query)}&type=${type}`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('Error al consultar TMDB');
    const data = await res.json();
    const results = Array.isArray(data) ? data : (data.results || []);

    if (results.length === 0) {
      if (resultsContainer) {
        resultsContainer.innerHTML = '<div style="padding: 15px; color: var(--text-muted); text-align: center;">No se encontraron resultados en TMDB.</div>';
      }
      return;
    }

    if (resultsContainer) {
      resultsContainer.innerHTML = '';
      results.slice(0, 6).forEach(item => {
        const card = document.createElement('div');
        card.className = 'tmdb-wizard-card';
        card.style.display = 'flex';
        card.style.gap = '12px';
        card.style.padding = '10px';
        card.style.background = 'rgba(255,255,255,0.03)';
        card.style.borderRadius = '8px';
        card.style.marginBottom = '10px';
        card.style.cursor = 'pointer';
        card.style.alignItems = 'center';

        const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w200${item.poster_path}` : '/api/placeholder-poster';
        const title = item.title || item.name || 'Sin título';
        const year = item.year || (item.first_air_date ? item.first_air_date.substring(0, 4) : (item.release_date ? item.release_date.substring(0, 4) : ''));

        card.innerHTML = `
          <img src="${posterUrl}" style="width: 50px; height: 75px; object-fit: cover; border-radius: 4px;" onerror="this.src='/api/placeholder-poster'">
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600; color: #fff; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">${year ? year + ' · ' : ''}ID: ${item.id}</div>
            <p style="font-size: 0.78rem; color: var(--text-muted); margin: 4px 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.overview || ''}</p>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" style="flex-shrink: 0;">Seleccionar</button>
        `;

        card.onclick = () => selectTmdbWizardItem(item, type);
        resultsContainer.appendChild(card);
      });
    }
  } catch (err) {
    if (resultsContainer) {
      resultsContainer.innerHTML = `<div style="padding: 15px; color: #ff5555; text-align: center;">Error: ${err.message}</div>`;
    }
  }
}

function selectTmdbWizardItem(item, type) {
  const titleInput = document.getElementById('import-title');
  const tmdbInput = document.getElementById('import-tmdb');
  const typeSelect = document.getElementById('import-type');
  const title = item.title || item.name || '';

  if (titleInput) titleInput.value = title;
  if (tmdbInput) tmdbInput.value = item.id;
  if (typeSelect) typeSelect.value = type;

  const resultsContainer = document.getElementById('tmdb-wizard-results');
  if (resultsContainer) resultsContainer.innerHTML = '';

  previewTMDBMetadata();
}

export async function previewTMDBMetadata() {
  const titleVal = document.getElementById('import-title')?.value.trim();
  const typeVal = document.getElementById('import-type')?.value || 'anime';
  const tmdbIdVal = document.getElementById('import-tmdb')?.value.trim();
  const previewPlaceholder = document.getElementById('tmdb-preview-placeholder');
  const previewContent = document.getElementById('tmdb-preview-content');

  if (!titleVal && !tmdbIdVal) {
    return;
  }

  if (previewPlaceholder) previewPlaceholder.style.display = 'none';
  if (previewContent) previewContent.style.display = 'block';

  try {
    const queryParam = tmdbIdVal ? `tmdb_id=${encodeURIComponent(tmdbIdVal)}&type=${typeVal}` : `q=${encodeURIComponent(titleVal)}&type=${typeVal}`;
    const res = await fetch(`/api/admin/preview-tmdb?${queryParam}`, { headers: getAuthHeaders() });
    const data = await res.json();

    if (res.ok && data.success && data.details) {
      const d = data.details;
      const bDrop = document.getElementById('preview-backdrop');
      const pPoster = document.getElementById('preview-poster');
      const pTitle = document.getElementById('preview-title');
      const pYear = document.getElementById('preview-year-val');
      const pRating = document.getElementById('preview-rating-val');
      const pOverview = document.getElementById('preview-overview');

      if (bDrop) bDrop.src = d.backdrop_path || d.poster_path || '';
      if (pPoster) pPoster.src = d.poster_path || '/api/placeholder-poster';
      if (pTitle) pTitle.textContent = d.title || '--';
      if (pYear) pYear.textContent = d.year || '--';
      if (pRating) pRating.innerHTML = `<i data-lucide="star"></i> ${d.rating ? d.rating.toFixed(1) : '0.0'}`;
      if (pOverview) pOverview.textContent = d.synopsis || d.overview || 'Sin descripción disponible.';

      if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
      }
    }
  } catch {
    // Ignore preview error
  }
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const titleVal = document.getElementById('import-title')?.value.trim();
  const typeVal = document.getElementById('import-type')?.value || 'anime';
  const tmdbIdVal = document.getElementById('import-tmdb')?.value.trim();
  const introStartVal = document.getElementById('import-intro-start')?.value.trim();
  const filePathVal = document.getElementById('import-filepath')?.value.trim();

  if (!titleVal) {
    alert('Ingresa el título de la serie o película');
    return;
  }

  if (stagedFiles.length === 0 && !filePathVal) {
    alert('Por favor selecciona al menos un archivo de video o especifica una ruta local');
    return;
  }

  const statusBox = document.getElementById('import-status');
  const batchLabel = document.getElementById('import-batch-label');
  const percentLabel = document.getElementById('import-progress-percent');
  const fillBar = document.getElementById('upload-progress-fill');
  const statusText = document.getElementById('import-status-text');
  const progressStats = document.getElementById('import-progress-stats');
  const submitBtn = document.getElementById('import-submit-btn');

  if (statusBox) statusBox.style.display = 'block';
  if (submitBtn) submitBtn.disabled = true;

  try {
    if (stagedFiles.length > 0) {
      const totalFiles = stagedFiles.length;
      for (let i = 0; i < totalFiles; i++) {
        const item = stagedFiles[i];
        if (batchLabel) batchLabel.textContent = `Procesando ${i + 1} de ${totalFiles}: ${item.name}`;

        const formData = new FormData();
        formData.append('videoFile', item.file);
        formData.append('title', titleVal);
        formData.append('mediaType', typeVal);
        formData.append('seasonNumber', item.season);
        formData.append('episodeNumber', item.episode);
        if (tmdbIdVal) formData.append('tmdbId', tmdbIdVal);
        if (introStartVal) formData.append('introStart', introStartVal);

        await uploadWithProgress(formData, {
          onProgress: (pct, loadedMB, totalMB) => {
            if (percentLabel) percentLabel.textContent = `${pct}%`;
            if (fillBar) fillBar.style.width = `${pct}%`;
            if (progressStats) progressStats.textContent = `${loadedMB} MB / ${totalMB} MB`;
            if (statusText) statusText.textContent = pct < 100 ? 'Subiendo vídeo...' : 'Analizando con FFprobe...';
          },
          onComplete: () => {
            if (statusText) statusText.textContent = 'Añadiendo al catálogo...';
          }
        });
      }
    } else if (filePathVal) {
      if (batchLabel) batchLabel.textContent = `Importando desde ruta: ${filePathVal}`;
      const seasonVal = document.getElementById('import-season')?.value || 1;
      const epVal = document.getElementById('import-episode')?.value || 1;

      const formData = new FormData();
      formData.append('sourcePath', filePathVal);
      formData.append('title', titleVal);
      formData.append('mediaType', typeVal);
      formData.append('seasonNumber', seasonVal);
      formData.append('episodeNumber', epVal);
      if (tmdbIdVal) formData.append('tmdbId', tmdbIdVal);
      if (introStartVal) formData.append('introStart', introStartVal);

      if (statusText) statusText.textContent = 'Importando y analizando con FFprobe...';
      await uploadWithProgress(formData, {
        onProgress: (pct) => {
          if (percentLabel) percentLabel.textContent = `${pct}%`;
          if (fillBar) fillBar.style.width = `${pct}%`;
        },
        onComplete: () => {
          if (statusText) statusText.textContent = 'Añadiendo al catálogo...';
        }
      });
    }

    if (batchLabel) batchLabel.textContent = '¡Importación completada con éxito!';
    if (statusText) statusText.textContent = 'Organizado y añadido a la biblioteca.';
    alert('¡Importación completada con éxito!');

    stagedFiles = [];
    const fileInput = document.getElementById('import-file');
    if (fileInput) fileInput.value = '';
    updateSelectedFilesUI();
  } catch (err) {
    if (statusText) statusText.textContent = `Error: ${err.message}`;
    alert(`Error al importar: ${err.message}`);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function uploadWithProgress(formData, callbacks) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/import', true);

    const headers = getAuthHeaders();
    Object.keys(headers).forEach(k => {
      if (k.toLowerCase() !== 'content-type') {
        xhr.setRequestHeader(k, headers[k]);
      }
    });

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && callbacks.onProgress) {
        const pct = Math.round((e.loaded / e.total) * 100);
        const loadedMB = (e.loaded / (1024 * 1024)).toFixed(1);
        const totalMB = (e.total / (1024 * 1024)).toFixed(1);
        callbacks.onProgress(pct, loadedMB, totalMB);
      }
    };

    xhr.onload = () => {
      if (callbacks.onComplete) callbacks.onComplete();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const resp = JSON.parse(xhr.responseText);
          resolve(resp);
        } catch {
          resolve({ success: true });
        }
      } else {
        try {
          const errResp = JSON.parse(xhr.responseText);
          reject(new Error(errResp.error || `HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Fallo de red'));
    xhr.send(formData);
  });
}
