/**
 * KuraStream - Android app download view (#/app).
 * The APK is served by this same server, so the QR and the server address point at the origin the
 * page was opened from (on the hotspot: http://10.42.0.1:3000).
 */
import { renderQRCodeToElement } from '../features/player/qr_generator.js';

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // navigator.clipboard needs a secure context; plain http on the LAN falls back to execCommand.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

let copyBound = false;

export async function renderAppDownloadView() {
  const origin = window.location.origin;
  const serverEl = document.getElementById('app-dl-server');
  if (serverEl) serverEl.textContent = origin;

  if (!copyBound) {
    copyBound = true;
    document.getElementById('app-dl-copy')?.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      const ok = await copyText(window.location.origin);
      btn.dataset.state = ok ? 'done' : 'error';
      btn.setAttribute('aria-label', ok ? 'Dirección copiada' : 'No se pudo copiar');
      setTimeout(() => {
        delete btn.dataset.state;
        btn.setAttribute('aria-label', 'Copiar dirección del servidor');
      }, 1800);
    });
  }

  const card = document.getElementById('app-dl-card');
  const button = document.getElementById('app-dl-button');
  const meta = document.getElementById('app-dl-meta');
  const qrBox = document.getElementById('app-dl-qr');
  if (!card || !button || !meta || !qrBox) return;

  card.classList.remove('is-unavailable');
  meta.textContent = 'Comprobando disponibilidad…';

  let info = null;
  try {
    const res = await fetch('/api/app/android', { cache: 'no-store' });
    if (res.ok) info = await res.json();
  } catch {
    info = null;
  }

  if (!info || !info.available) {
    card.classList.add('is-unavailable');
    button.removeAttribute('href');
    button.setAttribute('aria-disabled', 'true');
    meta.textContent = info ? 'El servidor todavía no tiene el instalador de Android.' : 'No se pudo contactar con el servidor.';
    qrBox.innerHTML = '';
    return;
  }

  const downloadUrl = new URL(info.download_url, origin).href;
  button.href = info.download_url;
  button.removeAttribute('aria-disabled');
  meta.textContent = [
    info.version ? `Versión ${info.version}` : '',
    formatSize(info.size_bytes),
    info.updated_at ? `Actualizada ${formatDate(info.updated_at)}` : ''
  ].filter(Boolean).join(' · ');

  renderQRCodeToElement(qrBox, downloadUrl, 168);
  const qrLink = document.getElementById('app-dl-qr-url');
  if (qrLink) qrLink.textContent = downloadUrl.replace(/^https?:\/\//, '');
}
