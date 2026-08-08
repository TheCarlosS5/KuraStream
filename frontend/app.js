import { initPlayer, destroyPlayer } from './player.js?v=1.5';

const originalFetch = window.fetch;
window.fetch = function(input, options = {}) {
  let url = input;
  if (input instanceof Request) {
    url = input.url;
  } else if (input instanceof URL) {
    url = input.toString();
  }
  
  const urlStr = typeof url === 'string' ? url : '';
  const isApiTarget = urlStr.includes('/api/');
  
  if (isApiTarget) {
    // Determine active token (user session token or fallback to admin token)
    const sessionStr = localStorage.getItem('kura_user_session');
    let token = null;
    if (sessionStr) {
      try {
        const session = JSON.parse(sessionStr);
        token = session ? session.token : null;
      } catch(e) {}
    }
    if (!token) {
      token = localStorage.getItem('adminToken') || localStorage.getItem('kura_admin_token');
    }

    if (token) {
      if (input instanceof Request) {
        input.headers.set('Authorization', `Bearer ${token}`);
      } else {
        options.headers = options.headers || {};
        if (options.headers instanceof Headers) {
          options.headers.set('Authorization', `Bearer ${token}`);
        } else if (Array.isArray(options.headers)) {
          const authIdx = options.headers.findIndex(h => h[0].toLowerCase() === 'authorization');
          if (authIdx !== -1) options.headers[authIdx][1] = `Bearer ${token}`;
          else options.headers.push(['Authorization', `Bearer ${token}`]);
        } else {
          options.headers['Authorization'] = `Bearer ${token}`;
        }
      }
    }
  }
  return originalFetch(input, options);
};

// Chameleon UI Engine
function applyChameleonTheme(imgElement) {
  if (!imgElement || !imgElement.complete) return;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 10;
  canvas.height = 10;
  try {
    ctx.drawImage(imgElement, 0, 0, 10, 10);
    const data = ctx.getImageData(0, 0, 10, 10).data;
    let r = 0, g = 0, b = 0, count = 0;
    
    // Pick the most vivid color by filtering out greys/blacks/whites
    for (let i = 0; i < data.length; i += 4) {
      const cr = data[i], cg = data[i+1], cb = data[i+2];
      const max = Math.max(cr, cg, cb);
      const min = Math.min(cr, cg, cb);
      // Filter out low saturation or extreme brightness
      if ((max - min) > 30 && max > 50 && max < 250) {
        r += cr; g += cg; b += cb;
        count++;
      }
    }
    
    if (count > 0) {
      r = Math.floor(r / count);
      g = Math.floor(g / count);
      b = Math.floor(b / count);
    } else {
      // Fallback if image is entirely greyscale
      r = data[0]; g = data[1]; b = data[2];
    }
    
    const root = document.documentElement.style;
    const accentColor = `rgb(${r}, ${g}, ${b})`;
    // slightly lighter for hover
    const accentHover = `rgb(${Math.min(255, r + 40)}, ${Math.min(255, g + 40)}, ${Math.min(255, b + 40)})`;
    const accentGlow = `rgba(${r}, ${g}, ${b}, 0.5)`;
    
    root.setProperty('--accent-color', accentColor);
    root.setProperty('--accent-hover', accentHover);
    root.setProperty('--accent-glow', accentGlow);
  } catch (e) {
    console.warn("Chameleon extraction failed", e);
  }
}

function resetChameleonTheme() {
  const root = document.documentElement.style;
  root.removeProperty('--accent-color');
  root.removeProperty('--accent-hover');
  root.removeProperty('--accent-glow');
}

// Time formatting helpers
function formatSecondsToMMSS(seconds) {
  if (seconds === null || seconds === undefined || isNaN(seconds) || seconds === '') return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function parseMMSSToSeconds(str) {
  if (str === null || str === undefined || typeof str !== 'string' || !str.trim()) return null;
  const parts = str.split(':');
  if (parts.length === 1) {
    const val = parseFloat(parts[0]);
    return isNaN(val) ? null : val;
  }
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10);
    const s = parseFloat(parts[1]);
    if (isNaN(m) || isNaN(s)) return null;
    return m * 60 + s;
  }
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const s = parseFloat(parts[2]);
    if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
    return h * 3600 + m * 60 + s;
  }
  return null;
}

// Global state
let currentView = 'dashboard';
let currentShowEpisodes = [];
let clickCount = 0;
let clickTimeout = null;
let adminPollInterval = null;
let adminLogsInterval = null;
let carouselInterval = null;
let currentShowsPage = 1;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  setupRouter();
  setupEasterEgg();
  setupForms();
  setupSettingsView();
  setupUserAuth();
  setupCommunityChat();
  initCustomCursor();

  // Add search and filter listeners
  const sInput = document.getElementById('search-input');
  const gFilter = document.getElementById('genre-filter');
  if (sInput) {
    sInput.addEventListener('input', () => {
      const mediaType = window.location.hash === '#/movies' ? 'movie' : 'anime';
      currentShowsPage = 1;
      loadDashboard(mediaType);
    });
  }
  if (gFilter) {
    gFilter.addEventListener('change', () => {
      const mediaType = window.location.hash === '#/movies' ? 'movie' : 'anime';
      currentShowsPage = 1;
      loadDashboard(mediaType);
    });
  }
});

// ROUTER
function setupRouter() {
  const handleRoute = () => {
    updateMosaicBgVisibility();
    const sessionStr = localStorage.getItem('kura_user_session');
    if (!sessionStr) {
      const loginModal = document.getElementById('login-modal');
      if (loginModal) loginModal.style.display = 'flex';
    }

    const hash = window.location.hash || '#/';

    // Default main header visibility for logged-in users
    const mainHeader = document.querySelector('.app-header');
    if (mainHeader && !hash.startsWith('#/player/')) {
      mainHeader.style.display = 'flex';
    }
    
    // Stop player when leaving player view
    if (currentView === 'player') {
      destroyPlayer();
      if (mainHeader) mainHeader.style.display = 'flex';
    }

    // Stop intervals when leaving admin view
    if (currentView === 'admin') {
      stopAdminPolling();
    }

    // Reset theme
    if (!hash.startsWith('#/show/')) {
      resetChameleonTheme();
    }

    // Stop background trailers, modals and local loop videos when leaving show details view
    if (!hash.startsWith('#/show/')) {
      // 1. YouTube background trailer
      const bgYoutubeIframe = document.getElementById('detail-bg-youtube-iframe');
      const bgYoutubeContainer = document.getElementById('detail-bg-youtube-container');
      if (bgYoutubeIframe) bgYoutubeIframe.src = '';
      if (bgYoutubeContainer) bgYoutubeContainer.style.display = 'none';

      // 2. Local background video loop
      const bgVideo = document.getElementById('detail-bg-video');
      if (bgVideo) {
        bgVideo.pause();
        bgVideo.removeAttribute('src');
        bgVideo.load();
        bgVideo.onplaying = null;
        bgVideo.onended = null;
      }

      // 3. YouTube trailer modal
      const trailerModal = document.getElementById('trailer-modal');
      const trailerIframe = document.getElementById('trailer-iframe');
      if (trailerModal) trailerModal.style.display = 'none';
      if (trailerIframe) trailerIframe.src = '';
    }

    // Hide all views
    document.querySelectorAll('.app-view').forEach(view => {
      view.classList.remove('active');
    });

    const searchInputEl = document.getElementById('search-input');
    const genreFilterEl = document.getElementById('genre-filter');

    // If profile switcher is active ("¿Quién está viendo?"), preserve it and do not override with dashboard
    const profileSwitcherView = document.getElementById('profile-switcher-view');
    if (profileSwitcherView && profileSwitcherView.classList.contains('active')) {
      return;
    }

    if (hash === '#/' || hash === '') {
      currentView = 'dashboard';
      currentShowsPage = 1;
      if (searchInputEl) searchInputEl.value = '';
      if (genreFilterEl) genreFilterEl.value = 'all';
      document.getElementById('dashboard-view').classList.add('active');
      document.getElementById('nav-home').classList.add('active');
      document.getElementById('nav-movies').classList.remove('active');
      document.getElementById('nav-settings').classList.remove('active');
      loadDashboard('anime');
      initDashboardMosaic();
    } else if (hash === '#/movies') {
      currentView = 'dashboard';
      currentShowsPage = 1;
      if (searchInputEl) searchInputEl.value = '';
      if (genreFilterEl) genreFilterEl.value = 'all';
      document.getElementById('dashboard-view').classList.add('active');
      document.getElementById('nav-home').classList.remove('active');
      document.getElementById('nav-movies').classList.add('active');
      document.getElementById('nav-settings').classList.remove('active');
      loadDashboard('movie');
      initDashboardMosaic();
    } else if (hash.startsWith('#/show/')) {
      currentView = 'detail';
      const id = hash.split('/').pop();
      document.getElementById('detail-view').classList.add('active');
      loadShowDetails(id);
    } else if (hash.startsWith('#/player/')) {
      currentView = 'player';
      const id = hash.split('/').pop();
      document.querySelector('.app-header').style.display = 'none';
      document.getElementById('player-view').classList.add('active');
      initPlayer(id);
    } else if (hash === '#/admin') {
      if (!isAdmin()) {
        window.location.hash = '#/';
        showPinPrompt();
        return;
      }
      currentView = 'admin';
      document.getElementById('admin-view').classList.add('active');
      loadAdminPanel();
    } else if (hash === '#/settings') {
      currentView = 'settings';
      document.getElementById('nav-home').classList.remove('active');
      document.getElementById('nav-movies').classList.remove('active');
      document.getElementById('nav-settings').classList.add('active');
      document.getElementById('settings-view').classList.add('active');
      loadSettingsView();
    }

    // Toggle community chat widget visibility (only on dashboard view)
    const chatWidget = document.getElementById('community-chat-widget');
    if (chatWidget) {
      if (currentView === 'dashboard') {
        chatWidget.style.display = 'block';
      } else {
        chatWidget.style.display = 'none';
        // Force close chat card if it was open when navigating away
        const chatWindow = document.getElementById('chat-window-card');
        if (chatWindow) chatWindow.style.display = 'none';
        chatWindowOpen = false;
        if (chatPollInterval) {
          clearInterval(chatPollInterval);
          chatPollInterval = null;
        }
      }
    }

    // Toggle search/filters container visibility
    if (searchInputEl && searchInputEl.parentElement) {
      const searchWrapper = searchInputEl.parentElement.parentElement;
      if (searchWrapper) {
        if (currentView === 'dashboard') {
          searchWrapper.style.display = 'flex';
        } else {
          searchWrapper.style.display = 'none';
        }
      }
    }
  };

  // Click listeners for landing page buttons to trigger #login-modal
  const landingSigninBtn = document.getElementById('landing-signin-btn');
  const landingCtaStart = document.getElementById('landing-cta-start');
  const loginModal = document.getElementById('login-modal');

  if (landingSigninBtn && loginModal) {
    landingSigninBtn.addEventListener('click', () => {
      loginModal.style.display = 'flex';
      // Reset form fields
      const usernameInput = document.getElementById('login-username-input');
      const passwordInput = document.getElementById('login-password-input');
      const errorMsg = document.getElementById('login-error-msg');
      if (usernameInput) usernameInput.value = '';
      if (passwordInput) passwordInput.value = '';
      if (errorMsg) errorMsg.style.display = 'none';
      
      // Select the login tab
      const tabLogin = document.getElementById('tab-login');
      if (tabLogin) tabLogin.click();
    });
  }

  if (landingCtaStart && loginModal) {
    landingCtaStart.addEventListener('click', () => {
      loginModal.style.display = 'flex';
      // Reset form fields
      const usernameInput = document.getElementById('login-username-input');
      const passwordInput = document.getElementById('login-password-input');
      const errorMsg = document.getElementById('login-error-msg');
      if (usernameInput) usernameInput.value = '';
      if (passwordInput) passwordInput.value = '';
      if (errorMsg) errorMsg.style.display = 'none';

      // Select the register tab (since CTA is "Comenzar Ahora")
      const tabRegister = document.getElementById('tab-register');
      if (tabRegister) tabRegister.click();
    });
  }

  window.addEventListener('hashchange', handleRoute);
  handleRoute(); // Run initially
}

// EASTER EGG (Hidden Access to Admin)
function setupEasterEgg() {
  const logo = document.getElementById('header-logo');
  const overlay = document.getElementById('pin-modal-overlay');
  const usernameInput = document.getElementById('admin-username-input');
  const passwordInput = document.getElementById('admin-password-input');
  const submitBtn = document.getElementById('pin-submit');
  const cancelBtn = document.getElementById('pin-cancel');
  const errorText = document.getElementById('pin-error');

  logo.addEventListener('click', () => {
    clickCount++;
    clearTimeout(clickTimeout);
    
    clickTimeout = setTimeout(() => {
      clickCount = 0;
    }, 2000);

    if (clickCount >= 5) {
      clickCount = 0;
      showPinPrompt();
    }
  });

  const checkPin = async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    errorText.style.display = 'none';
    
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('adminToken', data.token);
        overlay.style.display = 'none';
        usernameInput.value = '';
        passwordInput.value = '';
        window.location.hash = '#/admin';
      } else {
        errorText.style.display = 'block';
        passwordInput.value = '';
        passwordInput.focus();
      }
    } catch (e) {
      console.error(e);
      errorText.textContent = 'Error de conexión';
      errorText.style.display = 'block';
    }
  };

  submitBtn.addEventListener('click', checkPin);
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') checkPin();
  });
  usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') passwordInput.focus();
  });

  cancelBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
    usernameInput.value = '';
    passwordInput.value = '';
  });
}

function showPinPrompt() {
  const overlay = document.getElementById('pin-modal-overlay');
  document.getElementById('pin-error').style.display = 'none';
  overlay.style.display = 'flex';
  document.getElementById('admin-username-input').focus();
}

function isAdmin() {
  const token = localStorage.getItem('adminToken') || localStorage.getItem('kura_admin_token');
  if (!token) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    let body = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (body.length % 4) {
      body += '=';
    }
    const payload = JSON.parse(atob(body));
    return payload.role === 'admin' && (!payload.exp || Date.now() < payload.exp);
  } catch (e) {
    return false;
  }
}

