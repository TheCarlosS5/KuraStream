/**
 * KuraStream - Navigation & Router Module
 * Handles hash routing (#/, #/show/:id, #/admin) and Admin sidebar sub-view switching.
 */

import { startAdminStatsPolling, stopAdminStatsPolling, toggleLaptopDisplayPower } from './admin_status.js';
import { loadStagedImports } from './admin_staging.js';
import { loadAdminPanel, updateShowTitle, scrapeShowCover } from './admin_library.js';
import { startTorrentStatusPolling, stopTorrentStatusPolling, executeTorrentSearch, startTorrentQueue, clearTorrentQueue, cancelActiveDownload } from './admin_torrents.js';
import { initImportForm } from './admin_import.js';
import { startAdminLogsPolling, stopAdminLogsPolling, clearConsoleLogs } from './admin_console.js';
import { loadShowsCatalog, loadShowDetail } from './catalog.js';

export function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
  initHeaderDropdowns();
}

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
  }
}

export function initHeaderDropdowns() {
  const exploreDropdown = document.getElementById('nav-explore-dropdown');
  const exploreTrigger = document.getElementById('nav-explore-trigger');
  const exploreMenu = document.getElementById('nav-explore-menu');

  const notifContainer = document.getElementById('notifications-container');
  const notifTrigger = document.getElementById('btn-notifications-trigger');
  const notifDropdown = document.getElementById('notifications-dropdown');

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

  // Explore Dropdown click toggle
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
      }
    });

    // Close explore dropdown on item selection
    exploreMenu.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        exploreMenu.classList.remove('show');
        if (exploreDropdown) exploreDropdown.classList.remove('open');
        syncExploreActiveState();
      });
    });
  }

  // Explore Dropdown hover toggle
  if (exploreDropdown && exploreMenu) {
    exploreDropdown.addEventListener('mouseenter', () => {
      exploreMenu.classList.add('show');
      exploreDropdown.classList.add('open');
      if (exploreTrigger) exploreTrigger.classList.add('active');
    });
    exploreDropdown.addEventListener('mouseleave', () => {
      exploreMenu.classList.remove('show');
      exploreDropdown.classList.remove('open');
      syncExploreActiveState();
    });
  }

  // Notifications Bell click toggle
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
        if (exploreMenu) {
          exploreMenu.classList.remove('show');
          if (exploreDropdown) exploreDropdown.classList.remove('open');
          syncExploreActiveState();
        }
      }
    });
  }

  // Close menus when clicking outside
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
  });

  // Re-create lucide icons
  if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

function handleRoute() {
  const hash = location.hash || '#/';
  const appView = document.getElementById('view-catalog');
  const detailView = document.getElementById('view-show-detail');
  const adminView = document.getElementById('view-admin');

  // Update active navbar route highlights
  updateActiveNavHighlight(hash);

  // Stop background polling routines when leaving admin
  if (!hash.startsWith('#/admin')) {
    stopAdminStatsPolling();
    stopTorrentStatusPolling();
    stopAdminLogsPolling();
  }

  if (hash.startsWith('#/show/')) {
    const showId = hash.replace('#/show/', '');
    if (appView) appView.style.display = 'none';
    if (adminView) adminView.style.display = 'none';
    if (detailView) {
      detailView.style.display = 'block';
      loadShowDetail(showId);
    }
  } else if (hash.startsWith('#/admin')) {
    if (appView) appView.style.display = 'none';
    if (detailView) detailView.style.display = 'none';
    if (adminView) {
      adminView.style.display = 'flex';
      initAdminSidebar();
    }
  } else {
    // Default Home Catalog view
    if (detailView) detailView.style.display = 'none';
    if (adminView) adminView.style.display = 'none';
    if (appView) {
      appView.style.display = 'block';
      loadShowsCatalog();
    }
  }
}

export function initAdminSidebar() {
  const navItems = document.querySelectorAll('.admin-nav-item');
  const subViews = document.querySelectorAll('.admin-sub-view');

  const activateSubView = (targetId, btn) => {
    navItems.forEach(item => item.classList.remove('active'));
    subViews.forEach(view => view.classList.remove('active'));

    if (btn) btn.classList.add('active');

    // Handle exact HTML ID mappings and legacy targets
    let resolvedId = targetId;
    if (targetId === 'admin-sub-overview') resolvedId = 'admin-sub-status';

    const targetView = document.getElementById(resolvedId);
    if (targetView) targetView.classList.add('active');

    // Stop previous sub-view pollers
    stopAdminStatsPolling();
    stopTorrentStatusPolling();
    stopAdminLogsPolling();

    // Trigger exact loader for each admin sub-view
    if (resolvedId === 'admin-sub-status') {
      startAdminStatsPolling();
    } else if (resolvedId === 'admin-sub-staging') {
      loadStagedImports();
    } else if (resolvedId === 'admin-sub-library') {
      loadAdminPanel();
    } else if (resolvedId === 'admin-sub-torrents') {
      startTorrentStatusPolling();
    } else if (resolvedId === 'admin-sub-import') {
      initImportForm();
    } else if (resolvedId === 'admin-sub-console') {
      startAdminLogsPolling();
    }
  };

  navItems.forEach(btn => {
    btn.onclick = () => {
      const targetId = btn.getAttribute('data-target');
      activateSubView(targetId, btn);
    };
  });

  // Activate currently highlighted tab or default to status tab
  const currentActive = document.querySelector('.admin-nav-item.active');
  if (currentActive) {
    activateSubView(currentActive.getAttribute('data-target'), currentActive);
  } else if (navItems.length > 0) {
    activateSubView(navItems[0].getAttribute('data-target'), navItems[0]);
  }

  // Setup Admin Action Buttons
  setupAdminActionButtons();
}

function setupAdminActionButtons() {
  // Display Power Control
  const btnOff = document.getElementById('btn-display-off');
  const btnOn = document.getElementById('btn-display-on');
  if (btnOff) btnOff.onclick = () => toggleLaptopDisplayPower('off');
  if (btnOn) btnOn.onclick = () => toggleLaptopDisplayPower('on');

  // Torrent Manager Actions
  const btnSearchTorrents = document.getElementById('btn-search-torrents');
  const torrentSearchInput = document.getElementById('torrent-search-input');
  if (btnSearchTorrents) btnSearchTorrents.onclick = executeTorrentSearch;
  if (torrentSearchInput) {
    torrentSearchInput.onkeydown = (e) => {
      if (e.key === 'Enter') executeTorrentSearch();
    };
  }

  const btnStartQueue = document.getElementById('btn-start-download-queue');
  const btnClearQueue = document.getElementById('btn-clear-download-queue');
  const btnCancelActive = document.getElementById('btn-cancel-active-download');

  if (btnStartQueue) btnStartQueue.onclick = startTorrentQueue;
  if (btnClearQueue) btnClearQueue.onclick = clearTorrentQueue;
  if (btnCancelActive) btnCancelActive.onclick = cancelActiveDownload;

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
        updateShowTitle(showIdInput.value, showTitleInput.value);
      }
    };
  }
  if (btnScrapeCover) {
    btnScrapeCover.onclick = () => {
      if (showIdInput) scrapeShowCover(showIdInput.value);
    };
  }
}
