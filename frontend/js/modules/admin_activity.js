/**
 * Admin overview "Actividad" card: who is watching right now, the latest progress saves, and which shows take the
 * most disk (with how long since anyone watched them), plus how many more episodes fit. Data from
 * GET /api/admin/activity; everything is written with textContent (profile and show names come from users).
 */
import { getAuthHeaders } from './auth.js';
import { formatBytes } from './admin_status.js';

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

function formatAgo(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  const days = Math.round(s / 86400);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function episodeLabel(row) {
  const code = row.season_number > 0 ? `T${row.season_number} · E${row.episode_number}` : `Especial ${row.episode_number}`;
  return `${row.show_title} — ${code}`;
}

function renderHistoryList(list, rows, emptyText, live) {
  list.textContent = '';
  if (!rows.length) {
    list.appendChild(el('li', 'admin-simple-empty', emptyText));
    return;
  }
  rows.forEach((row) => {
    const item = el('li', 'admin-activity-item');
    const who = el('span', 'admin-activity-who', row.profile_name || row.username);
    who.title = `Cuenta: ${row.username}`;
    const what = el('span', 'admin-activity-what', episodeLabel(row));
    const pct = row.duration > 0 ? Math.min(100, Math.round((row.progress_seconds / row.duration) * 100)) : 0;
    const meta = el('span', 'admin-activity-meta', live
      ? `${formatClock(row.progress_seconds)} / ${formatClock(row.duration)}`
      : `${row.completed || pct >= 90 ? 'Terminado' : `${pct} %`} · ${formatAgo(row.seconds_ago)}`);
    const bar = el('span', 'admin-activity-bar');
    const fill = el('span', 'admin-activity-bar-fill');
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    item.append(who, what, meta, bar);
    list.appendChild(item);
  });
}

function renderBiggest(list, shows) {
  list.textContent = '';
  if (!shows.length) {
    list.appendChild(el('li', 'admin-simple-empty', 'Aún no hay episodios escaneados.'));
    return;
  }
  const max = Math.max(...shows.map(s => s.bytes), 1);
  shows.forEach((show) => {
    const item = el('li', 'admin-size-item');
    const name = el('span', 'admin-size-name', show.title);
    const size = el('span', 'admin-size-value', `${formatBytes(show.bytes)} · ${show.episodes} ${show.episodes === 1 ? 'episodio' : 'episodios'}`);
    const stale = show.days_since_watched === null || show.days_since_watched >= 60;
    const watched = el('span', `admin-size-watched${stale ? ' is-stale' : ''}`,
      show.days_since_watched === null ? 'Nadie lo ha visto' : (show.days_since_watched === 0 ? 'Visto hoy' : `Visto hace ${show.days_since_watched} d`));
    const bar = el('span', 'admin-size-bar');
    const fill = el('span', 'admin-size-bar-fill');
    fill.style.width = `${Math.max(2, Math.round((show.bytes / max) * 100))}%`;
    bar.appendChild(fill);
    item.append(name, size, watched, bar);
    list.appendChild(item);
  });
}

function renderCapacity(target, capacity) {
  if (!capacity || capacity.free_bytes === null) {
    target.textContent = 'No se pudo leer el espacio libre del disco de la biblioteca.';
    return;
  }
  const fit = capacity.episodes_that_fit;
  target.textContent = fit === null
    ? `${formatBytes(capacity.free_bytes)} libres.`
    : `${formatBytes(capacity.free_bytes)} libres: caben unos ${fit.toLocaleString('es')} episodios más (de ${formatBytes(capacity.average_episode_bytes)} de media).`;
  target.classList.toggle('is-warn', fit !== null && fit < 50);
}

export async function fetchAdminActivity() {
  const nowList = document.getElementById('activity-now-list');
  if (!nowList) return;
  try {
    const res = await fetch('/api/admin/activity', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const watching = Array.isArray(data.watching_now) ? data.watching_now : [];
    renderHistoryList(nowList, watching, 'Nadie está viendo nada ahora mismo.', true);
    const recent = document.getElementById('activity-recent-list');
    if (recent) renderHistoryList(recent, Array.isArray(data.recent) ? data.recent : [], 'Todavía no hay historial.', false);
    const badge = document.getElementById('activity-now-badge');
    if (badge) {
      badge.textContent = watching.length ? `${watching.length} VIENDO AHORA` : 'SIN ESPECTADORES';
      badge.classList.toggle('is-ok', watching.length > 0);
    }
    const biggest = document.getElementById('activity-biggest-list');
    if (biggest) renderBiggest(biggest, Array.isArray(data.biggest_shows) ? data.biggest_shows : []);
    const capacity = document.getElementById('activity-capacity');
    if (capacity) renderCapacity(capacity, data.capacity);
  } catch (err) {
    console.warn('[Admin Activity] fetch warning:', err.message);
  }
}
