/**
 * KuraStream v2.0 - Core Authentication & Profile Session Manager
 */

import { api, setApiAuthToken } from './api.js';

const STORAGE_KEYS = {
  TOKEN: 'kurastream_jwt',
  USER: 'kurastream_user',
  ACTIVE_PROFILE: 'kurastream_active_profile'
};

export class AuthManager {
  static getToken() {
    return localStorage.getItem(STORAGE_KEYS.TOKEN);
  }

  static getUser() {
    const raw = localStorage.getItem(STORAGE_KEYS.USER);
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  static getActiveProfile() {
    const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_PROFILE);
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  static setSession(token, user, profile = null) {
    if (token) {
      localStorage.setItem(STORAGE_KEYS.TOKEN, token);
      setApiAuthToken(token);
    }
    if (user) {
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    }
    if (profile) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_PROFILE, JSON.stringify(profile));
    }
  }

  static clearSession() {
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    localStorage.removeItem(STORAGE_KEYS.USER);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_PROFILE);
    setApiAuthToken(null);
  }

  static isAuthenticated() {
    return Boolean(this.getToken());
  }

  static async login(username, password) {
    const res = await api.post('/api/login', { username, password });
    if (res.data && res.data.token) {
      this.setSession(res.data.token, res.data.user || { username });
      return res.data;
    }
    throw new Error('Respuesta inválida del servidor al iniciar sesión');
  }

  static async logout() {
    try {
      await api.post('/api/logout');
    } catch {
      // Ignorar errores de red en logout
    } finally {
      this.clearSession();
      window.location.hash = '#/';
      window.location.reload();
    }
  }

  static async selectProfile(profileId, pin = null) {
    const body = { profile_id: profileId };
    if (pin) body.pin = pin;

    const res = await api.post('/api/profiles/select', body);
    if (res.data && res.data.success) {
      if (res.data.token) {
        this.setSession(res.data.token, this.getUser(), res.data.profile);
      } else {
        localStorage.setItem(STORAGE_KEYS.ACTIVE_PROFILE, JSON.stringify(res.data.profile));
      }
      return res.data.profile;
    }
    throw new Error(res.data.error || 'Error al seleccionar perfil');
  }
}