// DASHBOARD VIEW
async function loadDashboard(mediaType = 'anime') {
  const sectionsContainer = document.getElementById('dashboard-sections');
  sectionsContainer.innerHTML = renderSkeletonLoaders(2);

  try {
    // 1. Fetch all shows
    const res = await fetch('/api/shows');
    const allShows = await res.json();
    
    // Sort shows
    let animeShows = allShows.filter(s => s.media_type === 'anime');
    let movieShows = allShows.filter(s => s.media_type === 'movie');
    
    // Fetch watch history
    let history = [];
    let activeUser = 'guest';
    const sessionStr = localStorage.getItem('kura_user_session');
    if (sessionStr) {
      try { activeUser = JSON.parse(sessionStr).username; } catch(e) {}
    }
    try {
      const histRes = await fetch(`/api/history?username=${encodeURIComponent(activeUser)}`);
      history = await histRes.json();
    } catch(e) {
      console.warn("History fetch failed:", e);
    }

    const historyMap = new Map();
    history.forEach(item => {
      const existing = historyMap.get(String(item.show_id));
      if (!existing || new Date(item.updated_at || item.watched_at || 0) > new Date(existing.updated_at || existing.watched_at || 0)) {
        historyMap.set(String(item.show_id), item);
      }
    });

    // Fetch favorites
    let favorites = [];
    try {
      const favRes = await fetch(`/api/favorites?username=${encodeURIComponent(activeUser)}`);
      favorites = await favRes.json();
    } catch(e) {
      console.warn("Favorites fetch failed:", e);
    }
    
    if (allShows.length === 0) {
      sectionsContainer.innerHTML = `
        <div class="empty-state" style="text-align: center; padding: 60px; color: var(--text-muted);">
          <h2>Tu almacén de tesoros está vacío</h2>
          <p style="margin-top: 10px;">Haz clic 5 veces en el logotipo de KuraStream arriba a la izquierda para abrir el Panel de Administración e importar tus vídeos.</p>
        </div>`;
      return;
    }

     // Set Hero Carousel (up to 5 newest shows)
    const carouselContainer = document.getElementById('hero-carousel-container');
    const carouselWrapper = document.getElementById('hero-carousel-wrapper');
    const carouselIndicators = document.getElementById('carousel-indicators');
    
    // Filter active category shows (anime or movie)
    const categoryShows = allShows.filter(s => s.media_type === mediaType);
    
    // Extract unique genres dynamically from all shows for the current category
    const genresSet = new Set();
    categoryShows.forEach(s => {
      if (s.genres) {
        s.genres.split(',').forEach(g => {
          const clean = g.trim();
          if (clean) genresSet.add(clean);
        });
      }
    });

    // Populate the genre filter select element
    const genreFilterSelect = document.getElementById('genre-filter');
    const selectedGenre = (genreFilterSelect ? genreFilterSelect.value : 'all') || 'all';
    if (genreFilterSelect) {
      let genreOpts = '<option value="all">Todos los géneros</option>';
      Array.from(genresSet).sort().forEach(g => {
        genreOpts += `<option value="${g}" ${selectedGenre === g ? 'selected' : ''}>${g}</option>`;
      });
      genreFilterSelect.innerHTML = genreOpts;
    }

    // Apply search and genre filters
    const searchInput = document.getElementById('search-input');
    const searchQuery = (searchInput ? searchInput.value : '').trim().toLowerCase();

    let filteredCategoryShows = categoryShows;

    if (searchQuery) {
      filteredCategoryShows = filteredCategoryShows.filter(s => 
        s.title.toLowerCase().includes(searchQuery) || 
        (s.synopsis && s.synopsis.toLowerCase().includes(searchQuery))
      );
    }

    if (selectedGenre !== 'all') {
      filteredCategoryShows = filteredCategoryShows.filter(s => 
        s.genres && s.genres.split(',').map(g => g.trim()).includes(selectedGenre)
      );
    }

    if (filteredCategoryShows.length === 0 && (searchQuery || selectedGenre !== 'all')) {
      carouselContainer.style.display = 'none';
      sectionsContainer.innerHTML = `
        <div class="empty-state" style="text-align: center; padding: 60px; color: var(--text-muted);">
          <i data-lucide="search-code" style="width: 48px; height: 48px; color: var(--text-muted); margin-bottom: 12px; display: inline-block;"></i>
          <h2>No se encontraron resultados</h2>
          <p style="margin-top: 10px;">Prueba ajustando los términos de búsqueda o el filtro de géneros.</p>
        </div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }

    animeShows = filteredCategoryShows.filter(s => s.media_type === 'anime');
    movieShows = filteredCategoryShows.filter(s => s.media_type === 'movie');

    // Sort by newest first
    const sortedNewest = [...filteredCategoryShows].sort((a, b) => {
      const da = new Date(a.created_at || 0);
      const db = new Date(b.created_at || 0);
      return db - da;
    });

    const carouselShows = sortedNewest.slice(0, 5);
    
    if (carouselShows.length > 0) {
      carouselContainer.style.display = 'block';
      
      // Render slides
      carouselWrapper.innerHTML = carouselShows.map(show => {
        const bg = show.backdrop_path || show.poster_path || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=1000&q=80';
        const safeBg = bg.replace(/'/g, "%27");
        return `
          <div class="carousel-slide" style="background-image: linear-gradient(to bottom, rgba(11,12,14,0.2), rgba(11,12,14,0.95)), url('${safeBg}?t=${Date.now()}')">
            <div class="hero-content">
              <span class="hero-tag">Nuevo Aporte</span>
              <h1 class="hero-title">${show.title}</h1>
              <p class="hero-synopsis">${show.synopsis || 'Sin sinopsis disponible.'}</p>
              <div class="hero-buttons">
                <button class="btn btn-primary" onclick="location.hash='#/show/${show.id}'"><i data-lucide="play" style="width:16px;height:16px;margin-right:6px;vertical-align:middle;"></i> Ver Ahora</button>
                <button class="btn btn-secondary" onclick="location.hash='#/show/${show.id}'"><i data-lucide="info" style="width:16px;height:16px;margin-right:6px;vertical-align:middle;"></i> Más Información</button>
              </div>
            </div>
          </div>
        `;
      }).join('');
      
      // Render dots
      carouselIndicators.innerHTML = carouselShows.map((_, idx) => `
        <div class="carousel-dot ${idx === 0 ? 'active' : ''}" data-slide-index="${idx}"></div>
      `).join('');
      
      // Setup sliding logic
      let currentSlide = 0;
      const totalSlides = carouselShows.length;
      
      const goToSlide = (idx) => {
        currentSlide = idx;
        carouselWrapper.style.transform = `translateX(-${currentSlide * 100}%)`;
        
        // Update dots
        carouselIndicators.querySelectorAll('.carousel-dot').forEach((dot, dIdx) => {
          if (dIdx === currentSlide) {
            dot.classList.add('active');
          } else {
            dot.classList.remove('active');
          }
        });
      };
      
      // Clear previous interval if any
      if (carouselInterval) clearInterval(carouselInterval);
      
      // Start auto transition
      const startAutoPlay = () => {
        carouselInterval = setInterval(() => {
          goToSlide((currentSlide + 1) % totalSlides);
        }, 5000);
      };
      
      startAutoPlay();
      
      // Bind navigation controls
      const prevBtn = document.getElementById('carousel-prev-btn');
      const nextBtn = document.getElementById('carousel-next-btn');
      
      prevBtn.onclick = (e) => {
        e.stopPropagation();
        clearInterval(carouselInterval);
        goToSlide((currentSlide - 1 + totalSlides) % totalSlides);
        startAutoPlay();
      };
      
      nextBtn.onclick = (e) => {
        e.stopPropagation();
        clearInterval(carouselInterval);
        goToSlide((currentSlide + 1) % totalSlides);
        startAutoPlay();
      };
      
      // Bind indicator dots clicks
      carouselIndicators.querySelectorAll('.carousel-dot').forEach(dot => {
        dot.onclick = (e) => {
          e.stopPropagation();
          clearInterval(carouselInterval);
          goToSlide(parseInt(dot.dataset.slideIndex, 10));
          startAutoPlay();
        };
      });
      
    } else {
      carouselContainer.style.display = 'none';
    }

    let html = '';

    // A. Continue Watching Row
    if (history.length > 0) {
      const historyCardsHTML = history.map(item => {
        const progressPercent = Math.min(100, Math.max(0, (item.progress_seconds / item.duration) * 100));
        const img = item.thumbnail_path || item.poster_path || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&q=80';
        const safeImg = img.replace(/'/g, "%27");
        const label = item.season_number ? `T${item.season_number} • Cap ${item.episode_number}` : 'Película';
        
        return `
          <div class="history-card-horizontal" onclick="location.hash='#/player/${item.episode_id}'" style="flex: 0 0 auto; width: 320px; height: 110px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; display: flex; overflow: hidden; cursor: pointer; transition: transform 0.2s, border-color 0.2s;">
            <div class="history-card-img-wrapper" style="width: 140px; height: 100%; position: relative; flex-shrink: 0; background: #000;">
              <img src="${safeImg}" alt="${item.show_title}" style="width: 100%; height: 100%; object-fit: cover;">
              <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 4px; background: rgba(255,255,255,0.2);">
                <div style="width: ${progressPercent}%; height: 100%; background: var(--accent-color);"></div>
              </div>
            </div>
            <div class="history-card-info" style="flex-grow: 1; padding: 12px; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden;">
              <div>
                <h3 style="font-size: 0.85rem; font-weight: 700; color: var(--text-main); margin: 0 0 3px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.show_title}</h3>
                <h4 style="font-size: 0.8rem; color: var(--text-muted); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.episode_title || 'Capítulo ' + item.episode_number}</h4>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem;">
                <span class="badge" style="background: rgba(229, 9, 20, 0.15); color: var(--accent-color); padding: 2px 6px; border-radius: 4px; font-weight: 700;">${label}</span>
                <span style="color: var(--text-muted);">${Math.round(progressPercent)}% visto</span>
              </div>
            </div>
          </div>
        `;
      }).join('');

      html += `
        <div class="row-container" style="margin-bottom: 30px;">
          <h2 class="row-title"><i data-lucide="play-circle" style="vertical-align: middle; margin-right: 6px;"></i> Seguir Viendo</h2>
          <div class="row-cards" style="display: flex; gap: 20px; overflow-x: auto; padding-bottom: 10px; padding-top: 5px;">
            ${historyCardsHTML}
          </div>
        </div>
      `;
    }

    // B. Favorites (My List) Row
    const categoryFavorites = favorites.filter(s => s.media_type === mediaType);
    if (categoryFavorites.length > 0) {
      html += `
        <div class="row-container" style="margin-bottom: 30px;">
          <h2 class="row-title"><i data-lucide="heart" style="vertical-align: middle; margin-right: 6px; fill: var(--accent-color); stroke: var(--accent-color);"></i> Mi Lista</h2>
          <div class="row-cards" style="display: flex; gap: 20px; overflow-x: auto; padding-bottom: 10px; padding-top: 5px;">
            ${categoryFavorites.map(s => createShowCardHTML(s, historyMap)).join('')}
          </div>
        </div>
      `;
    }

    if (mediaType === 'anime') {
      // 1. Nuevos Aportes (Recién Subidos) sorted by created_at DESC
      const recentAnime = [...animeShows].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 10);
      if (recentAnime.length > 0) {
        html += `
          <div class="row-container" style="margin-bottom: 35px;">
            <h2 class="row-title"><i data-lucide="clock" style="vertical-align: middle; margin-right: 6px; color: var(--accent-color);"></i> Nuevos Aportes / Recién Subidos</h2>
            <div class="row-cards" style="display: flex; gap: 20px; overflow-x: auto; padding-bottom: 10px;">
              ${recentAnime.map(s => createShowCardHTML(s, historyMap)).join('')}
            </div>
          </div>
        `;
      }

      // 2. Destacados (Más Valorados) sorted by rating DESC
      const popularAnime = [...animeShows].sort((a, b) => b.rating - a.rating).slice(0, 10);
      if (popularAnime.length > 0) {
        html += `
          <div class="row-container" style="margin-bottom: 35px;">
            <h2 class="row-title"><i data-lucide="star" style="vertical-align: middle; margin-right: 6px; fill: var(--rating-color); stroke: var(--rating-color);"></i> Destacados / Más Valorados</h2>
            <div class="row-cards" style="display: flex; gap: 20px; overflow-x: auto; padding-bottom: 10px;">
              ${popularAnime.map(s => createShowCardHTML(s, historyMap)).join('')}
            </div>
          </div>
        `;
      }

      // 3. Grid General: Todos los Animes
      if (animeShows.length > 0) {
        const PAGE_LIMIT = 12;
        const totalPages = Math.ceil(animeShows.length / PAGE_LIMIT);
        const paginatedAnime = animeShows.slice((currentShowsPage - 1) * PAGE_LIMIT, currentShowsPage * PAGE_LIMIT);
        const paginationHTML = createPaginationHTML(currentShowsPage, totalPages, 'anime');

        html += `
          <div class="grid-container" style="margin-top: 20px; margin-bottom: 40px;">
            <h2 class="row-title"><i data-lucide="grid" style="vertical-align: middle; margin-right: 6px;"></i> Todos los Animes (${animeShows.length})</h2>
            <div class="shows-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 24px;">
              ${paginatedAnime.map(s => createShowCardHTML(s, historyMap)).join('')}
            </div>
            ${paginationHTML}
          </div>
        `;
      } else {
        html += `
          <div style="padding: 40px 0; text-align: center; color: var(--text-muted);">
            <p>No hay series de Anime en tu biblioteca actualmente.</p>
          </div>
        `;
      }
    } else {
      // Películas View
      // 1. Películas de Anime
      if (movieShows.length > 0) {
        html += `
          <div class="row-container" style="margin-bottom: 35px;">
            <h2 class="row-title"><i data-lucide="film" style="vertical-align: middle; margin-right: 6px;"></i> Películas Destacadas</h2>
            <div class="row-cards" style="display: flex; gap: 20px; overflow-x: auto; padding-bottom: 10px;">
              ${movieShows.map(s => createShowCardHTML(s, historyMap)).join('')}
            </div>
          </div>
        `;

        const PAGE_LIMIT = 12;
        const totalPages = Math.ceil(movieShows.length / PAGE_LIMIT);
        const paginatedMovies = movieShows.slice((currentShowsPage - 1) * PAGE_LIMIT, currentShowsPage * PAGE_LIMIT);
        const paginationHTML = createPaginationHTML(currentShowsPage, totalPages, 'movie');

        html += `
          <div class="grid-container" style="margin-top: 20px; margin-bottom: 40px;">
            <h2 class="row-title"><i data-lucide="grid" style="vertical-align: middle; margin-right: 6px;"></i> Catálogo de Películas</h2>
            <div class="shows-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 24px;">
              ${paginatedMovies.map(s => createShowCardHTML(s, historyMap)).join('')}
            </div>
            ${paginationHTML}
          </div>
        `;
      } else {
        html += `
          <div style="padding: 80px 0; text-align: center; color: var(--text-muted);">
            <h2>No hay películas en tu biblioteca</h2>
            <p style="margin-top: 10px;">Añade películas usando el importador en el Panel de Administración.</p>
          </div>
        `;
      }
    }

    sectionsContainer.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (err) {
    console.error(err);
    sectionsContainer.innerHTML = '<p style="color: var(--danger-color); text-align: center;">Error al cargar el catálogo.</p>';
  }
}

function renderSkeletonLoaders(rowCount = 2) {
  return Array(rowCount).fill().map(() => `
    <div class="row-container skeleton-row" style="margin-bottom: 30px;" aria-hidden="true">
      <div class="skeleton-title" style="width: 150px; height: 24px; background: var(--surface-muted); border-radius: 4px; margin-bottom: 20px; animation: skeleton-pulse 1.5s infinite;"></div>
      <div class="row-cards" style="display: flex; gap: 20px; overflow: hidden;">
        ${Array(6).fill().map(() => `
          <div class="skeleton-card" style="width: 180px; height: 320px; background: var(--surface-color); border-radius: 12px; overflow: hidden; border: 1px solid var(--border-color); flex-shrink: 0; display: flex; flex-direction: column;">
            <div class="skeleton-img" style="height: 220px; background: var(--surface-muted); animation: skeleton-pulse 1.5s infinite;"></div>
            <div style="padding: 12px; display: flex; flex-direction: column; gap: 8px;">
              <div class="skeleton-text" style="height: 14px; background: var(--surface-muted); border-radius: 3px; width: 80%; animation: skeleton-pulse 1.5s infinite;"></div>
              <div class="skeleton-text" style="height: 12px; background: var(--surface-muted); border-radius: 3px; width: 50%; animation: skeleton-pulse 1.5s infinite;"></div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function createShowCardHTML(show, historyMap = new Map()) {
  const poster = show.poster_path || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&q=80';
  const rating = show.rating ? show.rating.toFixed(1) : 'N/A';
  
  const historyItem = historyMap && historyMap.get ? historyMap.get(String(show.id)) : null;
  let progressHTML = '';
  if (historyItem && historyItem.duration) {
    const progressPercent = Math.min(100, Math.max(0, ((historyItem.progress_seconds || 0) / historyItem.duration) * 100));
    progressHTML = `
      <div class="card-progress-bar-container" style="position: absolute; bottom: 0; left: 0; right: 0; height: 5px; background: rgba(255,255,255,0.2); z-index: 2;">
        <div class="card-progress-bar" style="width: ${progressPercent}%; height: 100%; background: var(--accent-color);"></div>
      </div>
      <div class="card-continue-watching-indicator" style="position: absolute; top: 10px; left: 10px; background: rgba(168, 85, 247, 0.95); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 4px; padding: 2px 6px; font-size: 0.65rem; font-family: var(--font-title); font-weight: 700; color: white; display: flex; align-items: center; gap: 3px; z-index: 2; box-shadow: 0 2px 8px rgba(0,0,0,0.5);">
        <i data-lucide="play" style="width: 8px; height: 8px; fill: white; stroke: white;"></i>
        ${Math.round(progressPercent)}% visto
      </div>
    `;
  }

  return `
    <div class="show-card" onclick="location.hash='#/show/${show.id}'" style="flex: 0 0 auto; width: 180px; height: 320px;">
      <div class="card-img-wrapper" style="height: 220px; position: relative;">
        <img src="${poster}" alt="${show.title}" loading="lazy">
        <div class="card-rating-badge">
          <i data-lucide="star" style="width:12px;height:12px;fill:var(--rating-color);stroke:var(--rating-color);margin-right:2px;display:inline-block;vertical-align:middle;"></i> 
          ${rating}
        </div>
        ${progressHTML}
      </div>
      <div class="card-info">
        <h3 class="card-title" style="font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">${show.title}</h3>
        <div class="card-meta" style="font-size: 0.75rem;">
          <span>${show.media_type === 'movie' ? 'Película' : 'Anime'}</span>
          <span>•</span>
          <span>${show.year || 'N/A'}</span>
        </div>
      </div>
    </div>
  `;
}


// SHOW DETAIL VIEW
async function loadShowDetails(id) {
  const detailTitle = document.getElementById('detail-title');
  const detailSynopsis = document.getElementById('detail-synopsis');
  const detailPoster = document.getElementById('detail-poster');
  const detailRating = document.getElementById('detail-rating');
  const detailYear = document.getElementById('detail-year');
  const detailStudio = document.getElementById('detail-studio');
  const detailDirector = document.getElementById('detail-director');
  const detailWriter = document.getElementById('detail-writer');
  const detailCast = document.getElementById('detail-cast');
  const seasonTabs = document.getElementById('season-tabs');
  const episodesList = document.getElementById('episodes-list');
  const bgVideo = document.getElementById('detail-bg-video');

  // Clear previous details
  detailTitle.textContent = 'Cargando...';
  detailSynopsis.textContent = '';
  detailPoster.src = '';
  detailRating.textContent = '--';
  detailYear.textContent = '--';
  detailStudio.textContent = '--';
  detailDirector.textContent = '--';
  detailWriter.textContent = '--';
  detailCast.innerHTML = '';
  seasonTabs.innerHTML = '';
  episodesList.innerHTML = '<div class="spinner"></div>';
  
  // Stop background video and YouTube iframe
  if (bgVideo) {
    bgVideo.pause();
    bgVideo.removeAttribute('src');
    bgVideo.load();
    bgVideo.onplaying = null;
    bgVideo.onended = null;
  }
  const prevBgYoutubeIframe = document.getElementById('detail-bg-youtube-iframe');
  const prevBgYoutubeContainer = document.getElementById('detail-bg-youtube-container');
  if (prevBgYoutubeIframe) prevBgYoutubeIframe.src = '';
  if (prevBgYoutubeContainer) prevBgYoutubeContainer.style.display = 'none';

  try {
    const res = await fetch(`/api/shows/${id}`);
    if (!res.ok) throw new Error('Show details not found');
    const { show, episodes } = await res.json();
    currentShowEpisodes = episodes;

    // Fetch active user
    let activeUser = 'guest';
    const sessionStr = localStorage.getItem('kura_user_session');
    if (sessionStr) {
      try { activeUser = JSON.parse(sessionStr).username; } catch(e) {}
    }

    // Check if in favorites
    let isFav = false;
    try {
      const favCheckRes = await fetch(`/api/favorites/check?username=${encodeURIComponent(activeUser)}&showId=${encodeURIComponent(id)}`);
      const checkData = await favCheckRes.json();
      isFav = checkData.isFavorite;
    } catch (e) {
      console.warn("Could not check favorites state:", e);
    }

    const favBtn = document.getElementById('detail-favorite-btn');
    const favIcon = document.getElementById('detail-favorite-icon');
    const favText = document.getElementById('detail-favorite-text');

    const updateFavBtnState = (state) => {
      isFav = state;
      if (isFav) {
        favBtn.classList.remove('btn-secondary');
        favBtn.classList.add('btn-primary');
        favText.textContent = 'En mi Lista';
        if (favIcon) {
          favIcon.style.fill = 'currentColor'; // Solid color
        }
      } else {
        favBtn.classList.remove('btn-primary');
        favBtn.classList.add('btn-secondary');
        favText.textContent = 'Añadir a mi Lista';
        if (favIcon) {
          favIcon.style.fill = 'none'; // Outline only
        }
      }
    };

    if (favBtn) {
      updateFavBtnState(isFav);
      favBtn.onclick = async () => {
        const newState = !isFav;
        updateFavBtnState(newState);
        try {
          await fetch('/api/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: activeUser, showId: id, isFavorite: newState })
          });
        } catch (e) {
          console.error("Failed to toggle favorite:", e);
          updateFavBtnState(!newState); // Revert on failure
        }
      };
    }

    // Populate metadata
    detailTitle.textContent = show.title;
    detailSynopsis.textContent = show.synopsis || 'Sin sinopsis disponible.';
    
    detailPoster.crossOrigin = "anonymous";
    detailPoster.onload = () => applyChameleonTheme(detailPoster);
    detailPoster.src = show.poster_path || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&q=80';
    
    // Wire Trailer button and modal
    const trailerBtn = document.getElementById('detail-trailer-btn');
    const trailerModal = document.getElementById('trailer-modal');
    const trailerCloseBtn = document.getElementById('trailer-close-btn');
    const trailerIframe = document.getElementById('trailer-iframe');

    if (trailerBtn && trailerModal && trailerCloseBtn && trailerIframe) {
      if (show.trailer_key) {
        trailerBtn.style.display = 'flex';
        trailerBtn.onclick = () => {
          // Pause detail ambient video loop to avoid double audio
          const bgVideo = document.getElementById('detail-bg-video');
          if (bgVideo) bgVideo.pause();
          
          trailerIframe.src = `https://www.youtube.com/embed/${show.trailer_key}?autoplay=1`;
          trailerModal.style.display = 'flex';
        };

        trailerCloseBtn.onclick = () => {
          trailerModal.style.display = 'none';
          trailerIframe.src = '';
          
          // Resume background loop if applicable
          const bgVideo = document.getElementById('detail-bg-video');
          if (bgVideo && bgVideo.src) {
            bgVideo.play().catch(e => {});
          }
        };

        trailerModal.onclick = (e) => {
          if (e.target === trailerModal) {
            trailerCloseBtn.onclick();
          }
        };
      } else {
        trailerBtn.style.display = 'none';
      }
    }

    detailRating.textContent = show.rating ? show.rating.toFixed(1) : 'N/A';
    detailYear.textContent = show.year || 'N/A';
    detailStudio.textContent = show.studio || 'N/A';
    detailDirector.textContent = show.director || 'N/A';
    detailWriter.textContent = show.writer || 'N/A';

    // Renders dynamic backdrop loop video(s)
    const showTypeDir = show.media_type === 'movie' ? 'Movies' : 'Anime';
    const sanitizedTitle = show.title.replace(/[\\/:*?"<>|]/g, '_');
    
    let loops = [];
    if (show.backdrop_loops) {
      try {
        loops = typeof show.backdrop_loops === 'string' ? JSON.parse(show.backdrop_loops) : show.backdrop_loops;
        if (typeof loops === 'string') {
          loops = JSON.parse(loops);
        }
      } catch (e) {
        loops = [];
      }
    }
    if (!Array.isArray(loops)) loops = [];

    const hasLocalLoops = loops.length > 0;

    // Set backdrop image immediately as a fallback
    if (show.backdrop_path) {
      let hdBackdrop = show.backdrop_path.replace('/w500/', '/original/').replace('/w1280/', '/original/');
      const safeBackdrop = hdBackdrop.replace(/'/g, "%27");
      const ambientBg = document.querySelector('.detail-ambient-bg');
      if (ambientBg) {
        ambientBg.style.backgroundImage = `url('${safeBackdrop}')`;
        ambientBg.style.backgroundSize = 'cover';
        ambientBg.style.backgroundPosition = 'center top';
        ambientBg.style.filter = 'brightness(0.55) saturate(120%)';
      }
    }

    const bgYoutubeContainer = document.getElementById('detail-bg-youtube-container');
    const bgYoutubeIframe = document.getElementById('detail-bg-youtube-iframe');

    if (!hasLocalLoops && show.trailer_key) {
      // Show YouTube container and hide/pause local video
      if (bgYoutubeContainer) {
        bgYoutubeContainer.style.display = 'block';
        bgYoutubeContainer.style.pointerEvents = 'none';
      }
      if (bgVideo) {
        bgVideo.style.display = 'none';
        bgVideo.pause();
        bgVideo.removeAttribute('src');
        bgVideo.load();
        bgVideo.onplaying = null;
        bgVideo.onended = null;
      }

      if (bgYoutubeIframe) {
        bgYoutubeIframe.style.pointerEvents = 'none';
        bgYoutubeIframe.src = `https://www.youtube-nocookie.com/embed/${show.trailer_key}?autoplay=1&mute=1&controls=0&loop=1&playlist=${show.trailer_key}&playsinline=1&showinfo=0&rel=0&iv_load_policy=3&enablejsapi=1&disablekb=1&modestbranding=1&fs=0&autohide=1`;
      }
    } else {
      // Hide YouTube container, clear iframe src, and run local loop playback logic
      if (bgYoutubeContainer) bgYoutubeContainer.style.display = 'none';
      if (bgYoutubeIframe) bgYoutubeIframe.src = '';

      if (loops.length === 0) {
        // Fallback legacy intro loop filename
        loops.push(`/library/${showTypeDir}/${sanitizedTitle}/intro_loop.mp4`);
      }

      let currentLoopIndex = 0;
      if (bgVideo) {
        bgVideo.style.display = 'none'; // Hide initially

        bgVideo.onplaying = () => {
          bgVideo.style.display = 'block'; // Show only when video is playing
        };

        const playLoop = (index) => {
          if (loops.length === 0) return;
          if (index >= loops.length) index = 0;
          currentLoopIndex = index;

          const videoUrl = loops[index];
          bgVideo.src = videoUrl;
          bgVideo.load();
          bgVideo.loop = loops.length === 1; // Native loop if only 1 video

          bgVideo.play().catch(e => {
            console.log("Auto-play background video failed or blocked.", e);
            bgVideo.style.display = 'none';
          });
        };

        bgVideo.onended = () => {
          if (loops.length > 1) {
            playLoop(currentLoopIndex + 1);
          }
        };

        playLoop(0);
      }
    }

    // Populate Cast safely
    let cast = [];
    if (show.cast_members) {
      try {
        cast = typeof show.cast_members === 'string' ? JSON.parse(show.cast_members) : show.cast_members;
        if (typeof cast === 'string') {
          cast = JSON.parse(cast);
        }
      } catch (e) {
        cast = [];
      }
    }
    if (!Array.isArray(cast)) cast = [];
    if (cast.length === 0) {
      detailCast.innerHTML = '<p style="color: var(--text-muted);">Sin información de reparto.</p>';
    } else {
      detailCast.innerHTML = cast.map(c => `
        <div class="cast-card">
          <img class="cast-photo" src="${c.profile_path ? 'https://image.tmdb.org' + c.profile_path : 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&q=80'}" alt="${c.name}">
          <span class="cast-name">${c.name}</span>
          <span class="cast-character">${c.character}</span>
        </div>
      `).join('');
    }

    if (show.media_type === 'movie') {
      seasonTabs.style.display = 'none';
      renderEpisodeList(episodes, episodesList);
    } else {
      seasonTabs.style.display = 'flex';
      // Group episodes by season
      const seasons = {};
      (episodes || []).forEach(ep => {
        const sNum = ep.season_number || 1;
        if (!seasons[sNum]) seasons[sNum] = [];
        seasons[sNum].push(ep);
      });

      const seasonNums = Object.keys(seasons).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
      
      seasonTabs.innerHTML = seasonNums.map((num, idx) => `
        <button class="season-tab ${idx === 0 ? 'active' : ''}" data-season="${num}">T${num}</button>
      `).join('');

      // Render first season by default
      if (seasonNums.length > 0) {
        renderEpisodeList(seasons[seasonNums[0]], episodesList);
      } else {
        renderEpisodeList([], episodesList);
      }

      // Bind season tab clicks
      document.querySelectorAll('.season-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
          document.querySelectorAll('.season-tab').forEach(t => t.classList.remove('active'));
          e.target.classList.add('active');
          const sNum = e.target.getAttribute('data-season');
          renderEpisodeList(seasons[sNum] || [], episodesList);
        });
      });
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
    
    // Load Comments and Popular Sidebar asynchronously without breaking main detail view
    loadShowComments(id).catch(e => console.warn('Comments load warning:', e));
    loadPopularSidebar(id).catch(e => console.warn('Sidebar load warning:', e));
  } catch (e) {
    console.error('Error loading show details:', e);
    if (!detailTitle.textContent || detailTitle.textContent === 'Cargando...') {
      detailTitle.textContent = 'Error';
    }
    if (episodesList && (!episodesList.children.length || episodesList.querySelector('.spinner'))) {
      episodesList.innerHTML = '<div class="error-text">No se pudo cargar el anime/película.</div>';
    }
  }
}

function renderEpisodeList(epList, targetContainer) {
  if (!epList || epList.length === 0) {
    targetContainer.innerHTML = '<div class="empty-state">No hay capítulos importados en esta temporada.</div>';
    return;
  }
  
  targetContainer.innerHTML = epList.map(ep => {
    const durationMin = Math.round(ep.duration / 60);
    const thumb = ep.thumbnail_path || (currentShow ? currentShow.poster_path : null) || 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=300&q=80';
    
    return `
      <div class="episode-item" onclick="window.showEpisodeDetails('${ep.id}')">
        <div class="episode-thumb-wrapper">
          <img class="episode-thumb" src="${thumb}" alt="${ep.title}">
          <div class="episode-play-overlay">
            <span class="play-icon-small"><i data-lucide="play" style="width:28px;height:28px;fill:currentColor;"></i></span>
          </div>
        </div>
        <div class="episode-item-info">
          <div class="episode-item-top">
            <h3 class="episode-item-title">${ep.episode_number ? `${ep.episode_number}. ` : ''}${ep.title || 'Capítulo'}</h3>
            <span class="episode-item-duration">${durationMin} min</span>
          </div>
          <p class="episode-item-synopsis">${ep.synopsis || 'Sin descripción disponible para este capítulo.'}</p>
        </div>
      </div>
    `;
  }).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function stopAdminPolling() {
  if (adminPollInterval) {
    clearInterval(adminPollInterval);
    adminPollInterval = null;
  }
  if (adminLogsInterval) {
    clearInterval(adminLogsInterval);
    adminLogsInterval = null;
  }
}

function startAdminStatsPolling() {
  if (adminPollInterval) clearInterval(adminPollInterval);
  
  const poll = async () => {
    try {
      const resStats = await fetch('/api/admin/stats');
      if (resStats.ok) {
        const stats = await resStats.json();
        const statShows = document.getElementById('stat-shows');
        const statEpisodes = document.getElementById('stat-episodes');
        const statSize = document.getElementById('stat-size');
        const statDuration = document.getElementById('stat-duration');

        if (statShows) statShows.textContent = stats.showsCount || 0;
        if (statEpisodes) statEpisodes.textContent = stats.episodesCount || 0;
        
        if (statSize) {
          statSize.textContent = stats.libraryDiskSizeFormatted || `${(stats.totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        }
        
        if (statDuration) {
          const durationHours = (stats.totalDuration / 3600).toFixed(1);
          statDuration.textContent = `${durationHours} h`;
        }

        const diskUsageBadge = document.getElementById('disk-usage-badge');
        const diskProgressBar = document.getElementById('disk-progress-bar');
        const statLibraryFolderSize = document.getElementById('stat-library-folder-size');
        const statDiskUsed = document.getElementById('stat-disk-used');
        const statDiskFree = document.getElementById('stat-disk-free');
        const statDiskTotal = document.getElementById('stat-disk-total');

        if (diskUsageBadge && stats.diskUsagePercentage) diskUsageBadge.textContent = `${stats.diskUsagePercentage} Usado`;
        if (diskProgressBar && stats.diskUsagePercentage) diskProgressBar.style.width = stats.diskUsagePercentage;
        if (statLibraryFolderSize) statLibraryFolderSize.textContent = stats.libraryDiskSizeFormatted || '--';
        if (statDiskUsed) statDiskUsed.textContent = stats.diskUsedFormatted || '--';
        if (statDiskFree) statDiskFree.textContent = stats.diskFreeFormatted || '--';
        if (statDiskTotal) statDiskTotal.textContent = stats.diskTotalFormatted || '--';
      }

      const resStreams = await fetch('/api/admin/active-streams');
      if (resStreams.ok) {
        const data = await resStreams.json();
        const streamsList = document.getElementById('active-streams-list');
        if (streamsList) {
          if (data.streams.length === 0) {
            streamsList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem; padding: 15px 0;">No hay transmisiones de vídeo activas en este momento.</p>';
          } else {
            streamsList.innerHTML = data.streams.map(s => {
              const minutesActive = Math.floor((Date.now() - s.timestamp) / 60000);
              const detail = `${s.seasonNumber ? `T${s.seasonNumber} • ` : ''}Capítulo ${s.episodeNumber}: ${s.episodeTitle}`;
              return `
                <div class="active-stream-item">
                  <div class="stream-meta">
                    <span class="stream-title">${s.showTitle}</span>
                    <span class="stream-details">${detail}</span>
                  </div>
                  <div style="text-align: right; font-size: 0.8rem; color: var(--text-muted);">
                    <div>IP: ${s.ip}</div>
                    <div>Activo hace ${minutesActive} min</div>
                  </div>
                </div>
              `;
            }).join('');
          }
        }
      }
    } catch (err) {
      console.warn('Error polling admin stats:', err);
    }
  };

  poll();
  adminPollInterval = setInterval(poll, 4000);
}

function startAdminLogsPolling() {
  if (adminLogsInterval) clearInterval(adminLogsInterval);

  const terminal = document.getElementById('terminal-box');
  const poll = async () => {
    try {
      const res = await fetch('/api/admin/logs');
      if (res.ok) {
        const data = await res.json();
        if (!terminal) return;
        
        const isScrolledToBottom = terminal.scrollHeight - terminal.clientHeight <= terminal.scrollTop + 40;
        
        terminal.innerHTML = data.logs.map(log => {
          const time = log.time.split('T')[1].split('.')[0];
          const color = log.type === 'ERROR' ? '#ff334b' : '#4af626';
          return `<div style="color: ${color}; font-family: monospace;">[${time}] ${log.message}</div>`;
        }).join('');

        if (isScrolledToBottom) {
          terminal.scrollTop = terminal.scrollHeight;
        }
      }
    } catch (err) {
      console.warn('Error polling server logs:', err);
    }
  };

  poll();
  adminLogsInterval = setInterval(poll, 2000);
}

// ADMIN PANEL
function parseEpisodeNumberFromFilename(filename, defaultEp = 1) {
  if (!filename) return defaultEp;
  const matchSe = filename.match(/S\d+[\s._-]*E(\d+)/i);
  if (matchSe) return parseInt(matchSe[1], 10);

  const matchEp = filename.match(/(?:E|EP|CAP|CAPITULO|EPISODIO)[\s._-]*(\d+)/i);
  if (matchEp) return parseInt(matchEp[1], 10);

  const matchStandaloneNum = filename.match(/\b(\d{1,3})\b/);
  if (matchStandaloneNum) return parseInt(matchStandaloneNum[1], 10);

  return defaultEp;
}

function uploadFileWithProgress(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/import');

    // Retrieve active auth token (session token or fallback to admin token)
    const sessionStr = localStorage.getItem('kura_user_session');
    let token = null;
    if (sessionStr) {
      try {
        const session = JSON.parse(sessionStr);
        token = session ? session.token : null;
      } catch (e) {}
    }
    if (!token) {
      token = localStorage.getItem('adminToken') || localStorage.getItem('kura_admin_token');
    }

    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    const startTime = Date.now();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        const elapsedTime = (Date.now() - startTime) / 1000;
        const speed = elapsedTime > 0 ? (e.loaded / elapsedTime) / (1024 * 1024) : 0;
        const loadedMB = (e.loaded / (1024 * 1024)).toFixed(1);
        const totalMB = (e.total / (1024 * 1024)).toFixed(1);
        
        onProgress({
          percent,
          loadedMB,
          totalMB,
          speed: speed.toFixed(1),
          stage: 'uploading'
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          resolve(res);
        } catch (err) {
          resolve(xhr.responseText);
        }
      } else {
        reject(new Error(xhr.responseText || `Error HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Error de red al subir el archivo.'));
    xhr.onabort = () => reject(new Error('Subida cancelada.'));

    xhr.send(formData);
  });
}

function setupForms() {
  const form = document.getElementById('import-form');
  const typeSelect = document.getElementById('import-type');
  const tvFieldsGroup = document.getElementById('tv-fields-group');
  const statusBox = document.getElementById('import-status');
  const statusText = document.getElementById('import-status-text');
  const batchLabel = document.getElementById('import-batch-label');
  const progressPercent = document.getElementById('import-progress-percent');
  const progressFill = document.getElementById('upload-progress-fill');
  const progressStats = document.getElementById('import-progress-stats');

  const fileInput = document.getElementById('import-file');
  const btnSelectFile = document.getElementById('btn-select-file');
  const fileLabel = document.getElementById('selected-file-label');
  const bulkContainer = document.getElementById('bulk-files-container');
  const bulkFileCount = document.getElementById('bulk-file-count');
  const bulkFilesList = document.getElementById('bulk-files-list');
  const epGroup = document.getElementById('import-episode-group');
  const epTitleGroup = document.getElementById('import-ep-title-group');

  if (btnSelectFile && fileInput) {
    btnSelectFile.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files);
      if (files.length === 0) {
        fileLabel.textContent = 'Ningún archivo seleccionado';
        if (bulkContainer) bulkContainer.style.display = 'none';
        if (epGroup) epGroup.style.display = 'block';
        if (epTitleGroup) epTitleGroup.style.display = 'block';
      } else if (files.length === 1) {
        fileLabel.textContent = files[0].name;
        if (bulkContainer) bulkContainer.style.display = 'none';
        if (epGroup) epGroup.style.display = 'block';
        if (epTitleGroup) epTitleGroup.style.display = 'block';
        
        // Auto-fill episode number if empty or default
        const epInput = document.getElementById('import-episode');
        if (epInput) {
          const autoEp = parseEpisodeNumberFromFilename(files[0].name, 1);
          epInput.value = autoEp;
        }
      } else {
        fileLabel.textContent = `${files.length} archivos seleccionados`;
        if (bulkContainer) bulkContainer.style.display = 'block';
        if (bulkFileCount) bulkFileCount.textContent = `${files.length} capítulos`;
        if (epGroup) epGroup.style.display = 'none';
        if (epTitleGroup) epTitleGroup.style.display = 'none';

        if (bulkFilesList) {
          bulkFilesList.innerHTML = '';
          files.forEach((file, idx) => {
            const detectedEp = parseEpisodeNumberFromFilename(file.name, idx + 1);
            const itemDiv = document.createElement('div');
            itemDiv.className = 'bulk-file-item';
            itemDiv.innerHTML = `
              <span class="file-name" title="${file.name}">${file.name}</span>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="color: var(--text-muted); font-size: 0.75rem;">Cap #</span>
                <input type="number" class="bulk-ep-num" data-index="${idx}" min="1" value="${detectedEp}">
              </div>
            `;
            bulkFilesList.appendChild(itemDiv);
          });
        }
      }
    });
  }

  // Toggle TV fields depending on content type
  typeSelect.addEventListener('change', () => {
    if (typeSelect.value === 'movie') {
      tvFieldsGroup.style.display = 'none';
    } else {
      tvFieldsGroup.style.display = 'block';
    }
  });

  const showSelector = document.getElementById('import-show-selector');
  const newShowFields = document.getElementById('import-new-show-fields');
  const tmdbInput = document.getElementById('import-tmdb');
  
  if (showSelector) {
    showSelector.addEventListener('change', async () => {
      const val = showSelector.value;
      if (val === 'new') {
        if (newShowFields) newShowFields.style.display = 'block';
        document.getElementById('import-title').required = true;
        document.getElementById('import-title').value = '';
        typeSelect.value = 'anime';
        typeSelect.disabled = false;
        tvFieldsGroup.style.display = 'block';
        if (tmdbInput) {
          tmdbInput.value = '';
          tmdbInput.disabled = false;
        }
        document.getElementById('import-season').value = '1';
        document.getElementById('import-episode').value = '1';
      } else {
        if (newShowFields) newShowFields.style.display = 'none';
        document.getElementById('import-title').required = false;
        
        const opt = showSelector.options[showSelector.selectedIndex];
        const title = opt.getAttribute('data-title');
        const mediaType = opt.getAttribute('data-type');
        const tmdbId = opt.getAttribute('data-tmdb');
        
        document.getElementById('import-title').value = title;
        typeSelect.value = mediaType;
        typeSelect.disabled = true;
        
        if (mediaType === 'movie') {
          tvFieldsGroup.style.display = 'none';
        } else {
          tvFieldsGroup.style.display = 'block';
        }
        
        if (tmdbInput) {
          tmdbInput.value = tmdbId || '';
          tmdbInput.disabled = true;
        }

        // Fetch show details to pre-calculate next episode!
        try {
          const res = await fetch(`/api/shows/${val}`);
          if (res.ok) {
            const { episodes } = await res.json();
            if (episodes && episodes.length > 0) {
              const maxSeason = Math.max(...episodes.map(e => e.season_number || 1));
              const seasonEps = episodes.filter(e => e.season_number === maxSeason);
              const maxEp = Math.max(...seasonEps.map(e => e.episode_number || 0));
              
              document.getElementById('import-season').value = maxSeason;
              document.getElementById('import-episode').value = maxEp + 1;
            } else {
              document.getElementById('import-season').value = '1';
              document.getElementById('import-episode').value = '1';
            }
          }
        } catch (e) {
          console.warn("Could not pre-calculate next episode:", e);
        }
      }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const fileInput = document.getElementById('import-file');
    const files = fileInput && fileInput.files.length > 0 ? Array.from(fileInput.files) : [];
    const sourcePath = document.getElementById('import-filepath').value.trim();
    
    if (files.length === 0 && !sourcePath) {
      alert("Por favor, selecciona al menos un archivo o ingresa una ruta local en el servidor.");
      return;
    }

    const title = document.getElementById('import-title').value.trim();
    const mediaType = typeSelect.value;
    const seasonNumber = mediaType === 'movie' ? null : parseInt(document.getElementById('import-season').value, 10);
    const tmdbId = document.getElementById('import-tmdb').value.trim();
    const startSec = document.getElementById('import-intro-start').value;
    const startSeconds = startSec !== '' ? parseInt(startSec, 10) : null;

    statusBox.style.display = 'flex';
    document.getElementById('import-submit-btn').disabled = true;

    try {
      if (files.length > 1) {
        // Bulk Upload Flow
        const bulkInputs = Array.from(document.querySelectorAll('.bulk-ep-num'));
        let successCount = 0;

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const epNum = bulkInputs[i] ? parseInt(bulkInputs[i].value, 10) : (i + 1);

          if (batchLabel) {
            batchLabel.textContent = `Procesando capítulo ${i + 1} de ${files.length} (${Math.round((i / files.length) * 100)}%)`;
          }

          const formData = new FormData();
          formData.append('videoFile', file);
          formData.append('title', title);
          formData.append('mediaType', mediaType);
          if (seasonNumber !== null) formData.append('seasonNumber', seasonNumber);
          formData.append('episodeNumber', epNum);
          if (tmdbId) formData.append('tmdbId', tmdbId);
          if (startSeconds !== null) formData.append('startSeconds', startSeconds);

          try {
            // Upload with progress updates
            await uploadFileWithProgress(formData, (prog) => {
              if (progressFill) progressFill.style.width = `${prog.percent}%`;
              if (progressPercent) progressPercent.textContent = `${prog.percent}%`;
              if (statusText) statusText.textContent = `Subiendo ${file.name} (${prog.speed} MB/s)`;
              if (progressStats) progressStats.textContent = `${prog.loadedMB} MB / ${prog.totalMB} MB`;
            });

            // Show server processing stage
            if (statusText) statusText.textContent = `Extrayendo pistas y metadatos con ffprobe para Cap. ${epNum}...`;
            if (progressFill) progressFill.style.width = '100%';
            if (progressPercent) progressPercent.textContent = '100%';
            
            successCount++;
          } catch (epErr) {
            console.warn(`[Bulk Upload Warning] Error al subir ${file.name}:`, epErr);
          }
        }

        alert(`¡Carga masiva completada! Se importaron ${successCount} capítulos de la temporada con éxito.`);
      } else {
        // Single File or Server Source Path Flow
        const episodeNumber = mediaType === 'movie' ? null : parseInt(document.getElementById('import-episode').value, 10);
        const episodeTitle = mediaType === 'movie' ? null : document.getElementById('import-ep-title').value.trim();

        if (batchLabel) batchLabel.textContent = 'Procesando archivo...';

        const formData = new FormData();
        if (files.length === 1) {
          formData.append('videoFile', files[0]);
        } else {
          formData.append('sourcePath', sourcePath);
        }
        formData.append('title', title);
        formData.append('mediaType', mediaType);
        if (seasonNumber !== null) formData.append('seasonNumber', seasonNumber);
        if (episodeNumber !== null) formData.append('episodeNumber', episodeNumber);
        if (episodeTitle) formData.append('episodeTitle', episodeTitle);
        if (tmdbId) formData.append('tmdbId', tmdbId);
        if (startSeconds !== null) formData.append('startSeconds', startSeconds);

        if (files.length === 1) {
          await uploadFileWithProgress(formData, (prog) => {
            if (progressFill) progressFill.style.width = `${prog.percent}%`;
            if (progressPercent) progressPercent.textContent = `${prog.percent}%`;
            if (statusText) statusText.textContent = `Subiendo ${files[0].name} (${prog.speed} MB/s)`;
            if (progressStats) progressStats.textContent = `${prog.loadedMB} MB / ${prog.totalMB} MB`;
          });
        } else {
          if (progressFill) progressFill.style.width = '50%';
          if (progressPercent) progressPercent.textContent = '50%';
          if (statusText) statusText.textContent = 'Importando desde ruta local del servidor...';
          
          const res = await fetch('/api/import', { method: 'POST', body: formData });
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(errText || 'Error importando el archivo.');
          }
        }

        if (statusText) statusText.textContent = 'Procesando metadatos y miniaturas en servidor...';
        if (progressFill) progressFill.style.width = '100%';
        if (progressPercent) progressPercent.textContent = '100%';

        alert('¡Archivo importado y organizado con éxito!');
      }

      form.reset();
      if (fileLabel) fileLabel.textContent = 'Ningún archivo seleccionado';
      if (bulkContainer) bulkContainer.style.display = 'none';
      if (epGroup) epGroup.style.display = 'block';
      if (epTitleGroup) epTitleGroup.style.display = 'block';
      tvFieldsGroup.style.display = 'block';
      
      // Reset disabled states and displays
      if (showSelector) showSelector.value = 'new';
      if (newShowFields) newShowFields.style.display = 'block';
      typeSelect.disabled = false;
      if (tmdbInput) tmdbInput.disabled = false;
      document.getElementById('import-title').required = true;

      loadAdminPanel(); // Refresh managed list
    } catch (err) {
      console.error(err);
      alert(`Error al importar: ${err.message}`);
    } finally {
      statusBox.style.display = 'none';
      if (progressFill) progressFill.style.width = '0%';
      if (progressPercent) progressPercent.textContent = '0%';
      document.getElementById('import-submit-btn').disabled = false;
    }
  });

  // Setup Library Scan Button
  const btnScanLibrary = document.getElementById('btn-scan-library');
  if (btnScanLibrary) {
    btnScanLibrary.addEventListener('click', async () => {
      btnScanLibrary.disabled = true;
      const originalHtml = btnScanLibrary.innerHTML;
      btnScanLibrary.innerHTML = '<i class="spinner-icon"></i> Escaneando...';
      
      try {
        const res = await fetch('/api/admin/scan', { method: 'POST' });
        if (res.ok) {
          alert('¡Sincronización y escaneo de biblioteca completado con éxito!');
          loadAdminPanel();
        } else {
          const data = await res.json();
          alert('Error durante el escaneo: ' + (data.error || 'Intenta de nuevo.'));
        }
      } catch (err) {
        console.error(err);
        alert('Error al comunicarse con el servidor.');
      } finally {
        btnScanLibrary.disabled = false;
        btnScanLibrary.innerHTML = originalHtml;
      }
    });
  }

  // Setup Anime Auto-Downloader UI Controls
  setupAutoDownloaderControls();

  // TMDB Wizard Search & 1-Click Show Creator
  const btnTmdbWizardSearch = document.getElementById('btn-tmdb-wizard-search');
  const tmdbWizardInput = document.getElementById('tmdb-wizard-input');
  const tmdbWizardType = document.getElementById('tmdb-wizard-type');
  const tmdbWizardResults = document.getElementById('tmdb-wizard-results');

  const performTmdbWizardSearch = async () => {
    const query = (tmdbWizardInput ? tmdbWizardInput.value : '').trim();
    const type = tmdbWizardType ? tmdbWizardType.value : 'anime';
    if (!query) return alert('Por favor, ingresa el título de una serie o película.');

    btnTmdbWizardSearch.disabled = true;
    btnTmdbWizardSearch.innerHTML = '<i class="spinner-icon"></i> Buscando...';
    if (tmdbWizardResults) tmdbWizardResults.innerHTML = '<p style="color: var(--text-muted); padding: 15px;">Buscando coincidencias en TMDB...</p>';

    try {
      const res = await fetch(`/api/admin/search-tmdb-candidates?query=${encodeURIComponent(query)}&type=${type}`);
      const data = await res.json();
      if (res.ok && data.success && data.results && data.results.length > 0) {
        tmdbWizardResults.innerHTML = data.results.map(item => {
          const posterUrl = item.poster_path ? (item.poster_path.startsWith('/') ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : item.poster_path) : 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&q=80';
          return `
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; transition: transform 0.2s;">
              <div style="height: 220px; background: url('${posterUrl}') center/cover no-repeat; position: relative;">
                <span class="badge" style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); font-size: 0.75rem;">${item.year || ''}</span>
              </div>
              <div style="padding: 12px; display: flex; flex-direction: column; flex-grow: 1; justify-content: space-between;">
                <div>
                  <h4 style="margin: 0 0 6px 0; font-family: var(--font-title); font-size: 0.95rem;">${item.title}</h4>
                  <p style="margin: 0; color: var(--text-muted); font-size: 0.75rem; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;">${item.synopsis || 'Sin sinopsis disponible.'}</p>
                </div>
                <button type="button" class="btn btn-primary btn-create-tmdb-show" data-tmdb-id="${item.tmdb_id}" data-type="${type}" style="margin-top: 12px; width: 100%; font-size: 0.8rem; padding: 6px; justify-content: center; gap: 6px;">
                  <i data-lucide="plus-circle" style="width: 14px; height: 14px;"></i> Crear en 1-Clic
                </button>
              </div>
            </div>
          `;
        }).join('');
        
        if (typeof lucide !== 'undefined') lucide.createIcons({ root: tmdbWizardResults });

        tmdbWizardResults.querySelectorAll('.btn-create-tmdb-show').forEach(btn => {
          btn.addEventListener('click', async () => {
            const tmdbId = btn.dataset.tmdbId;
            const mediaType = btn.dataset.type;
            btn.disabled = true;
            btn.innerHTML = '<i class="spinner-icon"></i> Creando...';
            try {
              const createRes = await fetch('/api/admin/create-show-tmdb', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tmdb_id: tmdbId, media_type: mediaType })
              });
              const createData = await createRes.json();
              if (createRes.ok && createData.success) {
                alert(`¡"${createData.show.title}" creada y sincronizada con éxito!`);
                loadAdminPanel();
                window.location.hash = '#/';
              } else {
                alert('Error al crear la serie: ' + (createData.error || 'Intenta de nuevo'));
                btn.disabled = false;
                btn.innerHTML = '<i data-lucide="plus-circle"></i> Crear en 1-Clic';
              }
            } catch(e) {
              alert('Error de conexión: ' + e.message);
              btn.disabled = false;
            }
          });
        });

      } else {
        tmdbWizardResults.innerHTML = '<p style="color: var(--text-muted); padding: 15px;">No se encontraron coincidencias en TMDB para tu búsqueda.</p>';
      }
    } catch(err) {
      console.error(err);
      if (tmdbWizardResults) tmdbWizardResults.innerHTML = '<p style="color: var(--danger-color); padding: 15px;">Error al conectar con TMDB.</p>';
    } finally {
      btnTmdbWizardSearch.disabled = false;
      btnTmdbWizardSearch.innerHTML = '<i data-lucide="search"></i> Buscar en TMDB';
      if (typeof lucide !== 'undefined') lucide.createIcons({ root: btnTmdbWizardSearch });
    }
  };

  if (btnTmdbWizardSearch) btnTmdbWizardSearch.addEventListener('click', performTmdbWizardSearch);
  if (tmdbWizardInput) {
    tmdbWizardInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        performTmdbWizardSearch();
      }
    });
  }

  // Server Repair & Sync Handler
  const btnRepairServer = document.getElementById('btn-repair-server');
  if (btnRepairServer) {
    btnRepairServer.addEventListener('click', async () => {
      btnRepairServer.disabled = true;
      btnRepairServer.innerHTML = '<i class="spinner-icon"></i> Auditando...';
      try {
        const res = await fetch('/api/admin/repair-library', { method: 'POST' });
        if (res.ok) {
          alert('¡Sincronización, limpieza y reparación del servidor completadas con éxito!');
          loadAdminPanel();
        } else {
          alert('Error al reparar el servidor');
        }
      } catch(e) {
        alert('Error: ' + e.message);
      } finally {
        btnRepairServer.disabled = false;
        btnRepairServer.innerHTML = '<i data-lucide="wrench"></i> Sincronizar y Reparar';
        if (typeof lucide !== 'undefined') lucide.createIcons({ root: btnRepairServer });
      }
    });
  }

  // Laptop Display Power Control Handlers
  const btnDisplayOff = document.getElementById('btn-display-off');
  const btnDisplayOn = document.getElementById('btn-display-on');
  const displayBadge = document.getElementById('display-status-badge');

  const updateDisplayStatusUI = (status) => {
    if (!displayBadge) return;
    if (status === 'off') {
      displayBadge.textContent = 'Apagada (Modo Anti-Calentamiento)';
      displayBadge.style.background = '#a855f7';
      displayBadge.style.color = '#fff';
    } else {
      displayBadge.textContent = 'Encendida';
      displayBadge.style.background = '#00e08f';
      displayBadge.style.color = '#000';
    }
  };

  const fetchDisplayStatus = async () => {
    try {
      const res = await fetch('/api/admin/display/status');
      const data = await res.json();
      if (res.ok && data.success) {
        updateDisplayStatusUI(data.status);
      }
    } catch(e) {}
  };

  if (btnDisplayOff) {
    btnDisplayOff.addEventListener('click', async () => {
      btnDisplayOff.disabled = true;
      try {
        const res = await fetch('/api/admin/display/power', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'off' })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          updateDisplayStatusUI('off');
          alert('¡Pantalla del portátil apagada con éxito! El servidor sigue funcionando al 100% en segundo plano.');
        } else {
          alert('Error al apagar pantalla: ' + (data.error || 'Intenta de nuevo'));
        }
      } catch(e) {
        alert('Error: ' + e.message);
      } finally {
        btnDisplayOff.disabled = false;
      }
    });
  }

  if (btnDisplayOn) {
    btnDisplayOn.addEventListener('click', async () => {
      btnDisplayOn.disabled = true;
      try {
        const res = await fetch('/api/admin/display/power', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'on' })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          updateDisplayStatusUI('on');
          alert('¡Pantalla del portátil encendida!');
        } else {
          alert('Error al encender pantalla: ' + (data.error || 'Intenta de nuevo'));
        }
      } catch(e) {
        alert('Error: ' + e.message);
      } finally {
        btnDisplayOn.disabled = false;
      }
    });
  }

  // Fetch initial display status on admin panel load
  fetchDisplayStatus();

  // Setup Custom Logo Drag and Drop
  makeDropZone('logo-drop-zone', uploadLogo, 'logo-file-input');

  const btnResetLogo = document.getElementById('btn-reset-logo');
  if (btnResetLogo) {
    btnResetLogo.addEventListener('click', async () => {
      if (!confirm('¿Seguro que deseas restablecer el logotipo original de KuraStream?')) return;
      try {
        const res = await fetch('/api/admin/reset-logo', { method: 'POST' });
        if (res.ok) {
          alert('¡Logotipo restablecido con éxito!');
          const customLogo = document.getElementById('custom-logo');
          if (customLogo) customLogo.style.display = 'none';
          const fallbackLogo = document.getElementById('fallback-logo');
          if (fallbackLogo) fallbackLogo.style.display = 'flex';
        } else {
          alert('Error al restablecer logotipo');
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });
  }

  // Setup Admin Sidebar Tabs switching
  const navItems = document.querySelectorAll('.admin-nav-item');
  const subViews = document.querySelectorAll('.admin-sub-view');

  navItems.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      
      navItems.forEach(item => item.classList.remove('active'));
      subViews.forEach(view => view.classList.remove('active'));
      
      btn.classList.add('active');
      const targetView = document.getElementById(targetId);
      if (targetView) targetView.classList.add('active');

      // Manage polling and data rendering based on active sub-view
      stopAdminPolling();
      if (targetId === 'admin-sub-overview') {
        startAdminStatsPolling();
      } else if (targetId === 'admin-sub-console') {
        startAdminLogsPolling();
      } else if (targetId === 'admin-sub-library') {
        loadAdminPanel();
      }
    });
  });

  // Clear logs button
  const btnClearLogs = document.getElementById('btn-clear-logs');
  if (btnClearLogs) {
    btnClearLogs.addEventListener('click', () => {
      const terminal = document.getElementById('terminal-box');
      if (terminal) terminal.innerHTML = '<div style="color: var(--text-muted);">Pantalla limpia. Esperando nuevos registros...</div>';
    });
  }

  // Live TMDB Metadata Preview
  const btnSearchTmdb = document.getElementById('btn-search-tmdb');
  const previewPlaceholder = document.getElementById('tmdb-preview-placeholder');
  const previewContent = document.getElementById('tmdb-preview-content');

  if (btnSearchTmdb) {
    btnSearchTmdb.addEventListener('click', async () => {
      const titleVal = document.getElementById('import-title').value.trim();
      const typeVal = document.getElementById('import-type').value;
      const tmdbIdVal = document.getElementById('import-tmdb').value.trim();

      if (!titleVal && !tmdbIdVal) {
        alert('Por favor, escribe un título o ID de TMDB primero.');
        return;
      }

      previewPlaceholder.style.display = 'none';
      previewContent.style.display = 'none';
      
      // Spinner in placeholder
      const tempSpinner = document.createElement('div');
      tempSpinner.className = 'spinner';
      tempSpinner.style.margin = '30px auto';
      previewPlaceholder.parentNode.insertBefore(tempSpinner, previewPlaceholder.nextSibling);

      try {
        let searchUrl = `/api/search-tmdb?query=${encodeURIComponent(titleVal)}&type=${typeVal}`;
        if (tmdbIdVal) {
          searchUrl = `/api/search-tmdb?id=${tmdbIdVal}&type=${typeVal}`;
        }

        const res = await fetch(searchUrl);
        if (!res.ok) throw new Error('No se encontraron resultados.');

        const metadata = await res.json();
        
        tempSpinner.remove();
        previewContent.style.display = 'flex';

        document.getElementById('preview-backdrop').src = metadata.backdrop_path ? `https://image.tmdb.org/t/p/w500${metadata.backdrop_path}` : 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&q=80';
        document.getElementById('preview-poster').src = metadata.poster_path ? `https://image.tmdb.org/t/p/w300${metadata.poster_path}` : 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=300&q=80';
        document.getElementById('preview-title').textContent = metadata.title;
        document.getElementById('preview-year-val').textContent = metadata.year || 'N/A';
        document.getElementById('preview-rating-val').innerHTML = `<i data-lucide="star" style="width:12px;height:12px;fill:var(--rating-color);stroke:var(--rating-color);display:inline-block;vertical-align:middle;margin-right:2px;"></i> ${(metadata.rating || 0).toFixed(1)}`;
        document.getElementById('preview-overview').textContent = metadata.synopsis || 'Sin descripción disponible.';

        if (metadata.id) {
          document.getElementById('import-tmdb').value = metadata.id;
        }

        if (typeof lucide !== 'undefined') lucide.createIcons();
      } catch (err) {
        tempSpinner.remove();
        previewPlaceholder.style.display = 'flex';
        previewPlaceholder.innerHTML = `
          <i data-lucide="alert-circle" style="width: 48px; height: 48px; stroke: var(--danger-color); margin-bottom: 12px;"></i>
          <p style="color: var(--danger-color); text-align: center; font-size: 0.85rem;">Error al buscar: ${err.message}</p>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    });
  }
}

async function loadAdminPanel() {
  // Preserve current active tab selection if already selected
  const activeTab = document.querySelector('.admin-nav-item.active');
  const activeView = document.querySelector('.admin-sub-view.active');
  
  if (!activeTab || !activeView) {
    const navItems = document.querySelectorAll('.admin-nav-item');
    const subViews = document.querySelectorAll('.admin-sub-view');
    
    navItems.forEach(item => item.classList.remove('active'));
    subViews.forEach(view => view.classList.remove('active'));
    
    const defaultTab = document.querySelector('[data-target="admin-sub-overview"]');
    if (defaultTab) defaultTab.classList.add('active');
    const defaultView = document.getElementById('admin-sub-overview');
    if (defaultView) defaultView.classList.add('active');

    stopAdminPolling();
    startAdminStatsPolling();
  }

  const showsList = document.getElementById('admin-shows-list');
  showsList.innerHTML = '<div class="spinner"></div>';
  
  try {
    const resAnime = await fetch('/api/shows?type=anime');
    const anime = await resAnime.json();
    
    const resMovie = await fetch('/api/shows?type=movie');
    const movies = await resMovie.json();
    
    const allShows = [...anime, ...movies];

    // Populate show selector in Import panel
    const showSelector = document.getElementById('import-show-selector');
    if (showSelector) {
      showSelector.innerHTML = '<option value="new">-- Crear Nueva Serie / Película --</option>' + 
        allShows.map(s => {
          const typeLabel = s.media_type === 'movie' ? 'Película' : 'Anime';
          return `<option value="${s.id}" data-title="${s.title}" data-type="${s.media_type}" data-tmdb="${s.id}">${s.title} (${typeLabel})</option>`;
        }).join('');
    }

    if (allShows.length === 0) {
      showsList.innerHTML = '<p style="color: var(--text-muted); padding: 20px 0;">No hay elementos en la biblioteca.</p>';
      return;
    }

    showsList.innerHTML = allShows.map(show => {
      const poster = show.poster_path || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=100&q=80';
      return `
        <div class="admin-show-item">
          <div class="admin-show-info">
            <img class="admin-show-poster" src="${poster}" alt="${show.title}">
            <div>
              <span class="admin-show-title">${show.title}</span>
              <div class="admin-show-meta">${show.media_type === 'movie' ? 'Película' : 'Anime'} • ${show.year || 'N/A'}</div>
            </div>
          </div>
          <div style="display:flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.8rem; height: 32px; background: rgba(168, 85, 247, 0.2); border-color: #a855f7;" onclick="scrapeShowCover('${show.id}', '${show.title.replace(/'/g, "\\'")}')" id="btn-scrape-${show.id}"><i data-lucide="search" style="width:14px;height:14px;margin-right:4px;vertical-align:middle;"></i> Buscar Carátula HD</button>
            <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.8rem; height: 32px;" onclick="openMediaEditor('${show.id}')">Editar Multimedia</button>
            ${show.media_type === 'anime' ? `<button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.8rem; height: 32px; background: rgba(39, 201, 63, 0.2); border-color: #27c93f;" onclick="triggerSAID('${show.id}')" id="btn-said-${show.id}"><i data-lucide="scan" style="width:14px;height:14px;margin-right:4px;vertical-align:middle;"></i> Detectar Intros</button>` : ''}
            <button class="btn-danger-small" onclick="deleteShow('${show.id}', '${show.title}')">Eliminar</button>
          </div>
        </div>
      `;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    console.error('Error loading admin shows list:', e);
    showsList.innerHTML = '<p style="color: var(--danger-color)">Error al cargar la lista.</p>';
  }
}

// Global binding for deleteShow (so inline onclick works)
window.triggerSAID = async (showId) => {
  const seasonNum = prompt("Introduce el número de temporada a escanear:", "1");
  if (!seasonNum) return;
  const btn = document.getElementById(`btn-said-${showId}`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:4px;"></div> Procesando...`;
  }
  try {
    const res = await fetch('/api/admin/detect-intros', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, seasonNumber: parseInt(seasonNum, 10) })
    });
    const data = await res.json();
    if (data.success) {
      alert("¡Detección completada con éxito!");
    } else {
      alert("Error: " + (data.message || data.error));
    }
  } catch (e) {
    alert("Error de conexión al detectar intros.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="scan" style="width:14px;height:14px;margin-right:4px;vertical-align:middle;"></i> Detectar Intros`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  }
};

window.deleteShow = async (id, title) => {
  if (!confirm(`¿Estás seguro de que quieres eliminar "${title}" de la biblioteca? Esto borrará físicamente todos sus archivos de vídeo del servidor.`)) {
    return;
  }
  
  try {
    const res = await fetch(`/api/shows/${id}`, { method: 'DELETE' });
    if (res.ok) {
      alert('Eliminado con éxito.');
      loadAdminPanel();
    } else {
      alert('Error al eliminar de la base de datos.');
    }
  } catch (e) {
    console.error(e);
    alert('Error al realizar la petición.');
  }
};

// Global binding for openMediaEditor dialog
window.openMediaEditor = async (showId) => {
  const modal = document.getElementById('media-edit-modal-overlay');
  const showIdInput = document.getElementById('edit-show-id');
  const loopsList = document.getElementById('edit-show-loops-list');
  const titleHeader = document.getElementById('edit-media-title');
  const closeBtn = document.getElementById('edit-media-close');
  
  showIdInput.value = showId;
  
  try {
    const res = await fetch(`/api/shows/${showId}`);
    const { show, episodes } = await res.json();
    
    titleHeader.textContent = `Editar Multimedia - ${show.title}`;
    
    // Populate backdrop loops list
    let loops = [];
    if (show.backdrop_loops) {
      try {
        loops = typeof show.backdrop_loops === 'string' ? JSON.parse(show.backdrop_loops) : show.backdrop_loops;
        if (typeof loops === 'string') {
          loops = JSON.parse(loops);
        }
      } catch (e) {
        loops = [];
      }
    }
    if (!Array.isArray(loops)) loops = [];
    if (loops.length === 0) {
      loopsList.innerHTML = `<p style="color: var(--text-muted); font-size: 0.8rem; padding: 10px 0;">No hay clips de video de fondo agregados.</p>`;
    } else {
      loopsList.innerHTML = loops.map(url => {
        const filename = url.split('/').pop();
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; background: rgba(255,255,255,0.05); border-radius: 4px; font-size: 0.8rem; margin-bottom: 4px;">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 75%;">${filename}</span>
            <button class="btn" style="color: var(--danger-color); padding: 2px 6px; font-size: 0.75rem; background: transparent; border: none; cursor: pointer;" onclick="deleteShowLoop('${showId}', '${url}')">Eliminar</button>
          </div>
        `;
      }).join('');
    }
    
    // Populate episodes thumbs list grouped by season
    const thumbsList = document.getElementById('edit-episodes-thumbs-list');
    if (episodes.length === 0) {
      thumbsList.innerHTML = `<p style="color: var(--text-muted); font-size: 0.8rem;">No hay episodios importados aún para este anime.</p>`;
    } else {
      // Group episodes by season_number
      const seasonsMap = {};
      episodes.forEach(ep => {
        const sNum = ep.season_number || 1;
        if (!seasonsMap[sNum]) seasonsMap[sNum] = [];
        seasonsMap[sNum].push(ep);
      });

      const seasonsKeys = Object.keys(seasonsMap).sort((a, b) => a - b);
      thumbsList.innerHTML = seasonsKeys.map(sNum => {
        const eps = seasonsMap[sNum];
        const epsHtml = eps.map(ep => {
          const thumbImg = ep.thumbnail_path || (show ? show.poster_path : null) || 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=150&q=80';
          return `
            <div style="display: flex; gap: 12px; align-items: center; padding: 10px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 8px;">
              <img src="${thumbImg}" alt="Episodio ${ep.episode_number}" style="width: 60px; height: 90px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-color);">
              <div style="flex-grow: 1;">
                <span style="font-weight: 600; font-size: 0.9rem; display: block; margin-bottom: 4px;">Capítulo ${ep.episode_number}: ${ep.title}</span>
                <div class="drop-zone ep-thumb-drop-zone" data-episode-id="${ep.id}" style="padding: 10px; margin-top: 5px; flex-direction: row; border-style: dotted; gap: 10px;">
                  <i data-lucide="camera" style="width: 16px; height: 16px; stroke: var(--text-muted);"></i>
                  <span class="drop-zone-text" style="font-size: 0.75rem;">Arrastra aquí miniatura o haz clic</span>
                  <input type="file" class="ep-thumb-file-input" accept="image/*" style="display: none;">
                </div>
                <!-- Time Skipping settings -->
                <div style="display: flex; gap: 8px; margin-top: 10px; align-items: center;">
                  <div style="flex: 1;">
                    <label style="font-size: 0.65rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Inicio Op (MM:SS)</label>
                    <input type="text" placeholder="MM:SS" class="ep-time-input ep-intro-start" data-episode-id="${ep.id}" value="${formatSecondsToMMSS(ep.intro_start)}" style="width: 100%; padding: 4px 6px; border-radius: 4px; border: 1px solid var(--border-color); background: rgba(0,0,0,0.2); color: var(--text-main); font-size: 0.75rem; height: 26px; outline: none;">
                  </div>
                  <div style="flex: 1;">
                    <label style="font-size: 0.65rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Fin Op (MM:SS)</label>
                    <input type="text" placeholder="MM:SS" class="ep-time-input ep-intro-end" data-episode-id="${ep.id}" value="${formatSecondsToMMSS(ep.intro_end)}" style="width: 100%; padding: 4px 6px; border-radius: 4px; border: 1px solid var(--border-color); background: rgba(0,0,0,0.2); color: var(--text-main); font-size: 0.75rem; height: 26px; outline: none;">
                  </div>
                  <div style="flex: 1;">
                    <label style="font-size: 0.65rem; color: var(--text-muted); display: block; margin-bottom: 2px;">Inicio Ed (MM:SS)</label>
                    <input type="text" placeholder="MM:SS" class="ep-time-input ep-outro-start" data-episode-id="${ep.id}" value="${formatSecondsToMMSS(ep.outro_start)}" style="width: 100%; padding: 4px 6px; border-radius: 4px; border: 1px solid var(--border-color); background: rgba(0,0,0,0.2); color: var(--text-main); font-size: 0.75rem; height: 26px; outline: none;">
                  </div>
                  <button class="btn btn-primary btn-save-ep-times" data-episode-id="${ep.id}" style="height: 26px; padding: 0 8px; font-size: 0.75rem; margin-top: 15px; display: flex; align-items: center; justify-content: center; min-width: 32px;" title="Guardar tiempos">
                    <i data-lucide="check" style="width: 12px; height: 12px; margin: 0;"></i>
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('');

        return `
          <div class="season-admin-group" style="margin-bottom: 20px;">
            <h4 class="season-toggle-header" data-season="${sNum}" style="font-family: var(--font-title); font-size: 1rem; color: var(--accent-color); border-bottom: 1px solid var(--border-color); padding-bottom: 6px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none;">
              <span style="display: flex; align-items: center; gap: 8px;">
                <i data-lucide="layers" style="width: 16px; height: 16px;"></i> Temporada ${sNum}
              </span>
              <i data-lucide="chevron-down" class="chevron-icon" style="width: 16px; height: 16px; transition: transform var(--transition-fast);"></i>
            </h4>
            <div class="season-episodes-container" id="season-eps-${sNum}" style="display: flex; flex-direction: column; gap: 5px;">
              ${epsHtml}
            </div>
          </div>
        `;
      }).join('');
    }
    
    modal.style.display = 'flex';

    // Setup Season Accordion Toggles
    const toggles = thumbsList.querySelectorAll('.season-toggle-header');
    toggles.forEach(toggle => {
      toggle.addEventListener('click', () => {
        const sNum = toggle.dataset.season;
        const container = document.getElementById(`season-eps-${sNum}`);
        const chevron = toggle.querySelector('.chevron-icon');
        
        if (container.style.display === 'none') {
          container.style.display = 'flex';
          chevron.style.transform = 'rotate(0deg)';
        } else {
          container.style.display = 'none';
          chevron.style.transform = 'rotate(-90deg)';
        }
      });
    });
    
    // Setup modal drag and drop zones
    makeDropZone('poster-drop-zone', (file) => uploadShowMedia(showId, file, 'poster'), 'poster-file-input');
    makeDropZone('backdrop-drop-zone', (file) => uploadShowMedia(showId, file, 'backdrop'), 'backdrop-file-input');
    makeDropZone('loop-drop-zone', (file) => uploadShowLoop(showId, file), 'loop-file-input');
    
    // Setup dynamic episode thumbnail dropzones
    const epDropZones = thumbsList.querySelectorAll('.ep-thumb-drop-zone');
    epDropZones.forEach(zone => {
      const epId = zone.dataset.episodeId;
      const input = zone.querySelector('.ep-thumb-file-input');
      
      // Bind drag and drop events
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        zone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
        }, false);
      });
      zone.addEventListener('dragover', () => zone.classList.add('dragover'));
      zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
      zone.addEventListener('drop', (e) => {
        zone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
          uploadEpisodeThumb(epId, files[0]);
        }
      });
      zone.addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        if (input.files.length > 0) {
          uploadEpisodeThumb(epId, input.files[0]);
        }
      });
    });
    
    // Bind timings save button clicks
    const saveTimingsBtns = thumbsList.querySelectorAll('.btn-save-ep-times');
    saveTimingsBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const epId = btn.dataset.episodeId;
        const container = btn.parentElement;
        const introStartInput = container.querySelector('.ep-intro-start');
        const introEndInput = container.querySelector('.ep-intro-end');
        const outroStartInput = container.querySelector('.ep-outro-start');

        const introStart = parseMMSSToSeconds(introStartInput.value);
        const introEnd = parseMMSSToSeconds(introEndInput.value);
        const outroStart = parseMMSSToSeconds(outroStartInput.value);

        btn.disabled = true;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '...';

        try {
          const res = await fetch('/api/admin/save-episode-timings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              episodeId: epId,
              introStart,
              introEnd,
              outroStart
            })
          });

          if (res.ok) {
            btn.style.background = '#4af626';
            btn.style.borderColor = '#4af626';
            btn.style.color = '#000';
            btn.innerHTML = '<i data-lucide="check" style="width: 12px; height: 12px; margin: 0;"></i>';
            if (typeof lucide !== 'undefined') lucide.createIcons();
            
            setTimeout(() => {
              btn.style.background = '';
              btn.style.borderColor = '';
              btn.style.color = '';
              btn.innerHTML = originalHtml;
              btn.disabled = false;
              if (typeof lucide !== 'undefined') lucide.createIcons();
            }, 2000);
          } else {
            alert('Error al guardar tiempos.');
            btn.disabled = false;
            btn.innerHTML = originalHtml;
          }
        } catch (err) {
          console.error(err);
          alert('Error al comunicarse con el servidor.');
          btn.disabled = false;
          btn.innerHTML = originalHtml;
        }
      });
    });
    
    if (typeof lucide !== 'undefined') lucide.createIcons();

    closeBtn.onclick = () => {
      modal.style.display = 'none';
      loadDashboard(); // Refresh background loops & layout when closing modal editor
    };
  } catch (err) {
    alert('Error al abrir editor multimedia: ' + err.message);
  }
};

