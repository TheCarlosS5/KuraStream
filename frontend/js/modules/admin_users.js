/**
 * KuraStream - Admin Users Module
 * Lists accounts and lets the administrator lock, promote, reset the password of, sign out or delete them.
 */

import { getAuthHeaders } from './auth.js';
import { escapeHtml } from '../core/ui.js';
import { showToast } from '../core/ui.js';
import { fetchJson, loadErrorState } from '../core/http.js';

function formatDate(iso) {
  if (!iso) return 'nunca';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'nunca';
  return d.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
}

async function send(method, path, body) {
  const options = { method, headers: getAuthHeaders() };
  if (body !== undefined) options.body = JSON.stringify(body);
  return fetchJson(`/api/admin/users${path}`, options);
}

function userRow(u) {
  const name = escapeHtml(u.username);
  const roleBadge = u.role === 'admin' ? '<span class="badge admin-user-badge admin-user-badge--admin">Admin</span>' : '';
  const stateBadge = u.disabled ? '<span class="badge admin-user-badge admin-user-badge--off">Desactivada</span>' : '';
  return `
    <div class="admin-user-row" data-username="${name}">
      <div class="admin-user-main">
        <strong class="admin-user-name">${name}</strong> ${roleBadge} ${stateBadge}
        <div class="admin-user-meta">
          Creada: ${escapeHtml(formatDate(u.created_at))} · Último acceso: ${escapeHtml(formatDate(u.last_login_at))} ·
          Último episodio visto: ${escapeHtml(formatDate(u.last_watched_at))} · Perfiles: ${u.profile_count}
        </div>
      </div>
      <div class="admin-user-actions">
        <button type="button" class="btn btn-secondary btn-xs-action" data-action="toggle-disabled">${u.disabled ? 'Activar' : 'Desactivar'}</button>
        <button type="button" class="btn btn-secondary btn-xs-action" data-action="toggle-role">${u.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button>
        <button type="button" class="btn btn-secondary btn-xs-action" data-action="logout-all">Cerrar sesiones</button>
        <button type="button" class="btn btn-secondary btn-xs-action" data-action="reset-password">Nueva contraseña</button>
        <button type="button" class="btn btn-secondary btn-xs-action admin-user-danger" data-action="delete">Eliminar</button>
      </div>
      <form class="admin-user-reset" hidden>
        <label>Nueva contraseña para ${name} (8 a 72 caracteres)
          <input type="password" class="form-control" autocomplete="new-password" minlength="8" maxlength="72" required>
        </label>
        <button type="submit" class="btn btn-primary btn-xs-action">Guardar</button>
        <button type="button" class="btn btn-secondary btn-xs-action" data-action="cancel-reset">Cancelar</button>
      </form>
    </div>`;
}

export async function loadAdminUsers() {
  const container = document.getElementById('admin-users-list');
  if (!container) return;
  container.setAttribute('aria-busy', 'true');
  try {
    const data = await fetchJson('/api/admin/users', { headers: getAuthHeaders() });
    const users = Array.isArray(data.users) ? data.users : [];
    const filter = (document.getElementById('admin-users-filter')?.value || '').trim().toLowerCase();
    const shown = filter ? users.filter(u => u.username.toLowerCase().includes(filter)) : users;
    const counter = document.getElementById('admin-users-count');
    if (counter) counter.textContent = `${users.length} cuenta${users.length === 1 ? '' : 's'}`;
    container.innerHTML = shown.length
      ? shown.map(userRow).join('')
      : '<p class="admin-user-empty">No hay cuentas que coincidan.</p>';
  } catch (error) {
    const state = loadErrorState(error, 'las cuentas');
    container.innerHTML = `<div class="admin-user-empty"><strong>${escapeHtml(state.title)}</strong><p>${escapeHtml(state.message)}</p>${state.retry ? '<button type="button" class="btn btn-secondary btn-xs-action" data-action="retry">Reintentar</button>' : ''}</div>`;
  } finally {
    container.removeAttribute('aria-busy');
  }
}

async function handleAction(button) {
  const row = button.closest('.admin-user-row');
  const action = button.dataset.action;
  if (action === 'retry') return loadAdminUsers();
  if (!row) return;
  const username = row.dataset.username;
  const path = encodeURIComponent(username);
  const isAdmin = row.querySelector('.admin-user-badge--admin') !== null;
  const isDisabled = row.querySelector('.admin-user-badge--off') !== null;

  try {
    if (action === 'toggle-disabled') {
      await send('POST', `/${path}/disable`, { disabled: !isDisabled });
      showToast(isDisabled ? `${username} activada` : `${username} desactivada y sin sesión`, 'success');
    } else if (action === 'toggle-role') {
      await send('POST', `/${path}/role`, { role: isAdmin ? 'user' : 'admin' });
      showToast(`${username}: ${isAdmin ? 'ya no es administrador' : 'ahora es administrador'}`, 'success');
    } else if (action === 'logout-all') {
      await send('POST', `/${path}/logout-all`);
      showToast(`Sesiones de ${username} cerradas`, 'success');
    } else if (action === 'reset-password') {
      const form = row.querySelector('.admin-user-reset');
      form.hidden = false;
      form.querySelector('input').focus();
      return;
    } else if (action === 'cancel-reset') {
      row.querySelector('.admin-user-reset').hidden = true;
      return;
    } else if (action === 'delete') {
      // Two-step confirmation in place (no window.confirm): the first click arms the button
      if (button.dataset.armed !== '1') {
        button.dataset.armed = '1';
        button.textContent = `¿Eliminar ${username} y todos sus datos? Pulsa de nuevo`;
        setTimeout(() => { if (button.isConnected) { button.dataset.armed = ''; button.textContent = 'Eliminar'; } }, 6000);
        return;
      }
      await send('DELETE', `/${path}`);
      showToast(`${username} eliminada`, 'success');
    }
    await loadAdminUsers();
  } catch (error) {
    showToast(error.message || 'No se pudo completar la acción', 'error');
  }
}

let wired = false;

export function initAdminUsers() {
  loadAdminUsers();
  if (wired) return;
  const container = document.getElementById('admin-users-list');
  if (!container) return;
  wired = true;

  container.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (button) handleAction(button);
  });

  container.addEventListener('submit', async (event) => {
    const form = event.target.closest('.admin-user-reset');
    if (!form) return;
    event.preventDefault();
    const row = form.closest('.admin-user-row');
    const input = form.querySelector('input');
    try {
      await send('POST', `/${encodeURIComponent(row.dataset.username)}/reset-password`, { password: input.value });
      input.value = '';
      form.hidden = true;
      showToast(`Contraseña de ${row.dataset.username} restablecida`, 'success');
    } catch (error) {
      showToast(error.message || 'No se pudo restablecer la contraseña', 'error');
    }
  });

  document.getElementById('admin-users-filter')?.addEventListener('input', () => loadAdminUsers());
  document.getElementById('btn-refresh-users')?.addEventListener('click', () => loadAdminUsers());
}
