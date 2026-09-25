/**
 * KuraStream v2.0 - Canonical Application Entry Point
 * Orchestrates modular architecture, client routing, catalog rendering, and player lifecycle.
 */

import { appRouter } from './core/router.js';
import { AuthManager } from './core/auth.js';
import { appState } from './core/state.js';
import { renderIcons, showToast } from './core/ui.js';
import {
  renderBillboardHero,
  renderContinueWatching,
  createShowCardHTML,
  loadCatalogData,
  attachCatalogEventListeners
} from './features/catalog/catalog.js';
import { loadAndRenderShowDetail } from './features/show-detail/detail.js';
import { loadWatchHistory } from './features/history/history.js';
import { fetchSystemHealth, triggerLibraryScan } from './features/admin/admin.js';
import { initCardPopovers } from './modules/card_popover_preview.js';

// Expose minimal global bridge for legacy inline templates
if (typeof window !== 'undefined') {
  window.KuraStream = {
    auth: AuthManager,
    state: appState,
    router: appRouter,
    showToast,
    triggerLibraryScan
  };
}

async function initCatalogView() {
  const catalogView = document.getElementById('view-catalog') || document.getElementById('catalog-container');
  const heroContainer = document.getElementById('hero-banner') || document.getElementById('hero-container');
  const continueContainer = document.getElementById('continue-watching-section');
  const showsGrid = document.getElementById('shows-grid') || document.getElementById('catalog-grid');

  const { shows, continueWatching } = await loadCatalogData();

  if (heroContainer && shows.length > 0) {
    const featured = shows.find(s => s.is_featured) || shows[0];
    heroContainer.innerHTML = renderBillboardHero(featured);
  }

  if (continueContainer) {
    continueContainer.innerHTML = renderContinueWatching(continueWatching);
  }

  if (showsGrid) {
    showsGrid.innerHTML = shows.map(s => createShowCardHTML(s)).join('');
  }

  if (catalogView) {
    attachCatalogEventListeners(catalogView);
  }

  renderIcons();
  try { initCardPopovers(); } catch {}
}

// Router configuration
appRouter
  .on('/', async () => {
    hideAllViews();
    const catalogView = document.getElementById('view-catalog');
    if (catalogView) catalogView.style.display = 'block';
    await initCatalogView();
  })
  .on('/show/:id', async ({ params }) => {
    hideAllViews();
    const detailView = document.getElementById('view-show-detail');
    if (detailView) {
      detailView.style.display = 'block';
      await loadAndRenderShowDetail(params.id, detailView);
    }
  })
  .on('/history', async () => {
    hideAllViews();
    const historyView = document.getElementById('history-view');
    if (historyView) {
      historyView.style.display = 'block';
      const historyList = document.getElementById('history-list');
      if (historyList) await loadWatchHistory(historyList);
    }
  })
  .on('/admin', async () => {
    hideAllViews();
    const adminView = document.getElementById('view-admin');
    if (adminView) {
      adminView.style.display = 'flex';
      const health = await fetchSystemHealth();
      console.log('[Admin] System Health:', health);
    }
  });

function hideAllViews() {
  const views = document.querySelectorAll('.app-view, .view-section');
  views.forEach(v => { v.style.display = 'none'; });
}

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('[KuraStream] v2.0 Platform initialized successfully.');
  appRouter.start();
  renderIcons();
});
