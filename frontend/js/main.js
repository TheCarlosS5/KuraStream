/**
 * KuraStream - Main Entry Point (ES Module)
 * Initializes router, authentication, catalog, and binds all functions to window for inline HTML onclick handlers.
 */

import { getAuthToken, getAuthHeaders, openAdminLoginModal, closeAdminLoginModal, loginAdmin } from './modules/auth.js';
import { initRouter, initAdminSidebar, updateActiveNavHighlight, initHeaderDropdowns } from './modules/navigation.js';
import { loadShowsCatalog, loadShowDetail } from './modules/catalog.js';
import { startAdminStatsPolling, stopAdminStatsPolling, fetchAdminStats, fetchDisplayStatus, toggleLaptopDisplayPower } from './modules/admin_status.js';
import { loadStagedImports, publishStagedItem, deleteStagedItem } from './modules/admin_staging.js';
import { loadAdminPanel, openMediaEditor, updateShowTitle, scrapeShowCover, deleteShow } from './modules/admin_library.js';
import { startTorrentStatusPolling, stopTorrentStatusPolling, fetchTorrentStatus, executeTorrentSearch, startTorrentQueue, clearTorrentQueue, cancelActiveDownload } from './modules/admin_torrents.js';
import { initImportForm, executeFolderScan, previewTMDBMetadata, submitShowImport } from './modules/admin_import.js';
import { startAdminLogsPolling, stopAdminLogsPolling, fetchServerLogs, clearConsoleLogs } from './modules/admin_console.js';

// Bind all module functions to window object for inline HTML onclick compatibility
if (typeof window !== 'undefined') {
  window.getAuthToken = getAuthToken;
  window.getAuthHeaders = getAuthHeaders;
  window.openAdminLoginModal = openAdminLoginModal;
  window.closeAdminLoginModal = closeAdminLoginModal;
  window.loginAdmin = loginAdmin;

  window.initRouter = initRouter;
  window.initAdminSidebar = initAdminSidebar;
  window.updateActiveNavHighlight = updateActiveNavHighlight;
  window.initHeaderDropdowns = initHeaderDropdowns;

  window.loadShowsCatalog = loadShowsCatalog;
  window.loadShowDetail = loadShowDetail;

  window.startAdminStatsPolling = startAdminStatsPolling;
  window.stopAdminStatsPolling = stopAdminStatsPolling;
  window.fetchAdminStats = fetchAdminStats;
  window.fetchDisplayStatus = fetchDisplayStatus;
  window.toggleLaptopDisplayPower = toggleLaptopDisplayPower;

  window.loadStagedImports = loadStagedImports;
  window.publishStagedItem = publishStagedItem;
  window.deleteStagedItem = deleteStagedItem;

  window.loadAdminPanel = loadAdminPanel;
  window.openMediaEditor = openMediaEditor;
  window.updateShowTitle = updateShowTitle;
  window.scrapeShowCover = scrapeShowCover;
  window.deleteShow = deleteShow;

  window.startTorrentStatusPolling = startTorrentStatusPolling;
  window.stopTorrentStatusPolling = stopTorrentStatusPolling;
  window.fetchTorrentStatus = fetchTorrentStatus;
  window.executeTorrentSearch = executeTorrentSearch;
  window.startTorrentQueue = startTorrentQueue;
  window.clearTorrentQueue = clearTorrentQueue;
  window.cancelActiveDownload = cancelActiveDownload;

  window.initImportForm = initImportForm;
  window.executeFolderScan = executeFolderScan;
  window.previewTMDBMetadata = previewTMDBMetadata;
  window.submitShowImport = submitShowImport;

  window.startAdminLogsPolling = startAdminLogsPolling;
  window.stopAdminLogsPolling = stopAdminLogsPolling;
  window.fetchServerLogs = fetchServerLogs;
  window.clearConsoleLogs = clearConsoleLogs;
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[KuraStream] Initializing Modular Frontend System...');

    // Initialize Router
    initRouter();

    // Admin Login Form Handler
    const adminLoginForm = document.getElementById('admin-login-form');
    const btnCloseModal = document.getElementById('btn-close-admin-login-modal');

    if (btnCloseModal) {
      btnCloseModal.addEventListener('click', closeAdminLoginModal);
    }

    if (adminLoginForm) {
      adminLoginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const usernameInput = document.getElementById('admin-login-username');
        const passwordInput = document.getElementById('admin-login-password');
        const errorMsg = document.getElementById('admin-login-error');

        const username = usernameInput ? usernameInput.value.trim() : 'TheCarlosS5';
        const password = passwordInput ? passwordInput.value : '';

        if (!password) {
          if (errorMsg) {
            errorMsg.style.display = 'block';
            errorMsg.textContent = 'Por favor, ingresa la contraseña.';
          }
          return;
        }

        const result = await loginAdmin(username, password);
        if (result.success) {
          if (errorMsg) errorMsg.style.display = 'none';
          location.hash = '#/admin';
          initRouter();
        } else {
          if (errorMsg) {
            errorMsg.style.display = 'block';
            errorMsg.textContent = result.error;
          }
        }
      });
    }

    // Admin Panel Link Button
    const btnAdminLink = document.getElementById('btn-admin-panel-link');
    if (btnAdminLink) {
      btnAdminLink.addEventListener('click', () => {
        location.hash = '#/admin';
      });
    }
  });
}
