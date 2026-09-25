/**
 * KuraStream v2.0 - Profiles Feature Module
 * Profile switching, PIN protection, Kids mode toggle, and avatar selection.
 */

import { api } from '../../core/api.js';
import { AuthManager } from '../../core/auth.js';
import { escapeHtml, escapeHtmlAttribute, renderIcons } from '../../core/ui.js';

export async function fetchUserProfiles() {
  try {
    const res = await api.get('/api/profiles');
    return res.data && res.data.profiles ? res.data.profiles : (Array.isArray(res.data) ? res.data : []);
  } catch (err) {
    console.error('[Profiles] Error fetching profiles:', err);
    return [];
  }
}

export function renderProfilesList(profiles, container) {
  if (!container) return;
  const activeProfile = AuthManager.getActiveProfile();

  container.innerHTML = profiles.map(p => {
    const isSelected = activeProfile && String(activeProfile.id) === String(p.id);
    const hasPin = Boolean(p.has_pin || p.is_locked);
    const isKids = Boolean(p.is_kids);

    return `
      <div class="profile-card ${isSelected ? 'active' : ''}" data-profile-id="${escapeHtmlAttribute(String(p.id))}" data-has-pin="${hasPin}" tabindex="0" role="button" aria-label="Perfil ${escapeHtmlAttribute(p.name)}">
        <div class="profile-avatar-wrap" style="position: relative;">
          <img class="profile-avatar" src="${escapeHtmlAttribute(p.avatar_url || '/assets/avatars/avatar1.png')}" alt="${escapeHtmlAttribute(p.name)}" />
          ${hasPin ? `<span class="badge" style="position: absolute; bottom: 4px; right: 4px; background: rgba(0,0,0,0.8);"><i data-lucide="lock" style="width:12px;height:12px;"></i></span>` : ''}
          ${isKids ? `<span class="badge" style="position: absolute; top: 4px; left: 4px; background: var(--info-color); color: #000; font-weight:700;">KIDS</span>` : ''}
        </div>
        <div class="profile-name" style="margin-top: 8px; font-weight: 600; text-align: center;">${escapeHtml(p.name)}</div>
      </div>
    `;
  }).join('');

  renderIcons(container);
}