window.deleteShowLoop = async (showId, videoUrl) => {
  if (!confirm('¿Estás seguro de que quieres eliminar este clip de video de fondo?')) return;
  try {
    const res = await fetch('/api/admin/delete-backdrop-loop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, videoUrl })
    });
    if (res.ok) {
      alert('Clip de video de fondo eliminado.');
      openMediaEditor(showId); // Refresh modal
    } else {
      throw new Error(await res.text());
    }
  } catch (e) {
    alert(e.message);
  }
};

// Drag and Drop Zone Helper
function makeDropZone(elementId, onFileDrop, inputId = null) {
  const el = document.getElementById(elementId);
  if (!el) return;
  
  // Prevent default drag behaviors
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    el.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, false);
  });
  
  el.addEventListener('dragover', () => {
    el.classList.add('dragover');
  });
  
  el.addEventListener('dragleave', () => {
    el.classList.remove('dragover');
  });
  
  el.addEventListener('drop', (e) => {
    el.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      onFileDrop(files[0]);
    }
  });
  
  if (inputId) {
    const input = document.getElementById(inputId);
    if (input) {
      el.addEventListener('click', (e) => {
        // Only click if it wasn't triggered by children clicks
        if (e.target === el || el.contains(e.target)) {
          input.click();
        }
      });
      input.addEventListener('change', () => {
        if (input.files.length > 0) {
          onFileDrop(input.files[0]);
        }
      });
    }
  }
}

