/**
 * KuraStream v2.0 - Core Authentication & Profile Session Manager
 * Single Canonical Source of Truth for client session, user identity, roles, and profiles.
 */

import { api, setApiAuthToken } from './api.js';

const STORAGE_KEYS = {
  TOKEN: 'kurastream_jwt',
  USER: 'kurastream_user',
  ACTIVE_PROFILE: 'kurastream_active_profile'
};

const CLOCK_SKEW_KEY = 'kurastream_clock_skew';

function tokenPayload(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

// The home server has no NTP, so its clock can be far from this device's. exp is in server time:
// compare it against "now" shifted by the skew measured when the token arrived (iat = server time).
function rememberClockSkew(token) {
  const payload = tokenPayload(token);
  if (typeof payload?.iat !== 'number') {
    localStorage.removeItem(CLOCK_SKEW_KEY);
    return;
  }
  localStorage.setItem(CLOCK_SKEW_KEY, String(payload.iat * 1000 - Date.now()));
}

function isTokenExpired(token) {
  const payload = tokenPayload(token);
  if (typeof payload?.exp !== 'number') return false;
  const skew = Number(localStorage.getItem(CLOCK_SKEW_KEY)) || 0;
  return payload.exp * 1000 <= Date.now() + skew;
}

export class AuthManager {
  static getToken() {
    const token = localStorage.getItem(STORAGE_KEYS.TOKEN) || localStorage.getItem('kurastream_token') || null;
    // An expired JWT would leave the UI "logged in" while every request fails with 401.
    if (token && isTokenExpired(token)) {
      this.clearSession();
      return null;
    }
    return token;
  }

  static getUser() {
    const raw = localStorage.getItem(STORAGE_KEYS.USER);
    try {
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore JSON parse error
    }
    const token = this.getToken();
    if (token) {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (payload && payload.username) {
            const userObj = { username: payload.username, role: payload.role || 'user' };
            localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(userObj));
            return userObj;
          }
        }
      } catch {
        // ignore decode error
      }
    }
    return null;
  }

  static getRole() {
    const user = this.getUser();
    return user ? (user.role || 'user') : 'guest';
  }

  static isAdmin() {
    return this.isAuthenticated() && this.getRole() === 'admin';
  }

  /**
   * localStorage key for the last audio/subtitle language picked on this device. Scoped per profile,
   * so one family member's choice does not override another's on a shared TV or PC.
   */
  static langPrefKey(kind) {
    const profile = this.getActiveProfile();
    const profileId = profile?.id || profile?.name;
    const targetKind = kind === 'sub' ? 'sub' : 'audio';

    if (profileId) {
      try {
        if (localStorage.getItem('kura_pref_lang_migrated') !== '1') {
          const audioScopedKey = `kura_pref_audio_lang:${profileId}`;
          const subScopedKey = `kura_pref_sub_lang:${profileId}`;

          const oldAudio = localStorage.getItem('kura_pref_audio_lang') ?? localStorage.getItem('kurastream_preferred_audio_language');
          if (oldAudio !== null && localStorage.getItem(audioScopedKey) === null) {
            localStorage.setItem(audioScopedKey, oldAudio);
          }

          const oldSub = localStorage.getItem('kura_pref_sub_lang') ?? localStorage.getItem('kurastream_preferred_subtitle_language');
          if (oldSub !== null && localStorage.getItem(subScopedKey) === null) {
            localStorage.setItem(subScopedKey, oldSub);
          }

          localStorage.setItem('kura_pref_lang_migrated', '1');
          localStorage.removeItem('kura_pref_audio_lang');
          localStorage.removeItem('kurastream_preferred_audio_language');
          localStorage.removeItem('kura_pref_sub_lang');
          localStorage.removeItem('kurastream_preferred_subtitle_language');
        }
      } catch {
        // ignore storage errors in restricted contexts
      }
    }

    return `kura_pref_${targetKind}_lang:${profileId || 'guest'}`;
  }

  /**
   * localStorage key for a profile-scoped preference (e.g. 'spoiler_free').
   * Isolates settings per profile on shared devices.
   */
  static prefKey(name) {
    const profile = this.getActiveProfile();
    const profileId = profile?.id || profile?.name;
    return `kura_pref_${name}:${profileId || 'guest'}`;
  }

  static isSpoilerFree() {
    try {
      return localStorage.getItem(this.prefKey('spoiler_free')) === 'true';
    } catch {
      return false;
    }
  }

  static setSpoilerFree(enabled) {
    try {
      localStorage.setItem(this.prefKey('spoiler_free'), enabled ? 'true' : 'false');
    } catch {
      // ignore storage errors in restricted contexts
    }
  }

  static getActiveProfile() {
    const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_PROFILE);
    try {
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore JSON parse error
    }
    const token = this.getToken();
    if (token) {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (payload && (payload.profile_name || payload.profile_id)) {
            const profObj = {
              id: payload.profile_id || 'prof_default',
              name: payload.profile_name || 'Principal',
              is_kids: Boolean(payload.is_kids)
            };
            localStorage.setItem(STORAGE_KEYS.ACTIVE_PROFILE, JSON.stringify(profObj));
            return profObj;
          }
        }
      } catch {
        // ignore decode error
      }
    }
    return null;
  }

  static setSession(token, user, profile = null) {
    if (token) {
      localStorage.setItem(STORAGE_KEYS.TOKEN, token);
      rememberClockSkew(token);
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
    localStorage.removeItem('kurastream_token');
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
      const user = res.data.user || {
        username: res.data.username || username,
        role: res.data.role || 'user'
      };
      this.setSession(res.data.token, user, res.data.profile || null);
      return res.data;
    }
    throw new Error(res.data?.error || 'Respuesta inválida del servidor al iniciar sesión');
  }

  static async register(username, password) {
    const res = await api.post('/api/register', { username, password });
    if (res.data && res.data.token) {
      const user = res.data.user || {
        username: res.data.username || username,
        role: res.data.role || 'user'
      };
      this.setSession(res.data.token, user, res.data.profile || null);
      return res.data;
    }
    throw new Error(res.data?.error || 'Error al registrar usuario');
  }

  static async logout() {
    try {
      await api.post('/api/logout');
    } catch {
      // Ignorar fallas de red durante logout
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
    throw new Error(res.data?.error || 'Error al seleccionar perfil');
  }
}
