/**
 * KuraStream - Navigation & Router Module
 * Handles active nav highlight, header dropdowns (explore, notifications, user profile),
 * and Admin sidebar sub-view switching.
 */

import { toggleLaptopDisplayPower, startAdminStatsPolling, stopAdminStatsPolling, fetchAdminStats } from './admin_status.js';
import { getAuthHeaders } from './auth.js';
import { loadStagedImports } from './admin_staging.js';
import { saveShowTitleAndStatus, scrapeShowCover, loadAdminPanel } from './admin_library.js';
import { clearConsoleLogs, startAdminLogsPolling, stopAdminLogsPolling } from './admin_console.js';
import { initImportForm } from './admin_import.js';

export function updateActiveNavHighlight(hash = location.hash || '#/') {
  const allNavLinks = document.querySelectorAll(
    '.header-nav .nav-link, .nav-dropdown-menu .dropdown-item, .user-dropdown-card .user-dropdown-item'
  );
  allNavLinks.forEach(link => link.classList.remove('active'));

  const exploreTrigger = document.getElementById('nav-explore-trigger');
  if (exploreTrigger) exploreTrigger.classList.remove('active');

  const exploreDropdown = document.getElementById('nav-explore-dropdown');
  if (exploreDropdown) exploreDropdown.classList.remove('active');

  const baseHash = hash.split('?')[0];

  if (baseHash === '#/' || baseHash === '') {
    const el = document.getElementById('nav-home');
    if (el) el.classList.add('active');
  } else if (baseHash === '#/airing') {
    const el = document.getElementById('nav-airing');
    if (el) el.classList.add('active');
  } else if (baseHash === '#/calendar') {
    const el = document.getElementById('nav-calendar');
    if (el) el.classList.add('active');
  } else if (baseHash === '#/movies') {
    const el = document.getElementById('nav-movies') || document.querySelector('a[href="#/movies"]');
    if (el) el.classList.add('active');
    if (exploreTrigger) exploreTrigger.classList.add('active');
    if (exploreDropdown) exploreDropdown.classList.add('active');
  } else if (baseHash === '#/genres') {
    const el = document.getElementById('nav-genres') || document.querySelector('a[href="#/genres"]');
    if (el) el.classList.add('active');
    if (exploreTrigger) exploreTrigger.classList.add('active');
    if (exploreDropdown) exploreDropdown.classList.add('active');
  } else if (baseHash === '#/my-list') {
    const el = document.getElementById('nav-mylist') || document.querySelector('a[href="#/my-list"]');
    if (el) el.classList.add('active');
  } else if (baseHash === '#/history') {
    const el = document.getElementById('nav-history') || document.querySelector('a[href="#/history"]');
    if (el) el.classList.add('active');
  } else if (baseHash === '#/stats') {
    const el = document.getElementById('btn-user-stats') || document.querySelector('a[href="#/stats"]');
    if (el) el.classList.add('active');
  } else if (baseHash === '#/settings') {
    const el = document.getElementById('nav-settings') || document.querySelector('a[href="#/settings"]');
    if (el) el.classList.add('active');
  } else if (baseHash === '#/app') {
    const el = document.getElementById('nav-app-download');
    if (el) el.classList.add('active');
  }
}

/**
 * Publishes the header's real height as --header-offset. The header wraps to two rows on narrow
 * screens (and the row height depends on what the account area shows), so a fixed margin either
 * hid the top of every view or left a gap.
 */
function syncHeaderOffset() {
  const header = document.querySelector('.app-header');
  if (!header || typeof ResizeObserver === 'undefined') return;
  const apply = () => {
    const height = Math.round(header.getBoundingClientRect().height);
    // The player hides the header; keep the last offset instead of collapsing the layout.
    if (height > 0) document.documentElement.style.setProperty('--header-offset', `${height}px`);
  };
  new ResizeObserver(apply).observe(header);
  apply();
}

