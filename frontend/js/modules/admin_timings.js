/**
 * KuraStream - Admin Timings Editor
 * Intro / ending marks per episode (the "Saltar intro" button depends on them). Values are seconds.
 */

import { getAuthHeaders } from './auth.js';
import { escapeHtml, escapeHtmlAttribute, showToast } from '../core/ui.js';
import { fetchJson, loadErrorState } from '../core/http.js';

const FIELDS = [
  ['intro_start', 'Intro inicio'],
  ['intro_end', 'Intro fin'],
  ['outro_start', 'Créditos inicio'],
  ['outro_end', 'Créditos fin']
];

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function rowHtml(ep) {
  const label = `T${ep.season_number ?? 1} · Ep. ${ep.episode_number ?? '?'} — ${ep.title || ''}`;
  const inputs = FIELDS.map(([key, text]) => `
      <label class="timing-field">${escapeHtml(text)}
        <input type="number" min="0" step="1" inputmode="numeric" class="form-control" data-field="${key}" value="${escapeHtmlAttribute(ep[key] ?? '')}">
      </label>`).join('');
  return `
    <div class="timing-row" data-episode-id="${escapeHtmlAttribute(ep.id)}" data-season="${escapeHtmlAttribute(ep.season_number ?? 1)}">
      <div class="timing-title">${escapeHtml(label)}</div>
      <div class="timing-fields">${inputs}</div>
      <div class="timing-actions">
        <button type="button" class="btn btn-secondary btn-xs-action" data-action="detect">Detectar</button>
        <button type="button" class="btn btn-secondary btn-xs-action" data-action="season">Copiar a la temporada</button>
        <button type="button" class="btn btn-primary btn-xs-action" data-action="save">Guardar</button>
      </div>
    </div>`;
}

function readRow(row) {
  const values = {};
  for (const [key] of FIELDS) {
    const v = numberOrNull(row.querySelector(`[data-field="${key}"]`).value);
    if (Number.isNaN(v)) throw new Error('Los tiempos deben ser segundos enteros (0 o más)');
    values[key] = v;
  }
  if (values.intro_start !== null && values.intro_end !== null && values.intro_end <= values.intro_start) {
    throw new Error('El fin de la intro debe ser mayor que su inicio');
  }
  if (values.outro_start !== null && values.outro_end !== null && values.outro_end <= values.outro_start) {
    throw new Error('El fin de los créditos debe ser mayor que su inicio');
  }
  return values;
}

async function post(path, body) {
  return fetchJson(path, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body) });
}

async function handleAction(button) {
  const row = button.closest('.timing-row');
  if (!row) return;
  const episodeId = row.dataset.episodeId;
  button.disabled = true;
  try {
    if (button.dataset.action === 'save') {
      await post('/api/admin/save-episode-timings', { episode_id: episodeId, ...readRow(row) });
      showToast('Tiempos guardados', 'success');
    } else if (button.dataset.action === 'detect') {
      const res = await post('/api/admin/detect-timings', { episode_id: episodeId });
      const proposed = { intro_start: res.proposed_intro_start ?? res.intro_start, intro_end: res.proposed_intro_end ?? res.intro_end, outro_start: res.proposed_outro_start ?? res.outro_start, outro_end: res.outro_end };
      if (Object.values(proposed).every(v => v === null || v === undefined)) {
        showToast('No se encontraron tiempos automáticamente', 'warning');
      } else {
        for (const [key] of FIELDS) {
          if (proposed[key] !== null && proposed[key] !== undefined) row.querySelector(`[data-field="${key}"]`).value = Math.round(proposed[key]);
        }
        showToast('Propuesta cargada: revísala y pulsa Guardar', 'info');
      }
    } else if (button.dataset.action === 'season') {
      const v = readRow(row);
      const select = document.getElementById('admin-timings-show');
      const res = await post('/api/admin/apply-timings', {
        show_id: select.value, season: Number(row.dataset.season), apply_to_season: true,
        intro_start: v.intro_start, intro_end: v.intro_end, outro_start: v.outro_start
      });
      showToast(`Aplicado a ${res.applied ?? res.applied_count ?? res.count ?? 'la temporada'} episodios`, 'success');
      await loadEpisodes(select.value);
    }
  } catch (error) {
    showToast(error.message || 'No se pudo completar la acción', 'error');
  } finally {
    button.disabled = false;
  }
}

async function loadEpisodes(showId) {
  const list = document.getElementById('admin-timings-list');
  if (!list) return;
  if (!showId) { list.innerHTML = ''; return; }
  list.setAttribute('aria-busy', 'true');
  try {
    const data = await fetchJson(`/api/shows/${encodeURIComponent(showId)}`, { headers: getAuthHeaders() });
    const episodes = (Array.isArray(data.episodes) ? data.episodes : [])
      .slice().sort((a, b) => (a.season_number - b.season_number) || (a.episode_number - b.episode_number));
    list.innerHTML = episodes.length ? episodes.map(rowHtml).join('') : '<p class="admin-user-empty">Esta serie no tiene episodios.</p>';
  } catch (error) {
    const state = loadErrorState(error, 'los episodios');
    list.innerHTML = `<p class="admin-user-empty">${escapeHtml(state.message)}</p>`;
  } finally {
    list.removeAttribute('aria-busy');
  }
}

let wired = false;

export async function initAdminTimings() {
  const select = document.getElementById('admin-timings-show');
  const list = document.getElementById('admin-timings-list');
  if (!select || !list) return;
  if (!wired) {
    wired = true;
    select.addEventListener('change', () => loadEpisodes(select.value));
    list.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (button) handleAction(button);
    });
  }
  try {
    const shows = await fetchJson('/api/shows', { headers: getAuthHeaders() });
    const current = select.value;
    select.innerHTML = '<option value="">Elige una serie…</option>' + (Array.isArray(shows) ? shows : [])
      .map(s => `<option value="${escapeHtmlAttribute(s.id)}">${escapeHtml(s.title)}</option>`).join('');
    select.value = current;
  } catch (error) {
    showToast(loadErrorState(error, 'las series').message, 'error');
  }
}
