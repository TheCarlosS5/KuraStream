/**
 * KuraStream - Admin Import Module
 * Handles local folder import, scanner triggers, and TMDB preview metadata matching.
 */

import { getAuthHeaders } from './auth.js';

export function initImportForm() {
  const btnScan = document.getElementById('btn-scan-library');
  const btnSearchTmdb = document.getElementById('btn-search-tmdb');
  const btnSubmitImport = document.getElementById('btn-submit-import');

  if (btnScan) {
    btnScan.onclick = executeFolderScan;
  }
  if (btnSearchTmdb) {
    btnSearchTmdb.onclick = previewTMDBMetadata;
  }
  if (btnSubmitImport) {
    btnSubmitImport.onclick = submitShowImport;
  }
}

export async function executeFolderScan() {
  const btn = document.getElementById('btn-scan-library');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/admin/scan', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    if (res.ok) {
      alert('¡Escaneo completo de la librería iniciado con éxito!');
    } else {
      alert('Error al iniciar el escaneo.');
    }
  } catch (err) {
    alert('Error de conexión: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function previewTMDBMetadata() {
  const titleVal = document.getElementById('import-title')?.value.trim();
  const typeVal = document.getElementById('import-type')?.value || 'anime';
  const tmdbIdVal = document.getElementById('import-tmdb')?.value.trim();
  const previewPlaceholder = document.getElementById('tmdb-preview-placeholder');
  const previewContent = document.getElementById('tmdb-preview-content');

  if (!titleVal && !tmdbIdVal) {
    alert('Por favor, escribe un título o ID de TMDB primero.');
    return;
  }

  if (previewPlaceholder) previewPlaceholder.style.display = 'none';
  if (previewContent) {
    previewContent.style.display = 'block';
    previewContent.innerHTML = `<div style="text-align: center; padding: 30px;"><div class="spinner" style="width: 24px; height: 24px;"></div><p style="margin-top: 10px; color: var(--text-muted);">Consultando TMDB...</p></div>`;
  }

  try {
    const queryParam = tmdbIdVal ? `tmdb_id=${encodeURIComponent(tmdbIdVal)}` : `q=${encodeURIComponent(titleVal)}&type=${typeVal}`;
    const res = await fetch(`/api/admin/preview-tmdb?${queryParam}`, { headers: getAuthHeaders() });
    const data = await res.json();

    if (res.ok && data.success && data.details) {
      const d = data.details;
      if (previewContent) {
        previewContent.innerHTML = `
          <div style="display: flex; gap: 15px; align-items: flex-start;">
            <img src="${d.poster_path || '/api/placeholder-poster'}" style="width: 90px; height: 130px; object-fit: cover; border-radius: 6px;" onerror="this.src='/api/placeholder-poster'">
            <div>
              <h4 style="margin: 0 0 6px 0; color: var(--text-main); font-size: 1.05rem;">${d.title} (${d.year || 'N/A'})</h4>
              <span class="badge" style="background: rgba(168,85,247,0.15); color: #c084fc; font-size: 0.75rem;">TMDB ID: ${d.id}</span>
              <p style="font-size: 0.82rem; color: var(--text-muted); margin: 8px 0; max-height: 80px; overflow-y: auto;">${d.synopsis || 'Sin descripción disponible.'}</p>
            </div>
          </div>
        `;
      }
    } else {
      if (previewContent) {
        previewContent.innerHTML = `<p style="color: #ff5555; padding: 20px;">No se encontraron resultados en TMDB.</p>`;
      }
    }
  } catch (err) {
    if (previewContent) {
      previewContent.innerHTML = `<p style="color: #ff5555; padding: 20px;">Error al conectar con TMDB: ${err.message}</p>`;
    }
  }
}

export async function submitShowImport() {
  const titleVal = document.getElementById('import-title')?.value.trim();
  const typeVal = document.getElementById('import-type')?.value || 'anime';
  const tmdbIdVal = document.getElementById('import-tmdb')?.value.trim();
  const ageRatingVal = document.getElementById('import-age-rating')?.value || 'TV-14';

  if (!titleVal && !tmdbIdVal) {
    alert('Por favor, ingresa el título o ID de TMDB.');
    return;
  }

  try {
    const res = await fetch('/api/admin/import-show', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        title: titleVal,
        media_type: typeVal,
        tmdb_id: tmdbIdVal,
        age_rating: ageRatingVal
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert('¡Importación completada e incorporada a la biblioteca!');
    } else {
      alert('Error en importación: ' + (data.error || 'Desconocido'));
    }
  } catch (err) {
    alert('Error de red: ' + err.message);
  }
}