export function initHeaderDropdowns() {
  syncHeaderOffset();
  const exploreDropdown = document.getElementById('nav-explore-dropdown');
  const exploreTrigger = document.getElementById('nav-explore-trigger');
  const exploreMenu = document.getElementById('nav-explore-menu');

  const notifContainer = document.getElementById('notifications-container');
  const notifTrigger = document.getElementById('btn-notifications-trigger');
  const notifDropdown = document.getElementById('notifications-dropdown');

  const userAccountContainer = document.getElementById('user-account-container');
  const userProfileTrigger = document.getElementById('user-profile-trigger');
  const userDropdownCard = document.getElementById('user-dropdown-card');

  const syncExploreActiveState = () => {
    const hash = (window.location.hash || '#/').split('?')[0];
    if (hash === '#/movies' || hash === '#/genres') {
      if (exploreTrigger) exploreTrigger.classList.add('active');
      if (exploreDropdown) exploreDropdown.classList.add('active');
    } else {
      if (exploreTrigger) exploreTrigger.classList.remove('active');
      if (exploreDropdown) exploreDropdown.classList.remove('active');
    }
  };

  // 1. Explore Dropdown toggle
  if (exploreTrigger && exploreMenu) {
    exploreTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = exploreMenu.classList.contains('show');
      if (isOpen) {
        exploreMenu.classList.remove('show');
        if (exploreDropdown) exploreDropdown.classList.remove('open');
        syncExploreActiveState();
      } else {
        exploreMenu.classList.add('show');
        if (exploreDropdown) exploreDropdown.classList.add('open');
        if (exploreTrigger) exploreTrigger.classList.add('active');
        if (notifDropdown) {
          notifDropdown.style.display = 'none';
          notifDropdown.classList.remove('show');
        }
        if (userDropdownCard) {
          userDropdownCard.style.display = 'none';
          userDropdownCard.classList.remove('show');
          if (userProfileTrigger) userProfileTrigger.setAttribute('aria-expanded', 'false');
        }
      }
    });

    exploreMenu.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        exploreMenu.classList.remove('show');
        if (exploreDropdown) exploreDropdown.classList.remove('open');
        syncExploreActiveState();
      });
    });

    // Hover-open is for mice only: a tap fires a compatibility mouseenter right before the click,
    // so the click handler saw the menu already open and closed it again.
    let exploreLeaveTimer = null;
    exploreDropdown.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (exploreLeaveTimer) {
        clearTimeout(exploreLeaveTimer);
        exploreLeaveTimer = null;
      }
      exploreMenu.classList.add('show');
      exploreDropdown.classList.add('open');
      if (exploreTrigger) exploreTrigger.classList.add('active');
    });
    exploreDropdown.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      exploreLeaveTimer = setTimeout(() => {
        exploreMenu.classList.remove('show');
        exploreDropdown.classList.remove('open');
        syncExploreActiveState();
      }, 150);
    });
  }

  // 2. Notifications Bell click toggle
  if (notifTrigger && notifDropdown) {
    notifTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = notifDropdown.style.display !== 'none' && notifDropdown.classList.contains('show');
      if (isVisible) {
        notifDropdown.style.display = 'none';
        notifDropdown.classList.remove('show');
      } else {
        notifDropdown.style.display = 'flex';
        notifDropdown.classList.add('show');
        if (typeof window.loadNotifications === 'function') {
          window.loadNotifications();
        }
        if (exploreMenu) {
          exploreMenu.classList.remove('show');
          if (exploreDropdown) exploreDropdown.classList.remove('open');
          syncExploreActiveState();
        }
        if (userDropdownCard) {
          userDropdownCard.style.display = 'none';
          userDropdownCard.classList.remove('show');
          if (userProfileTrigger) userProfileTrigger.setAttribute('aria-expanded', 'false');
        }
      }
    });
  }

  // 3. User Profile Dropdown
  if (userProfileTrigger && userDropdownCard) {
    userProfileTrigger.setAttribute('aria-haspopup', 'true');
    userProfileTrigger.setAttribute('aria-expanded', 'false');
    userProfileTrigger.setAttribute('aria-controls', 'user-dropdown-card');

    userProfileTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = userDropdownCard.classList.contains('show') || userDropdownCard.style.display === 'block';
      if (isVisible) {
        userDropdownCard.classList.remove('show');
        userDropdownCard.style.display = 'none';
        userProfileTrigger.setAttribute('aria-expanded', 'false');
      } else {
        userDropdownCard.classList.add('show');
        userDropdownCard.style.display = 'block';
        userProfileTrigger.setAttribute('aria-expanded', 'true');
        if (exploreMenu) {
          exploreMenu.classList.remove('show');
          if (exploreDropdown) exploreDropdown.classList.remove('open');
          syncExploreActiveState();
        }
        if (notifDropdown) {
          notifDropdown.style.display = 'none';
          notifDropdown.classList.remove('show');
        }
      }
    });

    userDropdownCard.querySelectorAll('.user-dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        userDropdownCard.classList.remove('show');
        userDropdownCard.style.display = 'none';
        userProfileTrigger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // Admin direct button
  const btnAdminDirect = document.getElementById('btn-admin-direct');
  if (btnAdminDirect) {
    btnAdminDirect.addEventListener('click', (e) => {
      e.preventDefault();
      if (userDropdownCard) {
        userDropdownCard.classList.remove('show');
        userDropdownCard.style.display = 'none';
      }
      if (userProfileTrigger) userProfileTrigger.setAttribute('aria-expanded', 'false');
      window.location.hash = '#/admin';
    });
  }

  // Switch profile button
  const btnSwitchProf = document.getElementById('btn-switch-profile');
  if (btnSwitchProf) {
    btnSwitchProf.addEventListener('click', (e) => {
      e.preventDefault();
      if (userDropdownCard) {
        userDropdownCard.classList.remove('show');
        userDropdownCard.style.display = 'none';
      }
      if (userProfileTrigger) userProfileTrigger.setAttribute('aria-expanded', 'false');
      window.location.hash = '#/profiles';
    });
  }

  // 4. Close menus when clicking outside
  document.addEventListener('click', (e) => {
    if (exploreDropdown && !exploreDropdown.contains(e.target)) {
      if (exploreMenu) exploreMenu.classList.remove('show');
      if (exploreDropdown) exploreDropdown.classList.remove('open');
      syncExploreActiveState();
    }
    if (notifContainer && !notifContainer.contains(e.target)) {
      if (notifDropdown) {
        notifDropdown.style.display = 'none';
        notifDropdown.classList.remove('show');
      }
    }
    if (userAccountContainer && !userAccountContainer.contains(e.target)) {
      if (userDropdownCard) {
        userDropdownCard.classList.remove('show');
        userDropdownCard.style.display = 'none';
        if (userProfileTrigger) userProfileTrigger.setAttribute('aria-expanded', 'false');
      }
    }
  });

  // 5. Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (exploreMenu) {
        exploreMenu.classList.remove('show');
        if (exploreDropdown) exploreDropdown.classList.remove('open');
        syncExploreActiveState();
      }
      if (notifDropdown) {
        notifDropdown.style.display = 'none';
        notifDropdown.classList.remove('show');
      }
      if (userDropdownCard) {
        userDropdownCard.classList.remove('show');
        userDropdownCard.style.display = 'none';
        if (userProfileTrigger) userProfileTrigger.setAttribute('aria-expanded', 'false');
      }
    }
  });

  // Re-create lucide icons
  if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

