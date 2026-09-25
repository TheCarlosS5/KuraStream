/**
 * KuraStream v2.0 - Core Application Reactive State Store
 */

class Store {
  constructor(initialState = {}) {
    this.state = initialState;
    this.listeners = new Map();
  }

  get(key) {
    return this.state[key];
  }

  set(key, value) {
    const prev = this.state[key];
    this.state[key] = value;
    this.emit(key, value, prev);
  }

  update(key, fn) {
    this.set(key, fn(this.state[key]));
  }

  subscribe(key, listener) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key).add(listener);
    return () => this.listeners.get(key).delete(listener);
  }

  emit(key, newVal, oldVal) {
    if (this.listeners.has(key)) {
      this.listeners.get(key).forEach(cb => {
        try {
          cb(newVal, oldVal);
        } catch (e) {
          console.error(`[Store] Listener error for key '${key}':`, e);
        }
      });
    }
  }
}

export const appState = new Store({
  user: null,
  activeProfile: null,
  profiles: [],
  catalog: [],
  continueWatching: [],
  favorites: [],
  watchHistory: [],
  genres: [],
  notifications: [],
  currentShow: null,
  activeEpisode: null,
  isOffline: !navigator.onLine
});

// Sync online/offline state automatically
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => appState.set('isOffline', false));
  window.addEventListener('offline', () => appState.set('isOffline', true));
}