// Logo upload handler
async function uploadLogo(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const res = await fetch('/api/admin/upload-logo', {
      method: 'POST',
      body: formData
    });
    if (res.ok) {
      alert('¡Logotipo actualizado con éxito!');
      const customLogo = document.getElementById('custom-logo');
      customLogo.src = '/library/logo.png?t=' + Date.now();
      customLogo.style.display = 'block';
      document.getElementById('fallback-logo').style.display = 'none';
    } else {
      throw new Error(await res.text());
    }
  } catch (err) {
    alert('Error al subir logotipo: ' + err.message);
  }
}

// Show media upload handler
async function uploadShowMedia(showId, file, type) {
  const formData = new FormData();
  formData.append('showId', showId);
  formData.append(type, file);
  
  try {
    const res = await fetch('/api/admin/upload-show-media', {
      method: 'POST',
      body: formData
    });
    if (res.ok) {
      alert(`¡${type === 'poster' ? 'Póster' : 'Fondo'} actualizado con éxito!`);
      openMediaEditor(showId); // Refresh modal
      loadAdminPanel(); // Refresh admin shows list
    } else {
      throw new Error(await res.text());
    }
  } catch (err) {
    alert('Error al subir imagen: ' + err.message);
  }
}

// Background loop video upload handler
async function uploadShowLoop(showId, file) {
  const formData = new FormData();
  formData.append('showId', showId);
  formData.append('video', file);
  
  try {
    const res = await fetch('/api/admin/upload-backdrop-loop', {
      method: 'POST',
      body: formData
    });
    if (res.ok) {
      alert('¡Clip de video de fondo agregado con éxito!');
      openMediaEditor(showId); // Refresh modal
    } else {
      throw new Error(await res.text());
    }
  } catch (err) {
    alert('Error al subir video: ' + err.message);
  }
}