export function switchAdminSubView(targetId) {
  const subviews = [
    'admin-sub-overview',
    'admin-sub-import',
    'admin-sub-library',
    'admin-sub-staging',
    'admin-sub-console'
  ];

  const target = targetId || 'admin-sub-overview';

  // 1. Update active tab button
  const navItems = document.querySelectorAll('.admin-nav-item');
  navItems.forEach(btn => {
    if (btn.getAttribute('data-target') === target) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // 2. Hide all subviews, show selected
  subviews.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id === target) {
        el.style.display = 'block';
        el.classList.add('active');
      } else {
        el.style.display = 'none';
        el.classList.remove('active');
      }
    }
  });

  // 3. Lifecycle & data loading per subview
  if (target === 'admin-sub-overview') {
    stopAdminLogsPolling();
    startAdminStatsPolling();
  } else if (target === 'admin-sub-staging') {
    stopAdminStatsPolling();
    stopAdminLogsPolling();
    loadStagedImports();
  } else if (target === 'admin-sub-import') {
    stopAdminStatsPolling();
    stopAdminLogsPolling();
    initImportForm();
  } else if (target === 'admin-sub-library') {
    stopAdminStatsPolling();
    stopAdminLogsPolling();
    loadAdminPanel();
  } else if (target === 'admin-sub-console') {
    stopAdminStatsPolling();
    startAdminLogsPolling();
  }

  // Refresh Lucide icons in newly visible view
  if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

if (typeof window !== 'undefined') {
  window.switchAdminSubView = switchAdminSubView;
}

export function stopAdminPolling() {
  stopAdminStatsPolling();
  stopAdminLogsPolling();
}

export function initAdminSidebar() {
  const navItems = document.querySelectorAll('.admin-nav-item');

  navItems.forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('data-target');
      switchAdminSubView(targetId);
    };
  });

  // Activate currently highlighted tab or default to overview tab
  const currentActive = document.querySelector('.admin-nav-item.active');
  const targetId = currentActive ? currentActive.getAttribute('data-target') : 'admin-sub-overview';
  switchAdminSubView(targetId);

  // Setup Admin Action Buttons
  setupAdminActionButtons();
}

