/**
 * Loading data for a view, with failures told apart from "nothing there".
 *
 * Views used to treat any failed request as an empty answer ("Tu lista está vacía" when the server was down or the
 * session had expired). fetchJson throws a LoadError that says which kind of failure it was, and loadErrorState()
 * describes how to present it.
 */

export class LoadError extends Error {
  constructor(message, { status = 0, network = false } = {}) {
    super(message);
    this.name = 'LoadError';
    this.status = status;
    this.network = network;
  }
}

/** GET/POST JSON. Resolves with the parsed body, throws LoadError (network, 401/403, other HTTP errors, bad JSON). */
export async function fetchJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new LoadError('Sin conexión con el servidor', { network: true });
  }
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).error || ''; } catch { /* not JSON */ }
    throw new LoadError(detail || `Error ${response.status}`, { status: response.status });
  }
  try {
    return await response.json();
  } catch {
    throw new LoadError('Respuesta inválida del servidor', { status: response.status });
  }
}

/**
 * How to present a failure: { kind: 'network' | 'auth' | 'server', title, message, retry, login }.
 * `what` names the thing that could not be loaded ("tu lista", "el historial").
 */
export function loadErrorState(error, what = 'los datos') {
  const status = error && typeof error.status === 'number' ? error.status : 0;
  if (error && error.network) {
    return { kind: 'network', title: 'Sin conexión', message: `No se pudo cargar ${what}. Revisa tu red o que el servidor esté encendido.`, retry: true, login: false };
  }
  if (status === 401 || status === 403) {
    return { kind: 'auth', title: 'Tu sesión terminó', message: `Inicia sesión de nuevo para ver ${what}.`, retry: false, login: true };
  }
  return { kind: 'server', title: 'No se pudo cargar', message: `El servidor no pudo darnos ${what} (${error && error.message ? error.message : 'error'}). Intenta de nuevo.`, retry: true, login: false };
}
