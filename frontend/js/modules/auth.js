/**
 * KuraStream - Auth Module
 * Handles session tokens, admin auth headers, and login state.
 */

export function getAuthToken() {
  const sessionStr = localStorage.getItem('kura_user_session');
  if (sessionStr) {
    try {
      const session = JSON.parse(sessionStr);
      if (session && session.token) return session.token;
    } catch(e) {}
  }
  return localStorage.getItem('adminToken') || localStorage.getItem('kura_admin_token') || localStorage.getItem('kurastream_token') || localStorage.getItem('token') || '';
}

export function setAuthToken(token) {
  if (token) {
    localStorage.setItem('kurastream_token', token);
    localStorage.setItem('token', token);
  }
}

export function removeAuthToken() {
  localStorage.removeItem('kurastream_token');
  localStorage.removeItem('token');
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
  try {
    const raw = localStorage.getItem('kurastream_user');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function setCurrentUser(user) {
  if (user) {
    localStorage.setItem('kurastream_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('kurastream_user');
  }
}

export function openAdminLoginModal() {
  const modal = document.getElementById('login-modal') || document.getElementById('admin-login-modal-overlay');
  if (modal) {
    modal.style.display = 'flex';
    const input = document.getElementById('login-username-input') || document.getElementById('admin-login-password');
    if (input) input.focus();
  }
}

export function closeAdminLoginModal() {
  const modal = document.getElementById('login-modal') || document.getElementById('admin-login-modal-overlay');
  if (modal) modal.style.display = 'none';
}

export async function loginAdmin(username, password) {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      setAuthToken(data.token);
      setCurrentUser({ username: data.username, role: data.role });
      closeAdminLoginModal();
      return { success: true, data };
    } else {
      return { success: false, error: data.message || data.error || 'Credenciales incorrectas' };
    }
  } catch (err) {
    return { success: false, error: 'Error de conexión: ' + err.message };
  }
}
