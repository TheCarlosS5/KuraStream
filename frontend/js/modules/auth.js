/**
 * KuraStream - Auth Module (Delegation Layer)
 * Delegates all auth and session management directly to core AuthManager.
 */

import { AuthManager } from '../core/auth.js';

export function getAuthToken() {
  return AuthManager.getToken() || '';
}

export function setAuthToken(token) {
  if (token) {
    AuthManager.setSession(token, AuthManager.getUser(), AuthManager.getActiveProfile());
  }
}

export function removeAuthToken() {
  AuthManager.clearSession();
}

export function getAuthHeaders() {
  const token = getAuthToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export function getCurrentUser() {
  return AuthManager.getUser();
}

export function setCurrentUser(user) {
  if (user) {
    AuthManager.setSession(AuthManager.getToken(), user, AuthManager.getActiveProfile());
  } else {
    AuthManager.clearSession();
  }
}

export function openAdminLoginModal() {
  if (typeof window.openAuthModal === 'function') {
    window.openAuthModal('admin');
  } else {
    const modal = document.getElementById('login-modal');
    if (modal) {
      modal.style.display = 'flex';
      const title = document.getElementById('login-modal-title');
      if (title) title.textContent = 'Acceso de Administrador';
      const submit = document.getElementById('login-modal-submit');
      if (submit) submit.textContent = 'Acceder al Panel';
      const input = document.getElementById('login-username-input');
      if (input) input.focus();
    }
  }
}

export function closeAdminLoginModal() {
  const modal = document.getElementById('login-modal');
  if (modal) modal.style.display = 'none';
}

export async function loginAdmin(username, password) {
  try {
    const data = await AuthManager.login(username, password);
    closeAdminLoginModal();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message || 'Credenciales incorrectas' };
  }
}
