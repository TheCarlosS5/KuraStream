/**
 * KuraStream - Admin Library Module
 * Handles show management grid, title renaming, cover scraping, and show deletion.
 */

import { getAuthHeaders, openAdminLoginModal } from './auth.js';

export async function loadAdminPanel() {
  const showsList = document.getElementById('admin-shows-list');
  if (!showsList) return;

  try {
    const res = await fetch('/api/shows');
    const shows = await res.json();

    if (!Array.isArray(shows) || shows.length === 0) {
      showsList.innerHTML = `<p style="color: var(--text-muted); padding: 20px;">No hay contenido en la biblioteca actualmente.</p>`;
      return;
    }

    showsList.innerHTML = shows.map(show => `
      <div class="admin-show-card" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; margin-bottom: 8px;">
        <div style="display: flex; align-items: center; gap: 12px; overflow: hidden; max-width: 70%;">
          <img src="${show.poster_path || '/api/placeholder-poster'}" style="width: 44px; height: 60px; object-fit: cover; border-radius: 4px; background: #000;" onerror="this.src='/api/placeholder-poster'">
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            <h4 style="margin: 0; font-size: 0.95rem; color: var(--text-main); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${show.title}">${show.title}</h4>
            <small style="color: var(--text-muted); font-size: 0.78rem;">${show.media_type === 'movie' ? 'Película' : 'Anime'} · Año ${show.year || 'N/A'} · Clasificación: ${show.age_rating || 'TV-14'}</small>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
          <button type="button" class="btn btn-secondary btn-edit-media" data-id="${show.id}" style="padding: 6px 12px; font-size: 0.78rem;">
            <i data-lucide="edit" style="width: 13px; height: 13px;"></i> Editar
          </button>
          <button type="button" class="btn btn-danger-small btn-delete-show" data-id="${show.id}" data-title="${show.title.replace(/"/g, '&quot;')}" style="padding: 6px 12px; font-size: 0.78rem; background: rgba(255,85,85,0.12); color: #ff5555; border: 1px solid rgba(255,85,85,0.3);">
            <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i> Eliminar
          </button>
        </div>
      </div>
    `).join('');

    if (window.lucide) window.lucide.createIcons({ root: showsList });

    showsList.querySelectorAll('.btn-edit-media').forEach(btn => {
      btn.onclick = () => openMediaEditor(btn.dataset.id);
    });
    showsList.querySelectorAll('.btn-delete-show').forEach(btn => {
      btn.onclick = () => deleteShow(btn.dataset.id, btn.dataset.title);
    });

  } catch (err) {
    console.error('[Admin Library] Load shows error:', err);
    showsList.innerHTML = `<p style="color: #ff5555;">Error al cargar la biblioteca.</p>`;
  }
}

export async function openMediaEditor(showId) {
  const modal = document.getElementById('media-edit-modal-overlay');
  const showIdInput = document.getElementById('edit-show-id');
  const showTitleInput = document.getElementById('edit-show-title-input');
  const showAgeRatingSelect = document.getElementById('edit-show-age-rating');

  if (!modal || !showId) return;

  try {
    const res = await fetch(`/api/shows/${showId}`);
    if (!res.ok) {
      alert('Anime o película no encontrada.');
      return;
    }
    const data = await res.json();
    const show = data.show || data;

    if (showIdInput) showIdInput.value = show.id;
    if (showTitleInput) showTitleInput.value = show.title || '';
    if (showAgeRatingSelect) showAgeRatingSelect.value = show.age_rating || 'TV-14';

    modal.style.display = 'flex';
  } catch (err) {
    console.error(err);
    alert('Error al obtener información del anime.');
  }
}

export async function updateShowTitle(showId, newTitle) {
  if (!showId || !newTitle.trim()) {
    alert('Por favor, indica un nuevo nombre válido.');
    return;
  }

  try {
    const res = await fetch('/api/admin/update-show-title', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ showId, newTitle: newTitle.trim() })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      alert('¡Nombre y carpeta actualizados con éxito!');
      const modal = document.getElementById('media-edit-modal-overlay');
      if (modal) modal.style.display = 'none';
      loadAdminPanel();
    } else {
      alert('Error al renombrar: ' + (data.error || 'Desconocido'));
    }
  } catch (err) {
    alert('Error de conexión: ' + err.message);
  }
}

export async function scrapeShowCover(showId, currentTitle) {
  if (!showId) return;
  const defaultQuery = currentTitle || showId.replace(/_/g, ' ');
  const query = prompt("Escribe el nombre del anime/película para buscar la carátula oficial en HD (TMDB):", defaultQuery);
  if (query === null) return;

  try {
    const res = await fetch('/api/admin/scrape-show-cover', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ showId, query: query.trim() || defaultQuery })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert('¡Carátula HD y metadatos actualizados con éxito!');
      if (typeof window.loadAdminLibraryList === 'function') {
        window.loadAdminLibraryList();
      } else if (typeof loadAdminPanel === 'function') {
        loadAdminPanel();
      }
    } else {
      alert('Error al consultar TMDB: ' + (data.error || data.message || 'No se encontró carátula'));
    }
  } catch (err) {
    alert('Error al consultar TMDB: ' + err.message);
  }
}

export async function deleteShow(id, title) {
  if (!confirm(`¿Estás seguro de que quieres eliminar "${title}" de la biblioteca? Esto borrará físicamente todos sus archivos del servidor.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/shows/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      alert('Eliminado con éxito.');
      loadAdminPanel();
    } else {
      alert('Error al eliminar: ' + (data.error || data.message || 'Error de autorización'));
    }
  } catch (err) {
    console.error(err);
    alert('Error de conexión.');
  }
}
