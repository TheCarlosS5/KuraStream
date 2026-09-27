/**
 * KuraStream - Admin Library Module
 * Handles show management grid, title renaming, cover scraping, and show deletion.
 */

import { getAuthHeaders } from './auth.js';

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
        stLabel = '● En Emisión';
      } else if (st === 'upcoming') {
        stClass = 'upcoming';
        stLabel = '⏳ En Espera';
      }

      return `
        <div class="admin-show-card" style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; margin-bottom: 8px; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 12px; overflow: hidden; max-width: 60%;">
            <img src="${show.poster_path || '/api/placeholder-poster'}" style="width: 44px; height: 60px; object-fit: cover; border-radius: 4px; background: #000;" onerror="this.src='/api/placeholder-poster'">
            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <h4 style="margin: 0; font-size: 0.95rem; color: var(--text-main); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${show.title}">${show.title}</h4>
              <small style="color: var(--text-muted); font-size: 0.78rem;">${show.media_type === 'movie' ? 'Película' : 'Anime'} · Año ${show.year || 'N/A'} · Clasificación: ${show.age_rating || 'TV-14'}</small>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0; flex-wrap: wrap;">
            <button type="button" class="btn-status-toggle ${stClass}" data-id="${show.id}" data-status="${st}" title="Clic para cambiar estado">${stLabel}</button>
            <button type="button" class="btn btn-secondary btn-edit-media" data-id="${show.id}" style="padding: 6px 12px; font-size: 0.78rem;">
              <i data-lucide="edit" style="width: 13px; height: 13px;"></i> Editar
            </button>
            <button type="button" class="btn btn-danger-small btn-delete-show" data-id="${show.id}" data-title="${show.title.replace(/"/g, '&quot;')}" style="padding: 6px 12px; font-size: 0.78rem; background: rgba(255,85,85,0.12); color: #ff5555; border: 1px solid rgba(255,85,85,0.3);">
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
  try {
    const res = await fetch('/api/admin/update-show-title', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ showId, status: nextStatus })
    });
    if (res.ok) {
      loadAdminPanel();
    }
  } catch (err) {
    console.error('Error toggling show status:', err);
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

export function renderEpisodesTimings(show, episodes) {
  const container = document.getElementById('edit-episodes-thumbs-list');
  if (!container) return;

  if (!episodes || episodes.length === 0) {
    container.innerHTML = '<p class="text-muted" style="padding: 10px 0; font-size: 0.85rem;">No hay episodios registrados para este título.</p>';
    return;
  }

  container.innerHTML = episodes.map(ep => {
    const introStart = ep.intro_start !== null && ep.intro_start !== undefined ? ep.intro_start : '';
    const introEnd = ep.intro_end !== null && ep.intro_end !== undefined ? ep.intro_end : '';
    const outroStart = ep.outro_start !== null && ep.outro_start !== undefined ? ep.outro_start : '';
    const epLabel = `S${ep.season_number || 1}E${ep.episode_number || 1}: ${ep.title || 'Episodio ' + (ep.episode_number || 1)}`;

    return `
      <div class="episode-timing-card" data-ep-id="${ep.id}" style="padding: 10px 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; margin-bottom: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
          <strong style="color: var(--text-main); font-size: 0.88rem;">${epLabel}</strong>
          <span class="timing-status-badge text-muted" style="font-size: 0.75rem;"></span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
          <div style="display: flex; align-items: center; gap: 4px;">
            <label style="font-size: 0.75rem; color: var(--text-muted);">Intro Inicio:</label>
            <input type="number" class="input-intro-start" value="${introStart}" placeholder="0s" style="width: 65px; padding: 4px 6px; font-size: 0.8rem; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: #fff;">
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <label style="font-size: 0.75rem; color: var(--text-muted);">Intro Fin:</label>
            <input type="number" class="input-intro-end" value="${introEnd}" placeholder="90s" style="width: 65px; padding: 4px 6px; font-size: 0.8rem; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: #fff;">
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <label style="font-size: 0.75rem; color: var(--text-muted);">Outro Inicio:</label>
            <input type="number" class="input-outro-start" value="${outroStart}" placeholder="1320s" style="width: 65px; padding: 4px 6px; font-size: 0.8rem; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: #fff;">
          </div>
          <div style="display: flex; align-items: center; gap: 6px; margin-left: auto;">
            <button type="button" class="btn btn-secondary btn-detect-timings" style="padding: 4px 10px; font-size: 0.75rem;">
              <i data-lucide="sparkles" style="width: 12px; height: 12px;"></i> Detectar OP/ED
            </button>
            <button type="button" class="btn btn-primary btn-save-timings" style="padding: 4px 10px; font-size: 0.75rem;">
              Guardar
            </button>
            <button type="button" class="btn btn-secondary btn-apply-season-timings" style="padding: 4px 10px; font-size: 0.75rem;">
              Aplicar a temporada
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons({ root: container });

  container.querySelectorAll('.episode-timing-card').forEach(card => {
    const epId = card.dataset.epId;
    const introStartInput = card.querySelector('.input-intro-start');
    const introEndInput = card.querySelector('.input-intro-end');
    const outroStartInput = card.querySelector('.input-outro-start');
    const statusBadge = card.querySelector('.timing-status-badge');

    const btnDetect = card.querySelector('.btn-detect-timings');
    const btnSave = card.querySelector('.btn-save-timings');
    const btnSeason = card.querySelector('.btn-apply-season-timings');

    if (btnDetect) {
      btnDetect.onclick = async () => {
        btnDetect.disabled = true;
        if (statusBadge) statusBadge.textContent = 'Analizando...';
        try {
          const res = await fetch('/api/admin/detect-timings', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ episode_id: epId })
          });
          const data = await res.json();
          if (data.success && (data.intro_start !== null || data.outro_start !== null)) {
            if (data.intro_start !== null) introStartInput.value = data.intro_start;
            if (data.intro_end !== null) introEndInput.value = data.intro_end;
            if (data.outro_start !== null) outroStartInput.value = data.outro_start;
            if (statusBadge) {
              statusBadge.textContent = `Detectado (${data.method || 'auto'}, ${(data.confidence * 100).toFixed(0)}%)`;
              statusBadge.style.color = '#00e08f';
            }
          } else {
            if (statusBadge) {
              statusBadge.textContent = 'Sin timings automáticos';
              statusBadge.style.color = '#FB923C';
            }
          }
        } catch (err) {
          if (statusBadge) statusBadge.textContent = 'Error al detectar';
        } finally {
          btnDetect.disabled = false;
        }
      };
    }

    if (btnSave) {
      btnSave.onclick = async () => {
        btnSave.disabled = true;
        try {
          const payload = {
            episode_id: epId,
            intro_start: introStartInput.value !== '' ? parseInt(introStartInput.value, 10) : null,
            intro_end: introEndInput.value !== '' ? parseInt(introEndInput.value, 10) : null,
            outro_start: outroStartInput.value !== '' ? parseInt(outroStartInput.value, 10) : null,
            apply_to_season: false
          };
          const res = await fetch('/api/admin/apply-timings', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
          });
          const resData = await res.json();
          if (res.ok && resData.success) {
            if (statusBadge) {
              statusBadge.textContent = 'Guardado';
              statusBadge.style.color = '#00e08f';
            }
          } else {
            alert('Error al guardar: ' + (resData.error || 'Desconocido'));
          }
        } catch (err) {
          alert('Error de red: ' + err.message);
        } finally {
          btnSave.disabled = false;
        }
      };
    }

    if (btnSeason) {
      btnSeason.onclick = async () => {
        const epObj = episodes.find(e => e.id === epId);
        const sNum = epObj ? (epObj.season_number || 1) : 1;
        if (!confirm(`¿Aplicar estos timings a todos los episodios de la Temporada ${sNum}?`)) return;

        btnSeason.disabled = true;
        try {
          const payload = {
            episode_id: epId,
            show_id: show.id,
            season: sNum,
            intro_start: introStartInput.value !== '' ? parseInt(introStartInput.value, 10) : null,
            intro_end: introEndInput.value !== '' ? parseInt(introEndInput.value, 10) : null,
            outro_start: outroStartInput.value !== '' ? parseInt(outroStartInput.value, 10) : null,
            apply_to_season: true
          };
          const res = await fetch('/api/admin/apply-timings', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
          });
          const resData = await res.json();
          if (res.ok && resData.success) {
            container.querySelectorAll('.episode-timing-card').forEach(otherCard => {
              const oIntroStart = otherCard.querySelector('.input-intro-start');
              const oIntroEnd = otherCard.querySelector('.input-intro-end');
              const oOutroStart = otherCard.querySelector('.input-outro-start');
              if (oIntroStart) oIntroStart.value = payload.intro_start ?? '';
              if (oIntroEnd) oIntroEnd.value = payload.intro_end ?? '';
              if (oOutroStart) oOutroStart.value = payload.outro_start ?? '';
            });
            alert(`¡Timings aplicados con éxito a ${resData.applied_count || 'los'} episodios de la temporada!`);
          } else {
            alert('Error al aplicar a temporada: ' + (resData.error || 'Desconocido'));
          }
        } catch (err) {
          alert('Error de red: ' + err.message);
        } finally {
          btnSeason.disabled = false;
        }
      };
    }
  });
}
