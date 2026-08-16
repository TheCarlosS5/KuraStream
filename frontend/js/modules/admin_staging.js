/**
 * KuraStream - Admin Staging Area (Por Organizar) Module
 * Handles loading staged downloads, editing clean metadata, publishing, and deletion.
 */

import { getAuthHeaders, openAdminLoginModal } from './auth.js';

export async function loadStagedImports() {
  const container = document.getElementById('staging-items-list');
  if (!container) return;

  try {
    const res = await fetch('/api/admin/staged', { headers: getAuthHeaders() });
    if (res.status === 401 || res.status === 403) {
      container.innerHTML = `<div class="admin-card" style="text-align: center; padding: 30px;">
        <p style="color: #ff5555; font-weight: 600; margin-bottom: 12px;">Sesión de administrador caducada o no autorizada.</p>
        <button type="button" class="btn btn-primary" id="btn-reauth-staging" style="padding: 8px 16px;">Iniciar Sesión Administrador</button>
      </div>`;
      const btn = document.getElementById('btn-reauth-staging');
      if (btn) btn.onclick = openAdminLoginModal;
      return;
    }

    if (!res.ok) throw new Error('Error al cargar elementos en preparación.');

    const items = await res.json();
    const countBadge = document.getElementById('staging-counter-badge');
    if (countBadge) {
      if (Array.isArray(items) && items.length > 0) {
        countBadge.textContent = items.length;
        countBadge.style.display = 'inline-block';
      } else {
        countBadge.style.display = 'none';
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      container.innerHTML = `<div class="admin-card" style="text-align: center; padding: 40px 20px;">
        <i data-lucide="check-circle-2" style="width: 48px; height: 48px; color: #00e08f; margin-bottom: 12px; display: inline-block;"></i>
        <h4 style="margin: 0 0 6px 0; font-family: var(--font-title); font-size: 1.1rem;">¡Todo al día!</h4>
        <p style="color: var(--text-muted); margin: 0; font-size: 0.88rem;">No hay descargas o archivos pendientes de revisión en la bandeja de entrada.</p>
      </div>`;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="admin-card" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 16px; border-radius: 8px; margin-bottom: 10px;">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 280px;">
            <span class="badge" style="background: rgba(168,85,247,0.15); color: #c084fc; font-size: 0.75rem; margin-bottom: 6px; display: inline-block;">${item.source_info || 'Descarga Torrents'}</span>
            <h4 style="margin: 4px 0 8px 0; font-size: 1rem; color: var(--text-main); word-break: break-all;">${item.raw_title}</h4>
            <small style="color: var(--text-muted); font-size: 0.78rem; display: block; word-break: break-all;">Ruta física: ${item.file_path}</small>
            
            <div style="display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap;">
              <div style="flex: 2; min-width: 200px;">
                <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 4px;">Nombre Limpio para Catálogo:</label>
                <input type="text" id="stage-title-${item.id}" value="${item.clean_title || ''}" class="form-control" style="font-size: 0.85rem; padding: 6px 10px;">
              </div>
              <div style="flex: 1; min-width: 80px;">
                <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 4px;">Temp:</label>
                <input type="number" id="stage-season-${item.id}" value="${item.season || 1}" class="form-control" style="font-size: 0.85rem; padding: 6px 10px;">
              </div>
              <div style="flex: 1; min-width: 80px;">
                <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 4px;">Cap:</label>
                <input type="number" id="stage-episode-${item.id}" value="${item.episode || 1}" class="form-control" style="font-size: 0.85rem; padding: 6px 10px;">
              </div>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px; align-self: center;">
            <button type="button" class="btn btn-primary btn-publish-staged" data-id="${item.id}" style="padding: 8px 16px; font-size: 0.82rem; gap: 6px; display: inline-flex; align-items: center; font-weight: 700;">
              <i data-lucide="check" style="width: 14px; height: 14px;"></i> Publicar al Catálogo
            </button>
            <button type="button" class="btn btn-secondary btn-delete-staged" data-id="${item.id}" style="padding: 6px 12px; font-size: 0.8rem; color: #ff5555; background: rgba(255,85,85,0.1); border: 1px solid rgba(255,85,85,0.2); gap: 6px; display: inline-flex; align-items: center;">
              <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i> Eliminar
            </button>
          </div>
        </div>
      </div>
    `).join('');

    if (window.lucide) window.lucide.createIcons({ root: container });

    container.querySelectorAll('.btn-publish-staged').forEach(btn => {
      btn.addEventListener('click', () => publishStagedItem(btn.dataset.id));
    });
    container.querySelectorAll('.btn-delete-staged').forEach(btn => {
      btn.addEventListener('click', () => deleteStagedItem(btn.dataset.id));
    });

  } catch (e) {
    console.error(e);
    container.innerHTML = `<p style="color: #ff5555; padding: 20px;">Error al cargar elementos: ${e.message}</p>`;
  }
}

export async function publishStagedItem(id) {
  const cleanTitleEl = document.getElementById(`stage-title-${id}`);
  const seasonEl = document.getElementById(`stage-season-${id}`);
  const episodeEl = document.getElementById(`stage-episode-${id}`);

  const cleanTitle = cleanTitleEl ? cleanTitleEl.value.trim() : '';
  const season = seasonEl ? parseInt(seasonEl.value, 10) : 1;
  const episode = episodeEl ? parseInt(episodeEl.value, 10) : 1;

  if (!cleanTitle) {
    alert('Por favor, indica un nombre limpio para el anime o película.');
    return;
  }

  try {
    const res = await fetch(`/api/admin/staged/${id}/publish`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ clean_title: cleanTitle, season, episode })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert('¡Publicado con éxito al catálogo público!');
      loadStagedImports();
    } else {
      alert('Error al publicar: ' + (data.error || 'Desconocido'));
    }
  } catch (err) {
    alert('Error de conexión: ' + err.message);
  }
}

export async function deleteStagedItem(id) {
  if (!confirm('¿Seguro que deseas eliminar este archivo descargado de Por Organizar? Se borrará físicamente.')) return;

  try {
    const res = await fetch(`/api/admin/staged/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert('Eliminado de Por Organizar.');
      loadStagedImports();
    } else {
      alert('Error al eliminar: ' + (data.error || 'Desconocido'));
    }
  } catch (err) {
    alert('Error de conexión: ' + err.message);
  }
}
