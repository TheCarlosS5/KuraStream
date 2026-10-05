/**
 * KuraStream v2.0 - Core UI Helpers
 * Toast notifications, accessible modals, XSS escaping, and Lucide icon rendering.
 */

export function escapeHtml(str) {
  // Non-strings (numbers, arrays from loose JSON) must be escaped too, not passed through.
  return (typeof str === 'string' ? str : String(str ?? ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function escapeHtmlAttribute(str) {
  return escapeHtml(str);
}

export function showToast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'alert');

  let iconName = 'info';
  if (type === 'success') iconName = 'check-circle';
  if (type === 'error' || type === 'danger') iconName = 'alert-triangle';

  toast.innerHTML = `
    <i data-lucide="${iconName}" style="width: 18px; height: 18px; flex-shrink: 0; color: ${type === 'success' ? 'var(--success-color)' : (type === 'error' ? 'var(--danger-color)' : 'var(--accent-color)')};"></i>
    <span style="flex: 1;">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  renderIcons(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

export function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.style.display = 'flex';
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');

  // Focus trap / escape listener
  const onKey = (e) => {
    if (e.key === 'Escape') {
      closeModal(modalId);
      window.removeEventListener('keydown', onKey);
    }
  };
  window.addEventListener('keydown', onKey);

  renderIcons(modal);
}

export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    if (!modal.classList.contains('open')) {
      modal.style.display = 'none';
    }
  }, 200);
}

export function renderIcons(container = document) {
  if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons({
      root: container
    });
  }
}
