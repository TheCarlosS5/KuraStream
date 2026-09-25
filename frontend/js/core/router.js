/**
 * KuraStream v2.0 - Core Client-Side Router
 * Clean hash-based navigation manager with view lifecycle handling.
 */

export class Router {
  constructor() {
    this.routes = {};
    this.currentRoute = null;
    this.beforeHooks = [];

    window.addEventListener('hashchange', () => this.handleRouting());
  }

  on(path, handler) {
    this.routes[path] = handler;
    return this;
  }

  beforeEach(hook) {
    this.beforeHooks.push(hook);
    return this;
  }

  navigate(path) {
    window.location.hash = path.startsWith('#') ? path : `#${path}`;
  }

  getHash() {
    return window.location.hash.slice(1) || '/';
  }

  async handleRouting() {
    const rawPath = this.getHash();
    const [pathOnly, queryString] = rawPath.split('?');
    const query = new URLSearchParams(queryString || '');

    // Match route
    let matchedHandler = null;
    let params = {};

    for (const [routePattern, handler] of Object.entries(this.routes)) {
      if (routePattern === pathOnly) {
        matchedHandler = handler;
        break;
      }

      // Check dynamic route :param
      if (routePattern.includes(':')) {
        const patternParts = routePattern.split('/');
        const pathParts = pathOnly.split('/');

        if (patternParts.length === pathParts.length) {
          let match = true;
          const extracted = {};

          for (let i = 0; i < patternParts.length; i++) {
            if (patternParts[i].startsWith(':')) {
              extracted[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
            } else if (patternParts[i] !== pathParts[i]) {
              match = false;
              break;
            }
          }

          if (match) {
            matchedHandler = handler;
            params = extracted;
            break;
          }
        }
      }
    }

    // Default to fallback if no match
    if (!matchedHandler && this.routes['*']) {
      matchedHandler = this.routes['*'];
    }

    if (!matchedHandler) return;

    // Run before hooks
    for (const hook of this.beforeHooks) {
      const allowed = await hook(pathOnly, params);
      if (allowed === false) return;
    }

    this.currentRoute = pathOnly;
    try {
      await matchedHandler({ path: pathOnly, params, query });
    } catch (err) {
      console.error('[Router] Error executing route handler:', err);
    }

    // Trigger Lucide icon render after view change
    if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  start() {
    this.handleRouting();
  }
}

export const appRouter = new Router();