// Episode thumbnail upload handler
async function uploadEpisodeThumb(episodeId, file) {
  const applyToSeason = confirm("¿Deseas aplicar esta portada a TODOS los capítulos de esta temporada?\n\n(Aceptar: Aplicar a toda la temporada, Cancelar: Aplicar solo a este capítulo)");
  
  const formData = new FormData();
  formData.append('episodeId', episodeId);
  formData.append('image', file);
  formData.append('applyToSeason', applyToSeason ? 'true' : 'false');
  
  try {
    const res = await fetch('/api/admin/upload-episode-thumb', {
      method: 'POST',
      body: formData
    });
    if (res.ok) {
      alert('¡Miniatura de capítulo actualizada con éxito!');
      const showId = document.getElementById('edit-show-id').value;
      openMediaEditor(showId); // Refresh modal
    } else {
      throw new Error(await res.text());
    }
  } catch (e) {
    alert(e.message);
  }
}

// Show Episode details in a modal
function showEpisodeDetails(episodeId) {
  const ep = currentShowEpisodes.find(e => e.id === episodeId);
  if (!ep) return;

  const numberEl = document.getElementById('ep-detail-number');
  const titleEl = document.getElementById('ep-detail-title');
  const synopsisEl = document.getElementById('ep-detail-synopsis');
  const durationEl = document.getElementById('ep-detail-duration');
  const resolutionEl = document.getElementById('ep-detail-resolution');
  const codecEl = document.getElementById('ep-detail-codec');
  const sizeEl = document.getElementById('ep-detail-size');
  const audioEl = document.getElementById('ep-detail-audio');
  const subsEl = document.getElementById('ep-detail-subtitles');
  const playBtn = document.getElementById('ep-detail-play-btn');
  const closeBtn = document.getElementById('ep-detail-close');
  const modal = document.getElementById('episode-detail-modal');

  if (numberEl) {
    numberEl.textContent = ep.season_number ? `Temporada ${ep.season_number} • Capítulo ${ep.episode_number}` : `Capítulo ${ep.episode_number}`;
  }
  if (titleEl) titleEl.textContent = ep.title || `Capítulo ${ep.episode_number}`;
  if (synopsisEl) synopsisEl.textContent = ep.synopsis || 'Sin descripción disponible para este capítulo.';
  if (durationEl) durationEl.textContent = `${Math.round(ep.duration / 60)} min`;
  if (resolutionEl) resolutionEl.textContent = ep.resolution || 'N/A';
  if (codecEl) codecEl.textContent = ep.video_codec || 'N/A';
  if (sizeEl) sizeEl.textContent = ep.size ? `${(ep.size / (1024 * 1024)).toFixed(1)} MB` : 'N/A';

  // Audio Tracks
  if (audioEl) {
    let audioTracks = [];
    if (ep.audio_tracks) {
      try {
        audioTracks = typeof ep.audio_tracks === 'string' ? JSON.parse(ep.audio_tracks) : ep.audio_tracks;
      } catch (e) {
        audioTracks = [];
      }
    }
    if (!Array.isArray(audioTracks)) audioTracks = [];
    if (audioTracks.length === 0) {
      audioEl.innerHTML = '<li>Información no disponible</li>';
    } else {
      audioEl.innerHTML = audioTracks.map(t => {
        const title = t.title || `Pista ${t.track_number}`;
        const lang = t.language ? t.language.toUpperCase() : 'UND';
        return `<li>${title} [${lang}]</li>`;
      }).join('');
    }
  }

  // Subtitle Tracks
  if (subsEl) {
    let subtitleTracks = [];
    if (ep.subtitle_tracks) {
      try {
        subtitleTracks = typeof ep.subtitle_tracks === 'string' ? JSON.parse(ep.subtitle_tracks) : ep.subtitle_tracks;
      } catch (e) {
        subtitleTracks = [];
      }
    }
    if (!Array.isArray(subtitleTracks)) subtitleTracks = [];
    if (subtitleTracks.length === 0) {
      subsEl.innerHTML = '<li>Sin subtítulos incrustados</li>';
    } else {
      subsEl.innerHTML = subtitleTracks.map(t => {
        const title = t.title || `Pista ${t.track_number}`;
        const lang = t.language ? t.language.toUpperCase() : 'UND';
        return `<li>${title} [${lang}]</li>`;
      }).join('');
    }
  }

  // Play button binding
  if (playBtn) {
    playBtn.onclick = () => {
      if (modal) modal.style.display = 'none';
      location.hash = `#/player/${ep.id}`;
    };
  }

  // Close button binding
  if (closeBtn) {
    closeBtn.onclick = () => {
      if (modal) modal.style.display = 'none';
    };
  }

  if (modal) {
    modal.style.display = 'flex';
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.showEpisodeDetails = showEpisodeDetails;

// Settings handling functions
function setupSettingsView() {
  const selectAudio = document.getElementById('pref-audio-lang');
  const selectSub = document.getElementById('pref-sub-lang');
  const toast = document.getElementById('settings-save-success');
  let toastTimeout = null;

  function saveSetting(key, value) {
    localStorage.setItem(key, value);
    if (toast) {
      toast.style.display = 'flex';
      if (typeof lucide !== 'undefined') lucide.createIcons();
      clearTimeout(toastTimeout);
      toastTimeout = setTimeout(() => {
        toast.style.display = 'none';
      }, 3000);
    }
  }

  if (selectAudio) {
    selectAudio.addEventListener('change', () => {
      saveSetting('kura_pref_audio_lang', selectAudio.value);
    });
  }

  if (selectSub) {
    selectSub.addEventListener('change', () => {
      saveSetting('kura_pref_sub_lang', selectSub.value);
    });
  }
}

function loadSettingsView() {
  const audioLang = localStorage.getItem('kura_pref_audio_lang') || 'default';
  const subLang = localStorage.getItem('kura_pref_sub_lang') || 'default';

  const selectAudio = document.getElementById('pref-audio-lang');
  const selectSub = document.getElementById('pref-sub-lang');

  if (selectAudio) selectAudio.value = audioLang;
  if (selectSub) selectSub.value = subLang;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// --- OPTIONAL USER AUTHENTICATION SYSTEM ---
let isRegisterTab = false;

function setupUserAuth() {
  const loginTrigger = document.getElementById('btn-login-trigger');
  const userProfileTrigger = document.getElementById('user-profile-trigger');
  const userDropdownCard = document.getElementById('user-dropdown-card');
  const loginModal = document.getElementById('login-modal');
  const modalCancel = document.getElementById('login-modal-cancel');
  const modalSubmit = document.getElementById('login-modal-submit');
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const logoutBtn = document.getElementById('btn-logout');
  const adminDirectBtn = document.getElementById('btn-admin-direct');

  // Load session from localStorage
  const sessionStr = localStorage.getItem('kura_user_session');
  // With the landing page enabled, we do not automatically show the login modal on startup if there is no session

  if (sessionStr) {
    try {
      const session = JSON.parse(sessionStr);
      updateUserInterface(session);
    } catch (e) {
      updateUserInterface(null);
    }
  } else {
    updateUserInterface(null);
  }

  // Toggle user dropdown on click
  if (userProfileTrigger) {
    userProfileTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdownCard.style.display = userDropdownCard.style.display === 'none' ? 'block' : 'none';
    });
    // Close dropdown on click outside
    document.addEventListener('click', () => {
      userDropdownCard.style.display = 'none';
    });
  }

  // Open modal
  if (loginTrigger) {
    loginTrigger.onclick = () => {
      loginModal.style.display = 'flex';
      switchAuthTab('login');
      document.getElementById('login-username-input').value = '';
      document.getElementById('login-password-input').value = '';
      document.getElementById('login-error-msg').style.display = 'none';
    };
  }

  // Cancel modal
  if (modalCancel) {
    modalCancel.onclick = () => {
      loginModal.style.display = 'none';
    };
  }

  // Tab switching
  if (tabLogin) {
    tabLogin.onclick = () => switchAuthTab('login');
  }
  if (tabRegister) {
    tabRegister.onclick = () => switchAuthTab('register');
  }

  function switchAuthTab(tab) {
    if (tab === 'login') {
      isRegisterTab = false;
      tabLogin.classList.add('active');
      tabLogin.style.borderBottomColor = 'var(--accent-color)';
      tabRegister.classList.remove('active');
      tabRegister.style.borderBottomColor = 'transparent';
      tabRegister.style.color = 'var(--text-muted)';
      tabLogin.style.color = 'var(--text-main)';
      document.getElementById('login-modal-title').textContent = 'Inicia sesión en tu cuenta';
    } else {
      isRegisterTab = true;
      tabRegister.classList.add('active');
      tabRegister.style.borderBottomColor = 'var(--accent-color)';
      tabLogin.classList.remove('active');
      tabLogin.style.borderBottomColor = 'transparent';
      tabLogin.style.color = 'var(--text-muted)';
      tabRegister.style.color = 'var(--text-main)';
      document.getElementById('login-modal-title').textContent = 'Crea tu cuenta de usuario';
    }
  }

  // Submit modal
  if (modalSubmit) {
    modalSubmit.onclick = async () => {
      const usernameInput = document.getElementById('login-username-input');
      const passwordInput = document.getElementById('login-password-input');
      const errorMsg = document.getElementById('login-error-msg');

      const username = usernameInput.value.trim();
      const password = passwordInput.value.trim();

      if (!username || !password) {
        errorMsg.textContent = 'Por favor, rellena todos los campos';
        errorMsg.style.display = 'block';
        return;
      }

      modalSubmit.disabled = true;
      modalSubmit.textContent = 'Procesando...';
      errorMsg.style.display = 'none';

      try {
        const url = isRegisterTab ? '/api/register' : '/api/login';
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (res.ok) {
          if (isRegisterTab) {
            // Auto login after registering successfully
            const logRes = await fetch('/api/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username, password })
            });
            const logData = await logRes.json();
            if (logRes.ok) {
              localStorage.setItem('kura_user_session', JSON.stringify(logData));
              localStorage.setItem('kura_base_user_session', JSON.stringify(logData));
              updateUserInterface(logData);
              if (loginModal) {
                loginModal.classList.remove('lockout');
                loginModal.style.display = 'none';
              }
              window.dispatchEvent(new Event('hashchange'));
            } else {
              errorMsg.textContent = logData.message || 'Error al iniciar sesión automáticamente';
              errorMsg.style.display = 'block';
              return;
            }
          } else {
            // Standard login success
            localStorage.setItem('kura_user_session', JSON.stringify(data));
            localStorage.setItem('kura_base_user_session', JSON.stringify(data));
            updateUserInterface(data);
            if (loginModal) {
              loginModal.classList.remove('lockout');
              loginModal.style.display = 'none';
            }
            window.dispatchEvent(new Event('hashchange'));
          }
          
          // Refresh views to apply identity (update comments user info)
          if (currentView === 'show' && window.location.hash.startsWith('#/show/')) {
            const showId = window.location.hash.split('/').pop();
            loadShowComments(showId);
          }
        } else {
          errorMsg.textContent = data.message || 'Error al registrar el usuario';
          errorMsg.style.display = 'block';
        }
      } catch (err) {
        console.error(err);
        errorMsg.textContent = 'Error de conexión con el servidor';
        errorMsg.style.display = 'block';
      } finally {
        modalSubmit.disabled = false;
        modalSubmit.textContent = 'Aceptar';
      }
    };
  }

  // Logout
  if (logoutBtn) {
    logoutBtn.onclick = (e) => {
      e.preventDefault();
      localStorage.removeItem('kura_user_session');
      localStorage.removeItem('kura_base_user_session');
      updateUserInterface(null);
      window.dispatchEvent(new Event('hashchange'));
      // Refresh details comments if open
      if (currentView === 'show' && window.location.hash.startsWith('#/show/')) {
        const showId = window.location.hash.split('/').pop();
        loadShowComments(showId);
      }
    };
  }

  // Direct Admin view btn
  if (adminDirectBtn) {
    adminDirectBtn.onclick = (e) => {
      e.preventDefault();
      location.hash = '#/admin';
    };
  }
}