async function runLibraryScan(btn, endpoint) {
  if (btn.disabled) return;
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Escaneando biblioteca...';
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      window.showToast?.(`Escaneo completado: ${data.shows_count ?? 0} títulos, ${data.scanned_count ?? 0} archivos`, 'success');
      fetchAdminStats();
    } else {
      window.showToast?.(data.error || 'No se pudo escanear la biblioteca', 'error');
    }
  } catch {
    window.showToast?.('Error de red al escanear la biblioteca', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

function setupAdminActionButtons() {
  // Library scan / repair (both re-index the media folders and fix stale paths)
  const btnScan = document.getElementById('btn-scan-library');
  const btnRepair = document.getElementById('btn-repair-server');
  if (btnScan) btnScan.onclick = () => runLibraryScan(btnScan, '/api/admin/scan');
  if (btnRepair) btnRepair.onclick = () => runLibraryScan(btnRepair, '/api/admin/repair-library');

  // Display Power Control
  const btnOff = document.getElementById('btn-display-off');
  const btnOn = document.getElementById('btn-display-on');
  if (btnOff) btnOff.onclick = () => toggleLaptopDisplayPower('off');
  if (btnOn) btnOn.onclick = () => toggleLaptopDisplayPower('on');

  // Staging Refresh Button
  const btnRefreshStaging = document.getElementById('btn-refresh-staging');
  if (btnRefreshStaging) btnRefreshStaging.onclick = loadStagedImports;

  // Console Clear Logs
  const btnClearLogs = document.getElementById('btn-clear-logs');
  if (btnClearLogs) btnClearLogs.onclick = clearConsoleLogs;

  // Show Rename and Scrape Cover Modal Buttons
  const btnSaveTitle = document.getElementById('btn-save-show-title');
  const btnScrapeCover = document.getElementById('btn-scrape-show-cover');
  const showIdInput = document.getElementById('edit-show-id');
  const showTitleInput = document.getElementById('edit-show-title-input');

  if (btnSaveTitle) {
    btnSaveTitle.onclick = () => {
      if (showIdInput && showTitleInput) {
        const statusSelect = document.getElementById('edit-show-status-select');
        saveShowTitleAndStatus(showIdInput.value, showTitleInput.value, statusSelect ? statusSelect.value : '');
      }
    };
  }

  // Library: re-detect airing/finished for every show from TMDB (the button had no handler)
  const btnSyncStatuses = document.getElementById('btn-sync-all-statuses');
  if (btnSyncStatuses) {
    btnSyncStatuses.onclick = async () => {
      btnSyncStatuses.disabled = true;
      try {
        const res = await fetch('/api/admin/sync-statuses', { method: 'POST', headers: getAuthHeaders() });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          const n = Array.isArray(data.updated) ? data.updated.length : (data.updated_count ?? null);
          alert(n === null ? 'Estados sincronizados con TMDB.' : `Estados sincronizados con TMDB (${n} actualizados).`);
          loadAdminPanel();
        } else {
          alert('Error al sincronizar estados: ' + (data.error || res.status));
        }
      } catch (err) {
        alert('Error de red: ' + err.message);
      } finally {
        btnSyncStatuses.disabled = false;
      }
    };
  }

  // Branding: custom header logo upload / reset (both controls had no handler)
  const logoZone = document.getElementById('logo-drop-zone');
  const logoInput = document.getElementById('logo-file-input');
  const uploadLogo = async (file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    const headers = getAuthHeaders();
    delete headers['Content-Type'];
    try {
      const res = await fetch('/api/admin/upload-logo', { method: 'POST', headers, body: formData });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        refreshHeaderLogo();
        alert('Logotipo actualizado.');
      } else {
        alert('Error al subir el logotipo: ' + (data.error || res.status));
      }
    } catch (err) {
      alert('Error de red: ' + err.message);
    } finally {
      if (logoInput) logoInput.value = '';
    }
  };
  if (logoZone && logoInput) {
    logoZone.onclick = () => logoInput.click();
    logoInput.onchange = () => uploadLogo(logoInput.files && logoInput.files[0]);
    logoZone.ondragover = (e) => { e.preventDefault(); logoZone.classList.add('dragover'); };
    logoZone.ondragleave = () => logoZone.classList.remove('dragover');
    logoZone.ondrop = (e) => {
      e.preventDefault();
      logoZone.classList.remove('dragover');
      uploadLogo(e.dataTransfer.files && e.dataTransfer.files[0]);
    };
  }
  const btnResetLogo = document.getElementById('btn-reset-logo');
  if (btnResetLogo) {
    btnResetLogo.onclick = async () => {
      if (!confirm('¿Restablecer el logotipo original de KuraStream?')) return;
      try {
        const res = await fetch('/api/admin/reset-logo', { method: 'POST', headers: getAuthHeaders() });
        if (res.ok) {
          refreshHeaderLogo();
          alert('Logotipo restablecido.');
        } else {
          alert('Error al restablecer el logotipo.');
        }
      } catch (err) {
        alert('Error de red: ' + err.message);
      }
    };
  }
  if (btnScrapeCover) {
    btnScrapeCover.onclick = () => {
      if (showIdInput) scrapeShowCover(showIdInput.value);
    };
  }
}

/** Reloads the header logo after an upload/reset (cache-busted so the new image shows at once). */
function refreshHeaderLogo() {
  const img = document.getElementById('custom-logo');
  const fallback = document.getElementById('fallback-logo');
  if (!img) return;
  img.style.display = '';
  if (fallback) fallback.style.display = 'none';
  img.src = `/library/logo.png?t=${Date.now()}`;
}
