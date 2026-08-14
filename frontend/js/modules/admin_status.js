/**
 * KuraStream - Admin Status Module
 * Handles server stats, active streams polling, and laptop display power control.
 */

import { getAuthHeaders, openAdminLoginModal } from './auth.js';

let statsInterval = null;

export function startAdminStatsPolling() {
  stopAdminStatsPolling();
  fetchAdminStats();
  fetchDisplayStatus();
  statsInterval = setInterval(() => {
    fetchAdminStats();
    fetchDisplayStatus();
  }, 3000);
}

export function stopAdminStatsPolling() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
}

export async function fetchAdminStats() {
  const statsContainer = document.getElementById('admin-stats-container');
  if (!statsContainer) return;

  try {
    const res = await fetch('/api/admin/stats', { headers: getAuthHeaders() });
    if (res.status === 401 || res.status === 403) {
      statsContainer.innerHTML = `<div class="admin-card" style="text-align: center; padding: 25px;">
        <p style="color: #ff5555; font-weight: 600;">Sesión de administrador no autorizada.</p>
        <button type="button" class="btn btn-primary" id="btn-reauth-stats">Iniciar Sesión Administrador</button>
      </div>`;
      const btn = document.getElementById('btn-reauth-stats');
      if (btn) btn.onclick = openAdminLoginModal;
      return;
    }

    if (!res.ok) return;
    const data = await res.json();

    const showsCountEl = document.getElementById('stat-shows-count');
    const episodesCountEl = document.getElementById('stat-episodes-count');
    const librarySizeEl = document.getElementById('stat-library-size');
    const videoHoursEl = document.getElementById('stat-video-hours');
    const storagePercentEl = document.getElementById('stat-storage-percent');
    const storageProgressEl = document.getElementById('stat-storage-progress');
    const storageDetailsEl = document.getElementById('stat-storage-details');

    if (showsCountEl) showsCountEl.textContent = data.showsCount || 0;
    if (episodesCountEl) episodesCountEl.textContent = data.episodesCount || 0;
    if (librarySizeEl) librarySizeEl.textContent = data.librarySizeFormatted || '0 GB';
    if (videoHoursEl) videoHoursEl.textContent = `${data.totalHours || 0} h`;

    if (data.diskInfo) {
      const disk = data.diskInfo;
      const pct = disk.usedPercent || 0;
      if (storagePercentEl) storagePercentEl.textContent = `${pct.toFixed(1)}% USADO`;
      if (storageProgressEl) storageProgressEl.style.width = `${pct}%`;
      if (storageDetailsEl) {
        storageDetailsEl.textContent = `Capacidad Biblioteca: ${data.librarySizeFormatted} | Espacio Usado: ${disk.usedFormatted} | Espacio Libre: ${disk.freeFormatted} | Capacidad Total Disco: ${disk.totalFormatted}`;
      }
    }
  } catch (err) {
    console.warn('[Admin Status] Stats fetch warning:', err.message);
  }
}

export async function fetchDisplayStatus() {
  const badge = document.getElementById('display-power-badge');
  const btnOff = document.getElementById('btn-display-off');
  const btnOn = document.getElementById('btn-display-on');

  try {
    const res = await fetch('/api/admin/display/status', { headers: getAuthHeaders() });
    if (!res.ok) return;
    const data = await res.json();

    const isOff = data.state === 'off' || data.brightness === 0;
    if (badge) {
      badge.textContent = isOff ? 'APAGADA (MODO ANTI-CALENTAMIENTO)' : 'ENCENDIDA';
      badge.style.background = isOff ? 'rgba(168, 85, 247, 0.2)' : 'rgba(0, 224, 143, 0.2)';
      badge.style.color = isOff ? '#c084fc' : '#00e08f';
    }
    if (btnOff) btnOff.disabled = isOff;
    if (btnOn) btnOn.disabled = !isOff;
  } catch (err) {
    console.warn('[Admin Status] Display status fetch warning:', err.message);
  }
}

export async function toggleLaptopDisplayPower(power) {
  try {
    const res = await fetch('/api/admin/display/power', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ power })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      fetchDisplayStatus();
    } else {
      alert('Error al cambiar pantalla: ' + (data.error || 'Desconocido'));
    }
  } catch (err) {
    alert('Error de red al cambiar estado de pantalla: ' + err.message);
  }
}
