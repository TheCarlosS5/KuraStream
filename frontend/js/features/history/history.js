/**
 * KuraStream v2.0 - Watch History Feature Module
 */

import { api } from '../../core/api.js';
import { escapeHtml, escapeHtmlAttribute, renderIcons } from '../../core/ui.js';

export async function loadWatchHistory(container) {
  if (!container) return;
  try {
    const res = await api.get('/api/user/history');
    const items = res.data && res.data.history ? res.data.history : (Array.isArray(res.data) ? res.data : []);

    if (items.length === 0) {
      container.innerHTML = '<p style="color: var(--text-muted); padding: 20px; text-align: center;">No tienes episodios en tu historial.</p>';
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="history-item" data-episode-id="${escapeHtmlAttribute(String(item.episode_id))}" style="display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid var(--border-subtle); cursor: pointer;">
        <div>
          <h4 style="font-size: 0.95rem; font-weight: 600;">${escapeHtml(item.show_title || '')}</h4>
          <p style="font-size: 0.8rem; color: var(--text-muted);">Episodio ${escapeHtml(String(item.episode_number || ''))} &bull; ${escapeHtml(item.time_ago || '')}</p>
        </div>
        <button class="btn btn-secondary btn-play-history" style="padding: 6px 12px; font-size: 0.8rem;">
          <i data-lucide="play" style="width: 14px; height: 14px;"></i> Continuar
        </button>
      </div>
    `).join('');

    renderIcons(container);
  } catch (err) {
    console.error('[History] Error loading history:', err);
  }
}