async function updateUserInterface(session) {
  const loginTrigger = document.getElementById('btn-login-trigger');
  const userProfileMenu = document.getElementById('user-profile-menu');
  const userProfileName = document.getElementById('user-profile-name');
  const userAvatarInitial = document.getElementById('user-avatar-initial');
  const adminDirectBtn = document.getElementById('btn-admin-direct');
  const listEl = document.getElementById('dropdown-profiles-list');

  if (session && session.success) {
    if (loginTrigger) loginTrigger.style.display = 'none';
    if (userProfileMenu) userProfileMenu.style.display = 'block';
    if (userProfileName) userProfileName.textContent = session.username;
    
    // Set token for admin panel auth checks
    if (session.role === 'admin') {
      localStorage.setItem('kura_admin_token', session.token);
      if (adminDirectBtn) adminDirectBtn.style.display = 'flex';
    } else {
      localStorage.removeItem('kura_admin_token');
      if (adminDirectBtn) adminDirectBtn.style.display = 'none';
    }

    if (listEl && session.token) {
      const decoded = getDecodedToken(session.token);
      try {
        const res = await fetch('/api/profiles', {
          headers: { 'Authorization': `Bearer ${session.token}` }
        });
        const data = await res.json();
        if (data && data.success) {
          listEl.innerHTML = '';
          data.profiles.forEach(p => {
            if (decoded && p.profile_name === decoded.profile_name) return;
            const pColor = p.avatar_color || '#a855f7';
            const isImg = pColor.startsWith('/');
            const avatarBg = isImg ? `background-image: url('${pColor}'); background-size: cover; background-position: center;` : `background: ${pColor};`;
            const item = document.createElement('div');
            item.className = 'dropdown-profile-item';
            item.style.cssText = 'display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 6px; cursor: pointer; transition: background 0.2s;';
            item.innerHTML = `
              <div style="width: 24px; height: 24px; border-radius: 4px; ${avatarBg} display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; color: #fff;">${isImg ? '' : p.profile_name[0].toUpperCase()}</div>
              <span style="font-size: 0.85rem; color: var(--text-main); font-weight: 500;">${p.profile_name}</span>
            `;
            item.onclick = (e) => {
              e.stopPropagation();
              const userDropdownCard = document.getElementById('user-dropdown-card');
              if (userDropdownCard) userDropdownCard.style.display = 'none';
              if (p.pin) openPinModal(p);
              else selectProfile(p.profile_name, '');
            };
            listEl.appendChild(item);
          });
        }
      } catch(err) {
        console.error('Error loading dropdown profiles:', err);
      }
    }
  } else {
    if (listEl) listEl.innerHTML = '';
    if (loginTrigger) loginTrigger.style.display = 'flex';
    if (userProfileMenu) userProfileMenu.style.display = 'none';
    if (adminDirectBtn) adminDirectBtn.style.display = 'none';
    localStorage.removeItem('kura_admin_token');
    
    // Hide profile switcher and show dashboard when logging out
    const switcher = document.getElementById('profile-switcher-view');
    if (switcher) switcher.classList.remove('active');
    const dashboard = document.getElementById('dashboard-view');
    if (dashboard) dashboard.classList.add('active');
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Inactivity Auto-Lock Timer
let lastActivityTime = Date.now();
const resetActivityTimer = () => {
  lastActivityTime = Date.now();
};

['mousemove', 'mousedown', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
  window.addEventListener(evt, resetActivityTimer, { passive: true });
});

setInterval(() => {
  const sessionStr = localStorage.getItem('kura_user_session');
  if (!sessionStr) return;
  const session = JSON.parse(sessionStr);
  const decoded = getDecodedToken(session.token);
  
  if (decoded && decoded.profile_name) {
    const elapsed = Date.now() - lastActivityTime;
    if (elapsed > 30 * 60 * 1000) { // 30 minutes
      // Deselect profile: restore baseline user token
      const baseSessionStr = localStorage.getItem('kura_base_user_session');
      if (baseSessionStr) {
        localStorage.setItem('kura_user_session', baseSessionStr);
        window.location.reload();
      }
    }
  }
}, 10000);

// --- COMMUNITY CHAT CLIENT ---
let chatPollInterval = null;
let chatWindowOpen = false;
let loadedMessageIds = new Set();

function setupCommunityChat() {
  const chatTrigger = document.getElementById('chat-trigger-btn');
  const chatWindow = document.getElementById('chat-window-card');
  const chatClose = document.getElementById('chat-close-btn');
  const chatInput = document.getElementById('chat-input-msg');
  const chatSend = document.getElementById('chat-send-btn');
  const chatBody = document.getElementById('chat-messages-body');
  const chatUnread = document.getElementById('chat-unread-badge');

  if (!chatTrigger) return;

  chatTrigger.onclick = (e) => {
    e.stopPropagation();
    chatWindowOpen = !chatWindowOpen;
    if (chatWindowOpen) {
      chatWindow.style.display = 'flex';
      chatUnread.style.display = 'none';
      fetchChatMessages(true); // force scroll down
      // Start polling
      if (!chatPollInterval) {
        chatPollInterval = setInterval(() => fetchChatMessages(false), 4000);
      }
    } else {
      chatWindow.style.display = 'none';
      if (chatPollInterval) {
        clearInterval(chatPollInterval);
        chatPollInterval = null;
      }
    }
  };

  if (chatClose) {
    chatClose.onclick = (e) => {
      e.stopPropagation();
      chatWindowOpen = false;
      chatWindow.style.display = 'none';
      if (chatPollInterval) {
        clearInterval(chatPollInterval);
        chatPollInterval = null;
      }
    };
  }

  // Keep polling in the background to show unread badge even when closed
  setInterval(() => {
    if (!chatWindowOpen) {
      fetchChatMessages(false);
    }
  }, 5000);

  // Send Message Logic
  const sendMessage = async () => {
    const text = chatInput.value.trim();
    if (!text) return;

    // Resolve username from session or guest
    let username = 'Invitado';
    const sessionStr = localStorage.getItem('kura_user_session');
    if (sessionStr) {
      try { username = JSON.parse(sessionStr).username; } catch(e) {}
    }

    chatInput.value = '';
    chatSend.disabled = true;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, message: text })
      });
      if (res.ok) {
        fetchChatMessages(true);
      }
    } catch (err) {
      console.error(err);
    } finally {
      chatSend.disabled = false;
      chatInput.focus();
    }
  };

  if (chatSend) {
    chatSend.onclick = sendMessage;
  }

  if (chatInput) {
    chatInput.onkeypress = (e) => {
      if (e.key === 'Enter') {
        sendMessage();
      }
    };
  }

  async function fetchChatMessages(forceScroll = false) {
    if (!chatBody) return;

    try {
      const res = await fetch('/api/chat');
      const messages = await res.json();
      
      let newMessagesReceived = false;
      let html = '';

      messages.forEach(msg => {
        if (!loadedMessageIds.has(msg.id)) {
          newMessagesReceived = true;
          loadedMessageIds.add(msg.id);
        }

        const isUserAdmin = msg.username === 'TheCarlosS5';
        html += `
          <div class="chat-message-bubble ${isUserAdmin ? 'admin' : ''}" style="margin-bottom: 6px; padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); font-size: 0.82rem; line-height: 1.4; color: var(--text-main); max-width: 90%; align-self: flex-start;">
            <div class="chat-message-meta" style="display: flex; justify-content: space-between; gap: 10px; margin-bottom: 4px; font-size: 0.72rem; font-weight: 700;">
              <span style="color: ${isUserAdmin ? 'var(--accent-color)' : 'var(--text-muted)'};">${msg.username}</span>
              <span style="font-weight: 400; color: var(--text-muted);">${formatTimeStr(msg.created_at)}</span>
            </div>
            <div style="white-space: pre-wrap; word-break: break-word;">${escapeHTML(msg.message)}</div>
          </div>
        `;
      });

      if (messages.length === 0) {
        chatBody.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding-top: 30px;">No hay mensajes todavía. ¡Saluda a la comunidad!</div>`;
        return;
      }

      chatBody.innerHTML = html;

      if (chatWindowOpen) {
        if (forceScroll || newMessagesReceived) {
          chatBody.scrollTop = chatBody.scrollHeight;
        }
      } else {
        if (newMessagesReceived && loadedMessageIds.size > messages.length) {
          // Only show unread if not the initial load
          chatUnread.style.display = 'block';
        }
      }
    } catch (e) {
      console.warn("Chat sync error:", e);
    }
  }
}

// --- COMMENTS SYSTEM CLIENT ---
async function loadShowComments(showId) {
  const commentsList = document.getElementById('comments-list');
  const commentTextarea = document.getElementById('comment-textarea');
  const btnSubmit = document.getElementById('btn-submit-comment');
  const commentAvatar = document.getElementById('comment-user-avatar');
  const authorNameSpan = document.getElementById('comment-author-name');
  
  if (!commentsList) return;
  commentsList.innerHTML = '<div class="spinner" style="margin: 20px auto;"></div>';

  // Resolve username
  const sessionStr = localStorage.getItem('kura_user_session');
  let username = 'Invitado';
  let isLoggedIn = false;
  if (sessionStr) {
    try {
      const session = JSON.parse(sessionStr);
      username = session.username;
      isLoggedIn = true;
    } catch(e) {}
  }

  // Update editor values
  if (commentAvatar) {
    commentAvatar.textContent = (username && username.length > 0) ? username[0].toUpperCase() : 'I';
  }
  if (authorNameSpan) {
    authorNameSpan.textContent = username;
  }
  const notice = document.getElementById('comment-guest-notice');
  if (notice) {
    if (isLoggedIn) {
      notice.innerHTML = `Comentando como <strong style="color: var(--accent-color);">${username}</strong>.`;
    } else {
      notice.innerHTML = `Comentarás como <strong style="color: var(--accent-color);">Invitado</strong>. Inicia sesión para usar tu cuenta.`;
    }
  }

  // Fetch and display
  try {
    const res = await fetch(`/api/comments?showId=${showId}`);
    const comments = await res.json();
    
    if (comments.length === 0) {
      commentsList.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem; padding: 20px 0; text-align: center;">No hay comentarios todavía. ¡Sé el primero en comentar!</p>`;
    } else {
      commentsList.innerHTML = comments.map(c => {
        const isUserAdmin = c.username === 'TheCarlosS5';
        const initial = (c.username || '?')[0].toUpperCase();
        
        let avatarBg = 'var(--accent-color)';
        if (!isUserAdmin) {
          const colors = ['#3a4b6e', '#2c5d63', '#a370f7', '#f76b8a', '#6aa384', '#d8853b'];
          let sum = 0;
          for (let i = 0; i < c.username.length; i++) sum += c.username.charCodeAt(i);
          avatarBg = colors[sum % colors.length];
        }
        
        return `
          <div class="comment-item" style="display: flex; gap: 15px; padding: 15px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 8px;">
            <div class="comment-avatar" style="width: 36px; height: 36px; border-radius: 50%; background: ${avatarBg}; color: var(--text-main); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.95rem; flex-shrink: 0; ${isUserAdmin ? 'box-shadow: 0 0 10px var(--accent-glow); border: 1px solid var(--accent-color);' : ''}">
              ${initial}
            </div>
            <div class="comment-info" style="display: flex; flex-direction: column; gap: 4px; flex-grow: 1;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="comment-username" style="font-weight: 600; font-size: 0.88rem; color: ${isUserAdmin ? 'var(--accent-color)' : 'var(--text-main)'};">${c.username}</span>
                ${isUserAdmin ? '<span class="badge" style="background: var(--accent-color); font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 700;">ADMIN</span>' : ''}
                <span class="comment-date" style="font-size: 0.75rem; color: var(--text-muted);">${formatTimeDiff(c.created_at)}</span>
              </div>
              <div class="comment-body" style="font-size: 0.88rem; color: var(--text-muted); line-height: 1.5; margin-top: 4px; white-space: pre-wrap; word-break: break-word;">${escapeHTML(c.comment)}</div>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch(e) {
    console.error("Comments load failed:", e);
    commentsList.innerHTML = `<p style="color: var(--danger-color); font-size: 0.85rem; padding: 20px 0; text-align: center;">Error al cargar comentarios.</p>`;
  }

  // Bind comment submission
  btnSubmit.onclick = async (e) => {
    e.preventDefault();
    const comment = commentTextarea.value.trim();
    if (!comment) return;

    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Enviando...';

    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showId, username, comment })
      });
      if (res.ok) {
        commentTextarea.value = '';
        await loadShowComments(showId);
      } else {
        alert('Error al publicar comentario.');
      }
    } catch(err) {
      console.error(err);
      alert('Error de red al publicar comentario.');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Comentar';
    }
  };
}

// --- CORE UTILITY FUNCTIONS ---
function formatTimeStr(dateStr) {
  // Parses a date and returns HH:MM format
  try {
    let date = new Date(dateStr.replace(' ', 'T') + 'Z');
    if (isNaN(date.getTime())) date = new Date(dateStr);
    const hrs = date.getHours().toString().padStart(2, '0');
    const mins = date.getMinutes().toString().padStart(2, '0');
    return `${hrs}:${mins}`;
  } catch(e) {
    return '';
  }
}

function formatTimeDiff(dateStr) {
  try {
    let date = new Date(dateStr.replace(' ', 'T') + 'Z');
    if (isNaN(date.getTime())) date = new Date(dateStr);
    const diffMs = Date.now() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    
    if (diffSec < 60) return 'Hace un momento';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `Hace ${diffMin} min`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `Hace ${diffHrs} ${diffHrs === 1 ? 'hora' : 'horas'}`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `Hace ${diffDays} ${diffDays === 1 ? 'día' : 'días'}`;
    return date.toLocaleDateString();
  } catch (e) {
    return 'N/A';
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.setupUserAuth = setupUserAuth;
window.setupCommunityChat = setupCommunityChat;
window.loadShowComments = loadShowComments;

// --- PAGINATION & POPULAR SIDEBAR HELPERS ---
function createPaginationHTML(currentPage, totalPages, mediaType) {
  if (totalPages <= 1) return '';
  
  let buttonsHTML = '';
  
  // Previous button
  buttonsHTML += `
    <button class="btn btn-secondary ${currentPage === 1 ? 'disabled' : ''}" 
            style="padding: 8px 16px; font-size: 0.8rem; display: flex; align-items: center; gap: 4px;" 
            ${currentPage === 1 ? 'disabled' : ''} 
            onclick="window.changeShowsPage(${currentPage - 1}, '${mediaType}')">
      <i data-lucide="chevron-left" style="width:14px;height:14px;"></i> Anterior
    </button>
  `;
  
  // Page numbers
  for (let i = 1; i <= totalPages; i++) {
    buttonsHTML += `
      <button class="btn ${currentPage === i ? 'btn-primary' : 'btn-secondary'}" 
              style="padding: 8px 16px; font-size: 0.8rem; min-width: 36px; ${currentPage === i ? '' : 'background: rgba(255,255,255,0.03); border-color: var(--border-color);'}" 
              onclick="window.changeShowsPage(${i}, '${mediaType}')">
        ${i}
      </button>
    `;
  }
  
  // Next button
  buttonsHTML += `
    <button class="btn btn-secondary ${currentPage === totalPages ? 'disabled' : ''}" 
            style="padding: 8px 16px; font-size: 0.8rem; display: flex; align-items: center; gap: 4px;" 
            ${currentPage === totalPages ? 'disabled' : ''} 
            onclick="window.changeShowsPage(${currentPage + 1}, '${mediaType}')">
      Siguiente <i data-lucide="chevron-right" style="width:14px;height:14px;"></i>
    </button>
  `;
  
  return `
    <div class="pagination-container" style="display: flex; justify-content: center; gap: 8px; margin-top: 30px; margin-bottom: 20px; align-items: center;">
      ${buttonsHTML}
    </div>
  `;
}

window.changeShowsPage = (page, mediaType) => {
  currentShowsPage = page;
  loadDashboard(mediaType);
  
  // Smooth scroll back to grid section
  const gridSection = document.querySelector('.grid-container');
  if (gridSection) {
    gridSection.scrollIntoView({ behavior: 'smooth' });
  } else {
    window.scrollTo({ top: 400, behavior: 'smooth' });
  }
};

async function loadPopularSidebar(currentShowId) {
  const popularSidebar = document.getElementById('detail-popular-sidebar');
  if (!popularSidebar) return;
  
  popularSidebar.innerHTML = '<div class="spinner" style="margin: 30px auto;"></div>';
  
  try {
    const res = await fetch('/api/shows');
    const allShows = await res.json();
    
    // Sort by rating DESC, exclude current show
    const popularShows = allShows
      .filter(s => s.id !== currentShowId)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 5);
      
    if (popularShows.length === 0) {
      popularSidebar.style.display = 'none';
      // Adjust grid columns if sidebar is empty
      const mainLayout = document.querySelector('.detail-main-layout');
      if (mainLayout) mainLayout.style.gridTemplateColumns = '280px 1fr';
      return;
    }
    
    // Restore layout to 3 columns
    const mainLayout = document.querySelector('.detail-main-layout');
    if (mainLayout) mainLayout.style.gridTemplateColumns = '280px 1fr 260px';
    popularSidebar.style.display = 'flex';

    const popularShowsHTML = popularShows.map(s => {
      const safePoster = (s.poster_path || '').replace(/'/g, "%27");
      return `
        <div class="popular-sidebar-item" onclick="location.hash='#/show/${s.id}'" style="display: flex; gap: 12px; cursor: pointer; padding: 8px; border-radius: 8px; transition: background 0.2s; align-items: center;">
          <img src="${safePoster}" alt="${s.title}" style="width: 50px; height: 75px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-color); flex-shrink: 0;">
          <div style="flex-grow: 1; overflow: hidden;">
            <h4 style="font-size: 0.82rem; font-weight: 600; color: var(--text-main); margin: 0 0 4px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${s.title}">${s.title}</h4>
            <div style="display: flex; align-items: center; gap: 8px; font-size: 0.72rem; color: var(--text-muted);">
              <span>${s.year || '--'}</span>
              <span>•</span>
              <span style="display: flex; align-items: center; gap: 2px; color: var(--rating-color); font-weight: 700;">
                <i data-lucide="star" style="width: 12px; height: 12px; fill: currentColor; stroke: none;"></i>
                ${s.rating ? s.rating.toFixed(1) : '--'}
              </span>
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    popularSidebar.innerHTML = `
      <h3 style="font-family: var(--font-title); font-size: 1rem; margin: 0 0 10px 0; color: var(--text-main); border-bottom: 1px solid var(--border-color); padding-bottom: 8px; display: flex; align-items: center; gap: 6px;">
        <i data-lucide="trending-up" style="width:16px;height:16px;color:var(--accent-color);"></i> Populares
      </h3>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        ${popularShowsHTML}
      </div>
    `;
    
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    console.error("Popular sidebar loading failed:", e);
    popularSidebar.style.display = 'none';
    const mainLayout = document.querySelector('.detail-main-layout');
    if (mainLayout) mainLayout.style.gridTemplateColumns = '280px 1fr';
  }
}

window.loadPopularSidebar = loadPopularSidebar;

function initCustomCursor() {
  const dot = document.getElementById('custom-cursor-dot');
  const ring = document.getElementById('custom-cursor-ring');
  if (!dot || !ring) return;

  if (!window.matchMedia('(pointer: fine)').matches) {
    dot.style.display = 'none';
    ring.style.display = 'none';
    return;
  }

  document.body.classList.add('js-cursor-enabled');

  let mouseX = 0;
  let mouseY = 0;
  let ringX = 0;
  let ringY = 0;
  let targetScale = 1;
  let currentScaleDot = 1;
  let currentScaleRing = 1;
  let hasMoved = false;

  const interactiveSelectors = 'a, button, input, select, textarea, [role="button"], .show-card, .clickable, .episode-item, .player-btn, .nav-link, .dropdown-trigger, .carousel-nav-btn, .carousel-indicators span, .drop-zone, .user-profile-trigger, .user-dropdown-item, .back-link, .header-logo, #btn-login-trigger, #btn-logout, #detail-favorite-btn, #detail-trailer-btn, .play-btn, .next-btn, .back-btn, #trailer-close-btn';

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    
    if (!hasMoved) {
      hasMoved = true;
      dot.style.opacity = '1';
      ring.style.opacity = '1';
      ringX = mouseX;
      ringY = mouseY;
    }
  }, { passive: true });

  function animateCursor() {
    if (hasMoved) {
      currentScaleDot += (targetScale - currentScaleDot) * 0.2;
      currentScaleRing += (targetScale - currentScaleRing) * 0.15;
      
      dot.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0) translate(-50%, -50%) scale(${currentScaleDot})`;
      ringX += (mouseX - ringX) * 0.15;
      ringY += (mouseY - ringY) * 0.15;
      ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%) scale(${currentScaleRing})`;
    }
    requestAnimationFrame(animateCursor);
  }
  animateCursor();

  document.addEventListener('mouseover', (e) => {
    const target = e.target;
    if (!target) return;
    const isInteractive = target.closest(interactiveSelectors);
    if (isInteractive) {
      targetScale = 1.5;
      dot.classList.add('hover');
      ring.classList.add('hover');
    }
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target;
    if (!target) return;
    const isInteractive = target.closest(interactiveSelectors);
    if (isInteractive) {
      targetScale = 1;
      dot.classList.remove('hover');
      ring.classList.remove('hover');
    }
  });

  document.addEventListener('mouseleave', () => {
    dot.style.opacity = '0';
    ring.style.opacity = '0';
  });

  document.addEventListener('mouseenter', () => {
    if (hasMoved) {
      dot.style.opacity = '1';
      ring.style.opacity = '1';
    }
  });
}



