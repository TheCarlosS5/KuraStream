/**
 * KuraStream v2.0 - Core API Client
 * Centralized fetch client with automatic headers, error normalization, and response timing.
 */

export class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

let activeAuthToken = null;

export function setApiAuthToken(token) {
  activeAuthToken = token;
}

export function getApiAuthToken() {
  if (activeAuthToken) return activeAuthToken;
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem('kurastream_jwt') || localStorage.getItem('token') || null;
  }
  return null;
}

export async function apiRequest(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : endpoint;
  const headers = {
    'Accept': 'application/json',
    ...(options.headers || {})
  };

  const token = getApiAuthToken();
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const startTime = performance.now();
  let response;

  try {
    response = await fetch(url, {
      ...options,
      headers
    });
  } catch (netErr) {
    throw new ApiError('Error de conexión con el servidor. Revisa tu red.', 0, { originalError: netErr.message });
  }

  const duration = Math.round(performance.now() - startTime);

  // Parse response
  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const errorMsg = (data && data.error) ? data.error : `HTTP ${response.status}: ${response.statusText}`;
    throw new ApiError(errorMsg, response.status, data);
  }

  return {
    data,
    status: response.status,
    durationMs: duration,
    headers: response.headers
  };
}

export const api = {
  get: (url, opts = {}) => apiRequest(url, { ...opts, method: 'GET' }),
  post: (url, body, opts = {}) => apiRequest(url, { ...opts, method: 'POST', body }),
  put: (url, body, opts = {}) => apiRequest(url, { ...opts, method: 'PUT', body }),
  delete: (url, opts = {}) => apiRequest(url, { ...opts, method: 'DELETE' })
};
