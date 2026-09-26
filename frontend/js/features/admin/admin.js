/**
 * KuraStream v2.0 - Admin Feature Module
 * System health monitoring, manual media library scanner, staging management.
 */

import { api } from '../../core/api.js';
import { showToast } from '../../core/ui.js';

export async function fetchSystemHealth() {
  try {
    const res = await api.get('/api/health');
    return res.data;
  } catch (err) {
    return {
      status: 'degraded',
      database: 'disconnected',
      error: err.message
    };
  }
}

export async function triggerLibraryScan(btnElement = null) {
  if (btnElement) {
    btnElement.disabled = true;
    btnElement.textContent = 'Escaneando biblioteca...';
  }

  showToast('Iniciando escaneo de medios en la biblioteca...', 'info');

  try {
    const res = await api.post('/api/admin/scan');
    const msg = res.data && res.data.message ? res.data.message : 'Escaneo de biblioteca completado.';
    showToast(msg, 'success');
  } catch (err) {
    showToast(`Error al escanear: ${err.message}`, 'error');
  } finally {
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.textContent = 'Escanear Biblioteca';
    }
  }
}
