/**
 * KuraStream - Navigation & Router Module
 * Handles active nav highlight, header dropdowns (explore, notifications, user profile),
 * and Admin sidebar sub-view switching.
 */

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

// The administration panel is a separate chunk (modules/admin_sidebar.js): regular viewers never download it.
let adminPanel = null;

export async function initAdminSidebar() {
  adminPanel = adminPanel || await import('./admin_sidebar.js');
  adminPanel.initAdminSidebar();
}

export function stopAdminPolling() {
  if (adminPanel) adminPanel.stopAdminPolling();
}