// --- PROFILE SWITCHER LOGIC ---
let isProfileManagementMode = false;
let currentProfileSession = null;
let customAvatarBase64 = null;
let selectedPresetPath = null;
let currentEditingProfileColor = null;
const colorsMap = {
  Purple: '#9d00ff',
  Green: '#00e08f',
  Blue: '#007bff',
  Red: '#ff3366',
  Orange: '#ff8800'
};

function getDecodedToken(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(c => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch(e) {
    return null;
  }
}

function updateMosaicBgVisibility() {
  const sessionStr = localStorage.getItem('kura_user_session');
  const mosaicBg = document.getElementById('dashboard-mosaic-bg');
  const gradientOverlay = document.querySelector('.dashboard-gradient-overlay');
  
  if (!sessionStr) {
    if (mosaicBg) mosaicBg.style.display = 'flex';
    if (gradientOverlay) gradientOverlay.style.display = 'block';
    initDashboardMosaic();
  } else {
    if (mosaicBg) mosaicBg.style.display = 'none';
    if (gradientOverlay) gradientOverlay.style.display = 'none';
  }
}

function checkAndShowProfileSwitcher() {
  updateMosaicBgVisibility();
  const profileSwitcherView = document.getElementById('profile-switcher-view');
  const sessionStr = localStorage.getItem('kura_user_session');
  if (!sessionStr) {
    // If not logged in, ensure we are not stuck in profile switcher
    if (profileSwitcherView) profileSwitcherView.classList.remove('active');
    return;
  }
  
  const session = JSON.parse(sessionStr);
  if (!session || !session.token) return;
  
  const decoded = getDecodedToken(session.token);
  if (decoded && !decoded.profile_name) {
    // Show switcher, hide other views
    document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
    if (profileSwitcherView) profileSwitcherView.classList.add('active');
    loadProfilesView();
  } else if (decoded && decoded.profile_name) {
    // Apply profile UI
    applyProfileUI(decoded);
  }
}

function applyProfileUI(decoded) {
  const userAvatarInitial = document.getElementById('user-avatar-initial');
  if (userAvatarInitial && decoded.profile_name) {
    const color = decoded.profile_color || '#a855f7';
    const isImg = color.startsWith('/');
    if (isImg) {
      userAvatarInitial.textContent = '';
      userAvatarInitial.style.backgroundImage = `url('${color}')`;
      userAvatarInitial.style.backgroundSize = 'cover';
      userAvatarInitial.style.backgroundPosition = 'center';
    } else {
      userAvatarInitial.textContent = decoded.profile_name.charAt(0).toUpperCase();
      userAvatarInitial.style.backgroundImage = 'none';
      userAvatarInitial.style.background = color;
    }
    userAvatarInitial.style.boxShadow = isImg ? 'none' : `0 0 10px ${color}80`;
  }
}

async function loadProfilesView() {
  const session = JSON.parse(localStorage.getItem('kura_user_session'));
  if (!session || !session.token) return;
  
  try {
    const res = await fetch('/api/profiles', {
      headers: { 'Authorization': `Bearer ${session.token}` }
    });
    if (!res.ok) throw new Error('Failed to load profiles');
    const data = await res.json();
    if (data && data.success) {
      if (data.profiles.length === 0) {
        const decoded = getDecodedToken(session.token);
        const username = decoded ? decoded.username : 'User';
        const colors = ['#e50914', '#54b4e5', '#56ccf2', '#a855f7', '#27ae60'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        const createRes = await fetch('/api/profiles', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.token}`
          },
          body: JSON.stringify({
            profile_name: username,
            avatar_color: randomColor,
            is_kids: false,
            pin: ''
          })
        });
        if (createRes.ok) {
          const freshRes = await fetch('/api/profiles', {
            headers: { 'Authorization': `Bearer ${session.token}` }
          });
          const freshData = await freshRes.json();
          if (freshData && freshData.profiles) {
            renderProfiles(freshData.profiles);
            return;
          }
        }
      }
      renderProfiles(data.profiles);
    }
  } catch(err) {
    console.error(err);
  }
}

function renderProfiles(profiles) {
  const grid = document.getElementById('profile-grid');
  if (!grid) return;
  grid.innerHTML = '';
  
  profiles.forEach(p => {
    const color = p.avatar_color || '#a855f7';
    const name = p.profile_name || 'Principal';
    const card = document.createElement('div');
    card.className = 'profile-card' + (isProfileManagementMode ? ' edit-mode' : '');
    
    // Check if it has PIN
    const hasPin = !!p.pin;
    const lockIconHTML = hasPin ? `<div class="profile-lock-indicator" style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.6); border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;"><i data-lucide="lock" style="width: 12px; height: 12px; color: #fff;"></i></div>` : '';

    const isImg = color.startsWith('/');
    const bgStyle = isImg 
      ? `background-image: url('${color}'); background-size: cover; background-position: center;`
      : `background: ${color};`;
    const avatarText = isImg ? '' : name.charAt(0).toUpperCase();

    card.innerHTML = `
      <div class="profile-avatar" style="${bgStyle} position: relative; box-shadow: 0 10px 20px rgba(0,0,0,0.4);" data-color="${color}">
        ${avatarText}
        ${lockIconHTML}
      </div>
      <div class="profile-name">${name}</div>
    `;
    
    // Add dynamic hover shadow and scale
    card.addEventListener('mouseenter', () => {
      card.style.transform = 'scale(1.08)';
      const shadowColor = isImg ? '#a855f7' : color;
      card.querySelector('.profile-avatar').style.boxShadow = `0 0 30px ${shadowColor}`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
      card.querySelector('.profile-avatar').style.boxShadow = `0 10px 20px rgba(0,0,0,0.4)`;
    });

    card.addEventListener('click', () => {
      if (isProfileManagementMode) {
        openProfileEditModal(p);
      } else {
        if (hasPin) {
          openPinModal(p);
        } else {
          selectProfile(name, '');
        }
      }
    });
    grid.appendChild(card);
    if (hasPin && typeof lucide !== 'undefined') {
      lucide.createIcons({ root: card });
    }
  });
  
  if (profiles.length < 5) {
    const addCard = document.createElement('div');
    addCard.className = 'profile-card add-profile';
    addCard.innerHTML = `
      <div class="profile-avatar">
        <i data-lucide="plus"></i>
      </div>
      <div class="profile-name">Agregar perfil</div>
    `;
    addCard.addEventListener('click', () => {
      openProfileEditModal(null);
    });
    grid.appendChild(addCard);
    if (typeof lucide !== 'undefined') lucide.createIcons({root: addCard});
  }
}

async function selectProfile(profileName, pin) {
  const session = JSON.parse(localStorage.getItem('kura_user_session'));
  try {
    const res = await fetch('/api/profiles/select', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.token}`
      },
      body: JSON.stringify({ profile_name: profileName, pin })
    });
    const data = await res.json();
    if (res.ok) {
      session.token = data.token;
      localStorage.setItem('kura_user_session', JSON.stringify(session));
      const pinModal = document.getElementById('pin-entry-modal');
      if (pinModal) pinModal.style.display = 'none';
      
      const grid = document.getElementById('profile-grid');
      if (grid) {
        grid.classList.add('animating');
        const selectedCard = Array.from(grid.querySelectorAll('.profile-card')).find(c => {
          const nameEl = c.querySelector('.profile-name');
          return nameEl && nameEl.textContent === profileName;
        });
        if (selectedCard) {
          selectedCard.classList.add('selected');
        }
      }
      const loader = document.getElementById('profile-netflix-loader');
      if (loader) loader.style.display = 'block';
      
      // Wait 1.2s for transition to complete before reloading
      await new Promise(r => setTimeout(r, 1200));
      window.location.reload();
    } else {
      const errEl = document.getElementById('pin-entry-error');
      if (errEl) {
        errEl.textContent = data.message || 'PIN incorrecto';
        errEl.style.display = 'block';
      }
    }
  } catch(err) {
    console.error(err);
  }
}

function openPinModal(profile) {
  const name = profile.profile_name;
  document.getElementById('pin-entry-profile-name').textContent = `Perfil: ${name}`;
  document.getElementById('pin-entry-error').style.display = 'none';
  document.getElementById('pin-entry-modal').style.display = 'flex';
  const digits = document.querySelectorAll('.pin-digit-input');
  digits.forEach(d => d.value = '');
  
  // handle auto focus & submit
  digits.forEach((d, idx) => {
    d.oninput = (e) => {
      d.value = d.value.replace(/\D/g, ''); // only allow digits
      if (d.value && idx < digits.length - 1) digits[idx+1].focus();
      if (idx === digits.length - 1 && d.value) {
        const pin = Array.from(digits).map(el => el.value).join('');
        if (pin.length === 4) selectProfile(name, pin);
      }
    };
    d.onkeydown = (e) => {
      if (e.key === 'Backspace' && !d.value && idx > 0) digits[idx-1].focus();
    };
  });
  
  setTimeout(() => digits[0].focus(), 100);
}

function openProfileEditModal(profile) {
  customAvatarBase64 = null;
  selectedPresetPath = null;
  currentEditingProfileColor = profile ? (profile.avatar_color || null) : null;

  const modal = document.getElementById('profile-edit-modal');
  const title = document.getElementById('profile-edit-title');
  const nameInput = document.getElementById('profile-name-input');
  const kidsInput = document.getElementById('profile-kids-input');
  const pinInput = document.getElementById('profile-pin-input');
  const delBtn = document.getElementById('btn-delete-profile');
  const errEl = document.getElementById('profile-edit-error');
  const avatarPreview = document.getElementById('profile-edit-avatar');
  const fileInput = document.getElementById('profile-avatar-file-input');
  const uploadBtn = document.getElementById('btn-upload-avatar');

  if (fileInput) fileInput.value = '';

  if (uploadBtn && fileInput) {
    uploadBtn.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 200;
          canvas.height = 200;
          const ctx = canvas.getContext('2d');
          const size = Math.min(img.width, img.height);
          const sx = (img.width - size) / 2;
          const sy = (img.height - size) / 2;
          ctx.drawImage(img, sx, sy, size, size, 0, 0, 200, 200);
          customAvatarBase64 = canvas.toDataURL('image/jpeg', 0.8);
          selectedPresetPath = null;
          document.querySelectorAll('.preset-avatar-option').forEach(opt => {
            opt.style.borderColor = 'transparent';
          });
          avatarPreview.style.background = `url('${customAvatarBase64}')`;
          avatarPreview.style.backgroundSize = 'cover';
          avatarPreview.style.backgroundPosition = 'center';
          avatarPreview.textContent = '';
          document.querySelectorAll('.color-swatch').forEach(s => {
            s.classList.remove('active');
            s.style.borderColor = 'transparent';
          });
        };
        img.src = evt.target.result;
      };
      reader.readAsDataURL(file);
    };
  }

  errEl.style.display = 'none';
  
  document.querySelectorAll('.preset-avatar-option').forEach(opt => {
    opt.style.borderColor = 'transparent';
  });

  if (profile) {
    title.textContent = 'Editar Perfil';
    nameInput.value = profile.profile_name;
    nameInput.dataset.originalName = profile.profile_name;
    nameInput.disabled = true; // Name is primary key, cannot edit it
    kidsInput.checked = !!profile.is_kids;
    pinInput.value = profile.pin || '';
    delBtn.style.display = 'block';
    
    const color = profile.avatar_color || '#a855f7';
    document.querySelectorAll('.color-swatch').forEach(s => {
      s.classList.remove('active');
      s.style.borderColor = 'transparent';
      if (colorsMap[s.dataset.color] === color) {
        s.classList.add('active');
        s.style.borderColor = '#fff';
      }
    });

    document.querySelectorAll('.preset-avatar-option').forEach(opt => {
      if (opt.dataset.preset === color) {
        opt.style.borderColor = 'var(--accent-color)';
        selectedPresetPath = color;
      }
    });

    if (color.startsWith('/')) {
      avatarPreview.style.background = `url('${color}')`;
      avatarPreview.style.backgroundSize = 'cover';
      avatarPreview.style.backgroundPosition = 'center';
      avatarPreview.textContent = '';
    } else {
      updateAvatarPreview();
    }
  } else {
    title.textContent = 'Agregar Perfil';
    nameInput.value = '';
    nameInput.disabled = false;
    delete nameInput.dataset.originalName;
    kidsInput.checked = false;
    pinInput.value = '';
    delBtn.style.display = 'none';
    
    document.querySelectorAll('.color-swatch').forEach(s => {
      s.classList.remove('active');
      s.style.borderColor = 'transparent';
    });
    const firstSwatch = document.querySelector('.color-swatch');
    if (firstSwatch) {
      firstSwatch.classList.add('active');
      firstSwatch.style.borderColor = '#fff';
    }
    updateAvatarPreview();
  }
  
  modal.style.display = 'flex';
}

function updateAvatarPreview() {
  const avatar = document.getElementById('profile-edit-avatar');
  const name = document.getElementById('profile-name-input').value;
  const activeSwatch = document.querySelector('.color-swatch.active');
  const color = activeSwatch ? colorsMap[activeSwatch.dataset.color] : '#9d00ff';
  
  if (customAvatarBase64) {
    avatar.style.background = `url('${customAvatarBase64}')`;
    avatar.style.backgroundSize = 'cover';
    avatar.style.backgroundPosition = 'center';
    avatar.textContent = '';
    return;
  }
  
  if (selectedPresetPath) {
    avatar.style.background = `url('${selectedPresetPath}')`;
    avatar.style.backgroundSize = 'cover';
    avatar.style.backgroundPosition = 'center';
    avatar.textContent = '';
    return;
  }

  avatar.textContent = name ? name.charAt(0).toUpperCase() : '?';
  avatar.style.background = color;
}

document.addEventListener('DOMContentLoaded', () => {
  // Setup event listeners for profile switcher elements
  const btnManage = document.getElementById('btn-manage-profiles');
  if (btnManage) {
    btnManage.addEventListener('click', () => {
      isProfileManagementMode = !isProfileManagementMode;
      btnManage.textContent = isProfileManagementMode ? 'Listo' : 'Administrar perfiles';
      btnManage.style.background = isProfileManagementMode ? 'rgba(255,255,255,0.1)' : 'transparent';
      loadProfilesView();
    });
  }
  
  const btnSwitchProfile = document.getElementById('btn-switch-profile');
  if (btnSwitchProfile) {
    btnSwitchProfile.addEventListener('click', () => {
      document.getElementById('user-dropdown-card').style.display = 'none';
      document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));
      document.getElementById('profile-switcher-view').classList.add('active');
      isProfileManagementMode = false;
      if (btnManage) btnManage.textContent = 'Administrar perfiles';
      loadProfilesView();
    });
  }
  
  // Profile edit modal logic
  document.getElementById('profile-name-input')?.addEventListener('input', updateAvatarPreview);
  
  document.querySelectorAll('.color-swatch').forEach(s => {
    s.addEventListener('click', () => {
      customAvatarBase64 = null;
      selectedPresetPath = null;
      document.querySelectorAll('.preset-avatar-option').forEach(opt => {
        opt.style.borderColor = 'transparent';
      });
      document.querySelectorAll('.color-swatch').forEach(el => {
        el.classList.remove('active');
        el.style.borderColor = 'transparent';
      });
      s.classList.add('active');
      s.style.borderColor = '#fff';
      updateAvatarPreview();
    });
  });

  document.querySelectorAll('.preset-avatar-option').forEach(opt => {
    opt.addEventListener('click', () => {
      customAvatarBase64 = null;
      selectedPresetPath = opt.dataset.preset;
      document.querySelectorAll('.color-swatch').forEach(el => {
        el.classList.remove('active');
        el.style.borderColor = 'transparent';
      });
      document.querySelectorAll('.preset-avatar-option').forEach(el => {
        el.style.borderColor = 'transparent';
      });
      opt.style.borderColor = 'var(--accent-color)';
      updateAvatarPreview();
    });
  });
  
  document.getElementById('btn-cancel-profile')?.addEventListener('click', () => {
    document.getElementById('profile-edit-modal').style.display = 'none';
  });
  
  document.getElementById('btn-cancel-pin')?.addEventListener('click', () => {
    document.getElementById('pin-entry-modal').style.display = 'none';
  });
  
  document.getElementById('btn-save-profile')?.addEventListener('click', async () => {
    const session = JSON.parse(localStorage.getItem('kura_user_session'));
    const nameInput = document.getElementById('profile-name-input');
    const name = nameInput.value.trim();
    const isKids = document.getElementById('profile-kids-input').checked;
    const pin = document.getElementById('profile-pin-input').value;
    const activeSwatch = document.querySelector('.color-swatch.active');
    let color = activeSwatch ? colorsMap[activeSwatch.dataset.color] : '#9d00ff';
    if (!activeSwatch && currentEditingProfileColor) {
      color = currentEditingProfileColor;
    }
    if (selectedPresetPath) {
      color = selectedPresetPath;
    }
    const errEl = document.getElementById('profile-edit-error');
    
    if (!name) {
      errEl.textContent = 'El nombre es obligatorio';
      errEl.style.display = 'block';
      return;
    }
    
    const originalName = nameInput.dataset.originalName;
    const method = originalName ? 'PUT' : 'POST';
    const url = originalName ? `/api/profiles/${encodeURIComponent(originalName)}` : '/api/profiles';
    
    const bodyPayload = {
      profile_name: name,
      avatar_color: color,
      is_kids: isKids,
      pin: pin || null,
      avatar_image: customAvatarBase64
    };

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.token}`
        },
        body: JSON.stringify(bodyPayload)
      });
      
      if (res.ok) {
        document.getElementById('profile-edit-modal').style.display = 'none';
        loadProfilesView();
      } else {
        const data = await res.json();
        errEl.textContent = data.message || 'Error al guardar el perfil';
        errEl.style.display = 'block';
      }
    } catch(err) {
      errEl.textContent = 'Error de conexión';
      errEl.style.display = 'block';
    }
  });
  
  document.getElementById('btn-delete-profile')?.addEventListener('click', async () => {
    if (!confirm('¿Seguro que deseas borrar este perfil?')) return;
    
    const session = JSON.parse(localStorage.getItem('kura_user_session'));
    const nameInput = document.getElementById('profile-name-input');
    const originalName = nameInput.dataset.originalName;
    
    try {
      const res = await fetch(`/api/profiles/${encodeURIComponent(originalName)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session.token}` }
      });
      
      if (res.ok) {
        document.getElementById('profile-edit-modal').style.display = 'none';
        loadProfilesView();
      } else {
        const data = await res.json();
        alert(data.message || 'Error al borrar el perfil');
      }
    } catch(err) {}
  });

  // FAQ accordion toggling
  document.querySelectorAll('.faq-question-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const isActive = item.classList.contains('active');
      
      // Close other accordion items
      document.querySelectorAll('.faq-item').forEach(el => {
        el.classList.remove('active');
      });
      
      if (!isActive) {
        item.classList.add('active');
      }
    });
  });

  // Call the check on initial load after a short delay to let views initialize
  setTimeout(checkAndShowProfileSwitcher, 100);
  window.addEventListener('hashchange', checkAndShowProfileSwitcher);
});

