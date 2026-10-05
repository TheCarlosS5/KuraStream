/**
 * KuraStream - Admin Library Module
 * Handles show management grid, title renaming, cover scraping, and show deletion.
 */

import { getAuthHeaders } from './auth.js';
import { escapeHtml, escapeHtmlAttribute } from '../core/ui.js';

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

    showsList.innerHTML = shows.map(show => {
      const st = show.status || 'finished';
      let stClass = 'finished';
      let stLabel = 'Finalizado';
      if (st === 'airing') {
        stClass = 'airing';
        stLabel = 'En emisión';
      } else if (st === 'upcoming') {
        stClass = 'upcoming';
        stLabel = 'Próximamente';
      }

      return `
        <div class="admin-show-card" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; margin-bottom: 8px; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 12px; overflow: hidden; max-width: 60%;">
            <img src="${escapeHtmlAttribute(show.poster_path || '/api/placeholder-poster')}" style="width: 44px; height: 60px; object-fit: cover; border-radius: 4px; background: #000;" onerror="this.src='/api/placeholder-poster'">
            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <h4 style="margin: 0; font-size: 0.95rem; color: var(--text-main); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${escapeHtmlAttribute(show.title)}">${escapeHtml(show.title)}</h4>
              <small style="color: var(--text-muted); font-size: 0.78rem;">${show.media_type === 'movie' ? 'Película' : 'Anime'} · Año ${escapeHtml(String(show.year || 'N/A'))} · Clasificación: ${escapeHtml(show.age_rating || 'TV-14')}</small>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0; flex-wrap: wrap;">
            <button type="button" class="btn-status-toggle ${stClass}" data-id="${escapeHtmlAttribute(show.id)}" data-status="${escapeHtmlAttribute(st)}" title="Clic para cambiar estado">${stLabel}</button>
            <button type="button" class="btn btn-secondary btn-edit-media" data-id="${escapeHtmlAttribute(show.id)}" style="padding: 6px 12px; font-size: 0.78rem;">
              <i data-lucide="edit" style="width: 13px; height: 13px;"></i> Editar
            </button>
            <button type="button" class="btn btn-danger-small btn-delete-show" data-id="${escapeHtmlAttribute(show.id)}" data-title="${escapeHtmlAttribute(show.title)}" style="padding: 6px 12px; font-size: 0.78rem; background: rgba(255,85,85,0.12); color: #ff5555; border: 1px solid rgba(255,85,85,0.3);">
              <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i> Eliminar
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons({ root: showsList });

    window.openMediaEditor = openMediaEditor;
    window.toggleShowStatus = toggleShowStatus;
    window.deleteShow = deleteShow;

    showsList.querySelectorAll('.btn-status-toggle').forEach(btn => {
      btn.onclick = () => toggleShowStatus(btn.dataset.id, btn.dataset.status);
    });
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
    const res = await fetch(`/api/shows/${encodeURIComponent(showId)}`);
    if (!res.ok) {
      alert('Anime o película no encontrada.');
      return;
    }
    const data = await res.json();
    const show = data.show || data;

    if (showIdInput) showIdInput.value = show.id;
    if (showTitleInput) showTitleInput.value = show.title || '';
    if (showAgeRatingSelect) showAgeRatingSelect.value = show.age_rating || 'TV-14';
    const statusSelect = document.getElementById('edit-show-status-select');
    if (statusSelect) statusSelect.value = ['airing', 'upcoming', 'finished'].includes(show.status) ? show.status : 'finished';

    wireImageDropZone('poster-drop-zone', 'poster-file-input', 'poster', show.id);
    wireImageDropZone('backdrop-drop-zone', 'backdrop-file-input', 'backdrop', show.id);

    const syncEpisodesBtn = document.getElementById('btn-sync-episodes-tmdb');
    if (syncEpisodesBtn) {
      syncEpisodesBtn.onclick = async () => {
        syncEpisodesBtn.disabled = true;
        try {
          const res = await fetch(`/api/admin/shows/${encodeURIComponent(show.id)}/sync-episodes-tmdb`, {
            method: 'POST',
            headers: getAuthHeaders()
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.success !== false) {
            alert('Títulos y sinopsis de capítulos sincronizados con TMDB.');
            openMediaEditor(show.id);
          } else {
            alert('Error al sincronizar: ' + (data.error || res.status));
          }
        } catch (err) {
          alert('Error de red: ' + err.message);
        } finally {
          syncEpisodesBtn.disabled = false;
        }
      };
    }

    renderShowLoops(show);
    const episodes = Array.isArray(data.episodes) ? data.episodes : (Array.isArray(show.episodes) ? show.episodes : []);
    renderEpisodesTimings(show, episodes);

    const loopDropZone = document.getElementById('loop-drop-zone');
    const loopFileInput = document.getElementById('loop-file-input');
    const editMediaClose = document.getElementById('edit-media-close');

    if (editMediaClose) {
      editMediaClose.onclick = () => {
        modal.style.display = 'none';
      };
    }

    if (loopDropZone && loopFileInput) {
      loopDropZone.onclick = () => loopFileInput.click();

      loopFileInput.onchange = async () => {
        if (!loopFileInput.files || loopFileInput.files.length === 0) return;
        const file = loopFileInput.files[0];
        await uploadBackdropLoop(show.id, file);
        loopFileInput.value = '';
      };

      loopDropZone.ondragover = (e) => {
        e.preventDefault();
        loopDropZone.classList.add('dragover');
      };
      loopDropZone.ondragleave = () => {
        loopDropZone.classList.remove('dragover');
      };
      loopDropZone.ondrop = async (e) => {
        e.preventDefault();
        loopDropZone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          await uploadBackdropLoop(show.id, e.dataTransfer.files[0]);
        }
      };
    }

    modal.style.display = 'flex';
  } catch (err) {
    console.error(err);
    alert('Error al obtener información del anime.');
  }
}

function renderShowLoops(show) {
  const loopsList = document.getElementById('edit-show-loops-list');
  if (!loopsList) return;

  let loops = [];
  if (Array.isArray(show.backdrop_loops)) {
    loops = show.backdrop_loops;
  } else if (typeof show.backdrop_loops === 'string') {
    try { loops = JSON.parse(show.backdrop_loops); } catch { loops = []; }
  }

  if (loops.length === 0) {
    loopsList.innerHTML = '<p class="text-muted" style="padding: 10px 0; font-size: 0.85rem;">No hay clips de video configurados.</p>';
    return;
  }

  loopsList.innerHTML = loops.map(url => `
    <div class="loop-item" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; background: rgba(255,255,255,0.04); border-radius: 6px; margin-bottom: 6px;">
      <span style="font-size: 0.82rem; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%;">${url}</span>
      <button type="button" class="btn btn-sm btn-danger-small btn-delete-loop" data-url="${url}" style="padding: 3px 8px; font-size: 0.75rem; background: rgba(255,85,85,0.15); color: #ff5555; border: 1px solid rgba(255,85,85,0.3); border-radius: 4px; cursor: pointer;">Eliminar</button>
    </div>
  `).join('');

  loopsList.querySelectorAll('.btn-delete-loop').forEach(btn => {
    btn.onclick = async () => {
      const url = btn.dataset.url;
      try {
        const res = await fetch('/api/admin/delete-backdrop-loop', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ showId: show.id, loopUrl: url })
        });
        if (res.ok) {
          show.backdrop_loops = loops.filter(u => u !== url);
          renderShowLoops(show);
        } else {
          alert('Error al eliminar el clip de fondo.');
        }
      } catch (err) {
        alert('Error de red: ' + err.message);
      }
    };
  });
}

async function uploadBackdropLoop(showId, file) {
  const formData = new FormData();
  formData.append('showId', showId);
  formData.append('video', file);

  const headers = getAuthHeaders();
  delete headers['Content-Type'];

  try {
    const res = await fetch('/api/admin/upload-backdrop-loop', {
      method: 'POST',
      headers,
      body: formData
    });
    if (res.ok) {
      alert('¡Clip de video de fondo subido con éxito!');
      openMediaEditor(showId);
    } else {
      const err = await res.json().catch(() => ({}));
      alert('Error al subir video: ' + (err.error || 'Desconocido'));
    }
  } catch (err) {
    alert('Error de red: ' + err.message);
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

export async function toggleShowStatus(showId, currentStatus) {
  if (!showId) return;
  const nextStatus = currentStatus === 'airing' ? 'finished' : (currentStatus === 'upcoming' ? 'airing' : 'upcoming');
  if (await setShowStatus(showId, nextStatus)) loadAdminPanel();
}

async function setShowStatus(showId, status) {
  try {
    const res = await fetch('/api/admin/toggle-show-status', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ showId, status })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert('Error al cambiar el estado: ' + (err.error || res.status));
      return false;
    }
    return true;
  } catch (err) {
    alert('Error de red: ' + err.message);
    return false;
  }
}

/** "Guardar Nombre y Estado": the status select used to be ignored. */
export async function saveShowTitleAndStatus(showId, newTitle, status) {
  if (!showId || !newTitle.trim()) {
    alert('Por favor, indica un nombre válido.');
    return;
  }
  try {
    const res = await fetch('/api/admin/update-show-title', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ showId, newTitle: newTitle.trim() })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert('Error al renombrar: ' + (data.error || 'Desconocido'));
      return;
    }
  } catch (err) {
    alert('Error de conexión: ' + err.message);
    return;
  }
  if (status && !(await setShowStatus(showId, status))) return;
  alert('¡Nombre y estado guardados!');
  const modal = document.getElementById('media-edit-modal-overlay');
  if (modal) modal.style.display = 'none';
  loadAdminPanel();
}

/** Poster / backdrop drop zones of the media editor (uploads go to /api/admin/upload-show-media). */
function wireImageDropZone(zoneId, inputId, field, showId) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  if (!zone || !input) return;
  const upload = async (file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('showId', showId);
    formData.append(field, file);
    const headers = getAuthHeaders();
    delete headers['Content-Type'];
    zone.classList.add('uploading');
    try {
      const res = await fetch('/api/admin/upload-show-media', { method: 'POST', headers, body: formData });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        alert(field === 'poster' ? '¡Póster actualizado!' : '¡Fondo actualizado!');
        loadAdminPanel();
      } else {
        alert('Error al subir la imagen: ' + (data.error || res.status));
      }
    } catch (err) {
      alert('Error de red: ' + err.message);
    } finally {
      zone.classList.remove('uploading');
      input.value = '';
    }
  };
  zone.onclick = () => input.click();
  input.onchange = () => upload(input.files && input.files[0]);
  zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('dragover'); };
  zone.ondragleave = () => zone.classList.remove('dragover');
  zone.ondrop = (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    upload(e.dataTransfer.files && e.dataTransfer.files[0]);
  };
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

const TIMING_SOURCE_LABELS = {
  aniskip: 'AniSkip',
  aniskip_checked: 'AniSkip (verificado por audio)',
  audio: 'Detectado por audio',
  chapters: 'Capítulos del archivo',
  manual: 'Ajuste manual anterior'
};

function formatTimingClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Openings and endings are found automatically (AniSkip, checked and completed with the audio of
 * the files by scripts/audio_intros_from_pc.py), so the editor only shows what each episode has.
 */
export function renderEpisodesTimings(show, episodes) {
  const container = document.getElementById('edit-episodes-thumbs-list');
  if (!container) return;

  if (!episodes || episodes.length === 0) {
    container.innerHTML = '<p class="text-muted" style="padding: 10px 0; font-size: 0.85rem;">No hay episodios registrados para este título.</p>';
    return;
  }

  container.innerHTML = episodes.map(ep => {
    const hasIntro = ep.intro_start !== null && ep.intro_start !== undefined && ep.intro_end !== null && ep.intro_end !== undefined;
    const hasOutro = ep.outro_start !== null && ep.outro_start !== undefined;
    const hasOutroEnd = hasOutro && ep.outro_end !== null && ep.outro_end !== undefined;
    const source = ep.intro_source || (hasIntro ? 'manual' : '');
    const intro = hasIntro
      ? `Intro ${formatTimingClock(ep.intro_start)} – ${formatTimingClock(ep.intro_end)}`
      : 'Sin intro detectada';
    const outroSourceLabel = hasOutro ? (TIMING_SOURCE_LABELS[ep.outro_source || source] || '') : '';
    const scene = hasOutroEnd && Number(ep.duration) - Number(ep.outro_end) >= 30 ? ', escena después' : '';
    const outro = hasOutro
      ? ` · Ending ${formatTimingClock(ep.outro_start)}${hasOutroEnd ? ` – ${formatTimingClock(ep.outro_end)}` : ''}${outroSourceLabel || scene ? ` (${outroSourceLabel}${scene})` : ''}`
      : '';
    const sourceLabel = hasIntro ? (TIMING_SOURCE_LABELS[source] || '') : '';
    const epLabel = `S${ep.season_number ?? 1}E${ep.episode_number ?? 1}: ${ep.title || 'Episodio ' + (ep.episode_number ?? 1)}`;

    return `
      <div class="episode-timing-card" data-ep-id="${escapeHtmlAttribute(ep.id)}" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 10px 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; margin-bottom: 8px;">
        <strong style="color: var(--text-main); font-size: 0.88rem;">${escapeHtml(epLabel)}</strong>
        <span class="timing-summary" style="font-size: 0.8rem; color: ${hasIntro ? 'var(--text-secondary)' : 'var(--text-muted)'};">
          ${escapeHtml(intro + outro)}${sourceLabel ? ` <span class="timing-source" style="color: var(--text-muted);">· ${escapeHtml(sourceLabel)}</span>` : ''}
        </span>
      </div>
    `;
  }).join('');
}