// Dynamic mosaic background rendering
async function initDashboardMosaic() {
  const mosaicBg = document.getElementById('dashboard-mosaic-bg');
  if (!mosaicBg) return;
  if (mosaicBg.children.length > 0) return;
  
  let shows = [];
  try {
    const res = await fetch('/api/shows');
    if (res.ok) shows = await res.json();
  } catch (err) {}
  
  const defaultPosters = [
    'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&q=80',
    'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=500&q=80',
    'https://images.unsplash.com/photo-1580477667995-2b94f01c9516?w=500&q=80',
    'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=500&q=80'
  ];
  
  let posterUrls = shows.map(s => s.poster_path).filter(Boolean);
  if (posterUrls.length < 8) posterUrls = [...posterUrls, ...defaultPosters];
  
  const colsData = [[], [], [], []];
  for (let i = 0; i < 24; i++) {
    colsData[i % 4].push(posterUrls[i % posterUrls.length]);
  }
  
  mosaicBg.innerHTML = colsData.map((col, idx) => {
    const colClass = idx % 2 === 0 ? 'col-up' : 'col-down';
    const imgs = [...col, ...col].map(url => `<img src="${url}" alt="Anime Poster">`).join('');
    return `<div class="landing-mosaic-column ${colClass}">${imgs}</div>`;
  }).join('');
}

// Scrape cover button globally
window.scrapeShowCover = async (showId, currentTitle) => {
  const query = prompt("Escribe el nombre del anime para buscar la carátula en internet (MyAnimeList / Kitsu):", currentTitle);
  if (!query) return;
  
  const btn = document.getElementById(`btn-scrape-${showId}`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:4px;"></div> Descargando...`;
  }
  
  try {
    const session = JSON.parse(localStorage.getItem('kura_user_session'));
    const res = await fetch('/api/admin/scrape-show-cover', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.token}`
      },
      body: JSON.stringify({ showId, query })
    });
    
    const data = await res.json();
    if (res.ok && data.success) {
      alert("Carátula y metadatos actualizados con éxito.");
      loadAdminPanel();
    } else {
      alert("Error: " + (data.error || "No se encontró ninguna carátula."));
    }
  } catch (err) {
    console.error(err);
    alert("Error de conexión al buscar carátula.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="search" style="width:14px;height:14px;margin-right:4px;vertical-align:middle;"></i> Buscar Carátula HD`;
      if (typeof lucide !== 'undefined') lucide.createIcons({ root: btn });
    }
  }
};

function setupAutoDownloaderControls() {
  const badge = document.getElementById('autodownload-status-badge');
  const btnToggle = document.getElementById('btn-toggle-autodownload');
  const lastScanEl = document.getElementById('autodownload-last-scan');
  const btnScanNow = document.getElementById('btn-scan-autodownload-now');
  const activeContainer = document.getElementById('autodownload-active-container');
  const activeTitle = document.getElementById('autodownload-current-title');
  const activePercent = document.getElementById('autodownload-current-percent');
  const activeFill = document.getElementById('autodownload-progress-fill');
  const activeStatus = document.getElementById('autodownload-current-status');
  const activeStats = document.getElementById('autodownload-current-stats');
  const historyList = document.getElementById('autodownload-history-list');

  // Dedicated Torrent Download Manager Elements
  const tmBadge = document.getElementById('torrent-manager-status-badge');
  const tmBtnToggle = document.getElementById('btn-toggle-torrent-manager');
  const tmBtnScanNow = document.getElementById('btn-scan-torrent-manager-now');
  const tmActiveTitle = document.getElementById('tm-active-title');
  const tmActiveSubtitle = document.getElementById('tm-active-subtitle');
  const tmActivePercent = document.getElementById('tm-active-percent');
  const tmActiveBar = document.getElementById('tm-active-bar');
  const tmActiveStatus = document.getElementById('tm-active-status');
  const tmActiveMetrics = document.getElementById('tm-active-metrics');
  const tmQueueCount = document.getElementById('tm-queue-count');
  const tmQueueList = document.getElementById('tm-queue-list');
  const tmHistoryList = document.getElementById('tm-history-list');

  const updateUI = (status) => {
    if (!status) return;

    // Badges & Toggle Buttons
    const badgeText = status.isEnabled ? (status.isScanning ? 'Escaneando...' : 'Activo (30m)') : 'Inactivo';
    const badgeBg = status.isEnabled ? 'rgba(0, 224, 143, 0.2)' : 'rgba(255,255,255,0.1)';
    const badgeColor = status.isEnabled ? '#00e08f' : 'var(--text-muted)';
    const toggleHTML = status.isEnabled ?
      '<i data-lucide="power" style="width: 14px; height: 14px;"></i> Desactivar Auto-Scan' :
      '<i data-lucide="power" style="width: 14px; height: 14px;"></i> Activar Auto-Scan';

    if (badge) {
      badge.textContent = badgeText;
      badge.style.background = badgeBg;
      badge.style.color = badgeColor;
    }
    if (tmBadge) {
      tmBadge.textContent = badgeText;
      tmBadge.style.background = badgeBg;
      tmBadge.style.color = badgeColor;
    }

    if (btnToggle) btnToggle.innerHTML = toggleHTML;
    if (tmBtnToggle) tmBtnToggle.innerHTML = toggleHTML;

    if (lastScanEl) {
      lastScanEl.textContent = status.lastScanTime ? new Date(status.lastScanTime).toLocaleTimeString() : 'Nunca';
    }

    // Active Live Download Monitor
    if (status.currentDownload) {
      const cur = status.currentDownload;
      const titleText = `${cur.animeTitle} - Cap. ${cur.episode} (Temp. ${cur.season})`;
      const subtitleText = `Torrents en cola: ${status.downloadQueue ? status.downloadQueue.length : 0} pendientes.`;
      const isIngesting = cur.status === 'ingesting';
      const displayPercent = isIngesting ? 100 : cur.percent;
      const statusStr = isIngesting ? '✅ Descarga 100% completada. Procesando video e integrando al catálogo...' : 'Descargando torrent en servidor...';
      const metricsStr = isIngesting ? 'Completado - Procesando archivo' : `${cur.loadedMB} MB / ${cur.totalMB} MB (${cur.speedMBs} MB/s)`;

      if (activeContainer) activeContainer.style.display = 'block';
      if (activeTitle) activeTitle.innerHTML = `<i data-lucide="download-cloud" style="width: 16px; height: 16px; color: #00e08f;"></i> ${titleText}`;
      if (activePercent) activePercent.textContent = `${displayPercent}%`;
      if (activeFill) {
        activeFill.style.transition = 'width 0.5s ease-in-out';
        activeFill.style.width = `${displayPercent}%`;
      }
      if (activeStatus) activeStatus.textContent = statusStr;
      if (activeStats) activeStats.textContent = metricsStr;

      // Dedicated Manager Active Card
      if (tmActiveTitle) tmActiveTitle.textContent = titleText;
      if (tmActiveSubtitle) tmActiveSubtitle.textContent = subtitleText;
      if (tmActivePercent) tmActivePercent.textContent = `${displayPercent}%`;
      if (tmActiveBar) {
        tmActiveBar.style.transition = 'width 0.5s ease-in-out';
        tmActiveBar.style.width = `${displayPercent}%`;
      }
      if (tmActiveStatus) tmActiveStatus.textContent = `Estado: ${statusStr}`;
      if (tmActiveMetrics) tmActiveMetrics.textContent = metricsStr;
    } else {
      if (activeContainer) activeContainer.style.display = 'none';
      if (tmActiveTitle) tmActiveTitle.textContent = 'Sin descargas activas en este momento';
      if (tmActiveSubtitle) tmActiveSubtitle.textContent = 'El servidor está a la espera de nuevos capítulos o inicio de escaneo.';
      if (tmActivePercent) tmActivePercent.textContent = '0%';
      if (tmActiveBar) tmActiveBar.style.width = '0%';
      if (tmActiveStatus) tmActiveStatus.textContent = 'Estado: En espera';
      if (tmActiveMetrics) tmActiveMetrics.textContent = '0.0 MB / 0.0 MB (0.0 MB/s)';
    }

    // Sequential Queue (1-by-1) rendering
    const queue = status.downloadQueue || [];
    if (tmQueueCount) tmQueueCount.textContent = `${queue.length} en cola`;
    if (tmQueueList) {
      if (queue.length === 0) {
        tmQueueList.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; padding: 10px 0;">No hay capítulos pendientes en la cola de descarga.</p>';
      } else {
        tmQueueList.innerHTML = queue.map((item, idx) => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; gap: 10px;">
            <div style="display: flex; align-items: center; gap: 10px; overflow: hidden; flex: 1;">
              <span class="badge" style="background: rgba(168,85,247,0.15); color: var(--accent-color); font-weight: 800;">#${idx + 1}</span>
              <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <strong style="color: var(--text-main); font-size: 0.88rem;">${item.animeTitle || item.title}</strong>
                <span style="color: var(--text-muted); font-size: 0.78rem;"> (Temp. ${item.season || 1} · Cap. ${item.episode || '?'})</span>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
              <span class="badge" style="font-size: 0.72rem; background: rgba(255,255,255,0.08); color: var(--text-muted);">En espera 1-a-1</span>
              <button type="button" class="btn btn-secondary btn-remove-queue-item" data-index="${idx}" style="padding: 4px 10px; font-size: 0.78rem; color: #ff5555; background: rgba(255, 85, 85, 0.1); border: 1px solid rgba(255, 85, 85, 0.25); cursor: pointer; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;">
                <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i> Quitar
              </button>
            </div>
          </div>
        `).join('');

        tmQueueList.querySelectorAll('.btn-remove-queue-item').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const index = parseInt(btn.getAttribute('data-index'));
            try {
              const res = await fetch('/api/admin/autodownload/queue/remove', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ index })
              });
              const data = await res.json();
              if (data.status) {
                updateUI(data.status);
              }
            } catch (err) {
              console.error("Error removing queue item:", err);
            }
          });
        });
      }
    }

    // History rendering
    const history = status.history || [];
    const historyHTML = history.length === 0 ?
      '<p style="color: var(--text-muted); font-size: 0.85rem; padding: 10px 0;">No hay descargas recientes registradas en el historial.</p>' :
      history.map(item => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px;">
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 75%;">
            <strong style="color: var(--text-main); font-size: 0.88rem;">${item.anime_title || 'Anime'}</strong>
            <span style="color: var(--text-muted); font-size: 0.78rem;"> Cap. ${item.episode || '?'} (Temp. ${item.season || 1})</span>
          </div>
          <span class="badge" style="font-size: 0.72rem; background: rgba(0, 224, 143, 0.15); color: #00e08f;">Importado en Catálogo</span>
        </div>
      `).join('');

    if (historyList) historyList.innerHTML = historyHTML;
    if (tmHistoryList) tmHistoryList.innerHTML = historyHTML;

    if (typeof lucide !== 'undefined') lucide.createIcons();
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/admin/autodownload/status', {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        updateUI(data);
      }
    } catch (e) {
      console.warn('Error fetching autodownload status:', e);
    }
  };

  const handleToggle = async (btnEl) => {
    if (btnEl) btnEl.disabled = true;
    try {
      const res = await fetch('/api/admin/autodownload/toggle', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        updateUI(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      if (btnEl) btnEl.disabled = false;
    }
  };

  const handleScanNow = async (btnEl) => {
    if (btnEl) btnEl.disabled = true;
    const orig = btnEl ? btnEl.innerHTML : '';
    if (btnEl) btnEl.innerHTML = '<i class="spinner-icon"></i> Buscando...';
    try {
      const res = await fetch('/api/admin/autodownload/scan', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      if (res.ok) {
        await fetchStatus();
        alert('¡Búsqueda y escaneo RSS completado!');
      }
    } catch (e) {
      console.error(e);
    } finally {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.innerHTML = orig;
      }
    }
  };

  if (btnToggle) btnToggle.addEventListener('click', () => handleToggle(btnToggle));
  if (tmBtnToggle) tmBtnToggle.addEventListener('click', () => handleToggle(tmBtnToggle));

  if (btnScanNow) btnScanNow.addEventListener('click', () => handleScanNow(btnScanNow));
  if (tmBtnScanNow) tmBtnScanNow.addEventListener('click', () => handleScanNow(tmBtnScanNow));

  const btnCancelActive = document.getElementById('btn-cancel-active-download');
  if (btnCancelActive) {
    btnCancelActive.addEventListener('click', async () => {
      if (!confirm('¿Seguro que deseas detener la descarga activa actual?')) return;
      btnCancelActive.disabled = true;
      try {
        const res = await fetch('/api/admin/autodownload/cancel-active', {
          method: 'POST',
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const data = await res.json();
          if (data.status) updateUI(data.status);
        }
      } catch (e) {
        console.error("Error cancelling download:", e);
      } finally {
        btnCancelActive.disabled = false;
      }
    });
  }

  const btnClearQueue = document.getElementById('btn-clear-download-queue');
  if (btnClearQueue) {
    btnClearQueue.addEventListener('click', async () => {
      if (!confirm('¿Seguro que deseas vaciar toda la cola de descargas?')) return;
      btnClearQueue.disabled = true;
      try {
        const res = await fetch('/api/admin/autodownload/queue/clear', {
          method: 'POST',
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const data = await res.json();
          if (data.status) updateUI(data.status);
        }
      } catch (e) {
        console.error("Error clearing download queue:", e);
      } finally {
        btnClearQueue.disabled = false;
      }
    });
  }

  const btnRefreshStaging = document.getElementById('btn-refresh-staging');
  if (btnRefreshStaging) {
    btnRefreshStaging.addEventListener('click', () => loadStagedImports());
  }

  // Auto load staging on tab switch
  document.querySelectorAll('.admin-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (item.dataset.target === 'admin-sub-staging') {
        loadStagedImports();
      }
    });
  });

  fetchStatus();
  setInterval(fetchStatus, 2000);
}

async function loadStagedImports() {
  const container = document.getElementById('staging-items-list');
  if (!container) return;

  try {
    const res = await fetch('/api/admin/staged', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Error al cargar elementos en preparación.');

    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) {
      container.innerHTML = `<div class="admin-card" style="text-align: center; padding: 40px 20px;">
        <i data-lucide="check-circle-2" style="width: 48px; height: 48px; color: #00e08f; margin-bottom: 12px; display: inline-block;"></i>
        <h4 style="margin: 0 0 6px 0;">¡Todo al día!</h4>
        <p style="color: var(--text-muted); margin: 0; font-size: 0.88rem;">No hay descargas o archivos pendientes de revisión en la bandeja de entrada.</p>
      </div>`;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="admin-card" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 16px; border-radius: 8px;">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 280px;">
            <span class="badge" style="background: rgba(168,85,247,0.15); color: #c084fc; font-size: 0.75rem; margin-bottom: 6px; display: inline-block;">${item.source_info || 'Descarga Torrents'}</span>
            <h4 style="margin: 4px 0 8px 0; font-size: 1rem; color: var(--text-main); word-break: break-all;">${item.raw_title}</h4>
            <small style="color: var(--text-muted); font-size: 0.78rem; display: block;">Ruta física: ${item.file_path}</small>
            
            <div style="display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap;">
              <div style="flex: 2; min-width: 200px;">
                <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 4px;">Nombre Limpio para Catálogo:</label>
                <input type="text" id="stage-title-${item.id}" value="${item.clean_title || ''}" class="form-control" style="font-size: 0.85rem; padding: 6px 10px;">
              </div>
              <div style="flex: 1; min-width: 80px;">
                <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 4px;">Temp:</label>
                <input type="number" id="stage-season-${item.id}" value="${item.season || 1}" class="form-control" style="font-size: 0.85rem; padding: 6px 10px;">
              </div>
              <div style="flex: 1; min-width: 80px;">
                <label style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 4px;">Cap:</label>
                <input type="number" id="stage-episode-${item.id}" value="${item.episode || 1}" class="form-control" style="font-size: 0.85rem; padding: 6px 10px;">
              </div>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px; align-self: center;">
            <button type="button" class="btn btn-primary btn-publish-staged" data-id="${item.id}" style="padding: 8px 16px; font-size: 0.82rem; gap: 6px; display: inline-flex; align-items: center;">
              <i data-lucide="check" style="width: 14px; height: 14px;"></i> Publicar al Catálogo
            </button>
            <button type="button" class="btn btn-secondary btn-delete-staged" data-id="${item.id}" style="padding: 6px 12px; font-size: 0.8rem; color: #ff5555; background: rgba(255,85,85,0.1); border: 1px solid rgba(255,85,85,0.2); gap: 6px; display: inline-flex; align-items: center;">
              <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i> Eliminar
            </button>
          </div>
        </div>
      </div>
    `).join('');

    if (window.lucide) window.lucide.createIcons();

    document.querySelectorAll('.btn-publish-staged').forEach(btn => {
      btn.addEventListener('click', () => publishStagedItem(btn.dataset.id));
    });
    document.querySelectorAll('.btn-delete-staged').forEach(btn => {
      btn.addEventListener('click', () => deleteStagedItem(btn.dataset.id));
    });

  } catch (e) {
    console.error(e);
    container.innerHTML = `<p style="color: #ff5555;">Error al cargar elementos: ${e.message}</p>`;
  }
}

async function publishStagedItem(id) {
  const cleanTitleEl = document.getElementById(`stage-title-${id}`);
  const seasonEl = document.getElementById(`stage-season-${id}`);
  const epEl = document.getElementById(`stage-episode-${id}`);

  const payload = {
    clean_title: cleanTitleEl ? cleanTitleEl.value.trim() : '',
    season: seasonEl ? parseInt(seasonEl.value, 10) : 1,
    episode: epEl ? parseInt(epEl.value, 10) : 1,
    media_type: 'anime'
  };

  try {
    const res = await fetch(`/api/admin/staged/${id}/publish`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      alert('¡Publicado con éxito al catálogo público!');
      loadStagedImports();
    } else {
      const err = await res.json();
      alert(`Error al publicar: ${err.error || 'Desconocido'}`);
    }
  } catch (e) {
    alert(`Error de red: ${e.message}`);
  }
}

async function deleteStagedItem(id) {
  if (!confirm('¿Seguro que deseas eliminar este archivo de la bandeja de preparación?')) return;
  try {
    const res = await fetch(`/api/admin/staged/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (res.ok) {
      loadStagedImports();
    }
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}
