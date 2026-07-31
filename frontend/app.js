import { initPlayer, destroyPlayer } from './player.js?v=1.5';

const originalFetch = window.fetch;
window.fetch = function(input, options = {}) {
  let url = input;
  if (input instanceof Request) {
    url = input.url;
  } else if (input instanceof URL) {
    url = input.toString();
  }
  
  const method = (input instanceof Request ? input.method : options.method) || 'GET';
  const isTarget = typeof url === 'string' && (
    url.includes('/api/admin/') || 
    url.includes('/api/import') || 
    (url.includes('/api/shows/') && method.toUpperCase() === 'DELETE')
  );
  
  if (isTarget) {
    const token = localStorage.getItem('adminToken') || localStorage.getItem('kura_admin_token');
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
    const hash = window.location.hash || '#/';
    
    // Stop player when leaving player view
    if (currentView === 'player') {
      destroyPlayer();
      document.querySelector('.app-header').style.display = 'flex';
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

    // Parse route
    const searchInputEl = document.getElementById('search-input');
    const genreFilterEl = document.getElementById('genre-filter');

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
  sectionsContainer.innerHTML = '<div class="spinner"></div>';

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
            ${categoryFavorites.map(s => createShowCardHTML(s)).join('')}
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
              ${recentAnime.map(s => createShowCardHTML(s)).join('')}
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
              ${popularAnime.map(s => createShowCardHTML(s)).join('')}
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
              ${paginatedAnime.map(s => createShowCardHTML(s)).join('')}
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
              ${movieShows.map(s => createShowCardHTML(s)).join('')}
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
              ${paginatedMovies.map(s => createShowCardHTML(s)).join('')}
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

function createShowCardHTML(show) {
  const poster = show.poster_path || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&q=80';
  const rating = show.rating ? show.rating.toFixed(1) : 'N/A';
  return `
    <div class="show-card" onclick="location.hash='#/show/${show.id}'" style="flex: 0 0 auto; width: 180px; height: 320px;">
      <div class="card-img-wrapper" style="height: 220px;">
        <img src="${poster}" alt="${show.title}" loading="lazy">
        <div class="card-rating-badge">
          <i data-lucide="star" style="width:12px;height:12px;fill:var(--rating-color);stroke:var(--rating-color);margin-right:2px;display:inline-block;vertical-align:middle;"></i> 
          ${rating}
        </div>
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
      const safeBackdrop = show.backdrop_path.replace(/'/g, "%27");
      const ambientBg = document.querySelector('.detail-ambient-bg');
      if (ambientBg) {
        ambientBg.style.backgroundImage = `url('${safeBackdrop}?t=${Date.now()}')`;
        ambientBg.style.backgroundSize = 'cover';
        ambientBg.style.backgroundPosition = 'center';
      }
    }

    const bgYoutubeContainer = document.getElementById('detail-bg-youtube-container');
    const bgYoutubeIframe = document.getElementById('detail-bg-youtube-iframe');

    if (!hasLocalLoops && show.trailer_key) {
      // Show YouTube container and hide/pause local video
      if (bgYoutubeContainer) bgYoutubeContainer.style.display = 'block';
      if (bgVideo) {
        bgVideo.style.display = 'none';
        bgVideo.pause();
        bgVideo.removeAttribute('src');
        bgVideo.load();
        bgVideo.onplaying = null;
        bgVideo.onended = null;
      }

      if (bgYoutubeIframe) {
        bgYoutubeIframe.src = `https://www.youtube.com/embed/${show.trailer_key}?autoplay=1&mute=1&controls=0&loop=1&playlist=${show.trailer_key}&playsinline=1&showinfo=0&rel=0&iv_load_policy=3&enablejsapi=1`;
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
      episodes.forEach(ep => {
        if (!seasons[ep.season_number]) seasons[ep.season_number] = [];
        seasons[ep.season_number].push(ep);
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
          renderEpisodeList(seasons[sNum], episodesList);
        });
      });
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
    
    // Load Comments and Popular Sidebar
    loadShowComments(id);
    loadPopularSidebar(id);
  } catch (e) {
    console.error('Error loading show details:', e);
    detailTitle.textContent = 'Error';
    episodesList.innerHTML = '<div class="error-text">No se pudo cargar el anime/película.</div>';
  }
}

function renderEpisodeList(epList, targetContainer) {
  if (!epList || epList.length === 0) {
    targetContainer.innerHTML = '<div class="empty-state">No hay capítulos importados en esta temporada.</div>';
    return;
  }
  
  targetContainer.innerHTML = epList.map(ep => {
    const durationMin = Math.round(ep.duration / 60);
    const thumb = ep.thumbnail_path || 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=300&q=80';
    
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
          const sizeGb = (stats.totalSize / (1024 * 1024 * 1024)).toFixed(2);
          statSize.textContent = `${sizeGb} GB`;
        }
        
        if (statDuration) {
          const durationHours = (stats.totalDuration / 3600).toFixed(1);
          statDuration.textContent = `${durationHours} h`;
        }
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
function setupForms() {
  const form = document.getElementById('import-form');
  const typeSelect = document.getElementById('import-type');
  const tvFieldsGroup = document.getElementById('tv-fields-group');
  const statusBox = document.getElementById('import-status');
  const statusText = document.getElementById('import-status-text');

  const fileInput = document.getElementById('import-file');
  const btnSelectFile = document.getElementById('btn-select-file');
  const fileLabel = document.getElementById('selected-file-label');

  if (btnSelectFile && fileInput) {
    btnSelectFile.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        fileLabel.textContent = fileInput.files[0].name;
      } else {
        fileLabel.textContent = 'Ningún archivo seleccionado';
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
    const hasFile = fileInput && fileInput.files.length > 0;
    const sourcePath = document.getElementById('import-filepath').value.trim();
    
    if (!hasFile && !sourcePath) {
      alert("Por favor, selecciona un archivo o ingresa una ruta local en el servidor.");
      return;
    }

    const title = document.getElementById('import-title').value.trim();
    const mediaType = typeSelect.value;
    const seasonNumber = mediaType === 'movie' ? null : parseInt(document.getElementById('import-season').value, 10);
    const episodeNumber = mediaType === 'movie' ? null : parseInt(document.getElementById('import-episode').value, 10);
    const episodeTitle = mediaType === 'movie' ? null : document.getElementById('import-ep-title').value.trim();
    const tmdbId = document.getElementById('import-tmdb').value.trim();
    const startSec = document.getElementById('import-intro-start').value;
    const startSeconds = startSec !== '' ? parseInt(startSec, 10) : null;

    statusText.textContent = 'Procesando vídeo, extrayendo metadatos con ffprobe y ffmpeg...';
    statusBox.style.display = 'flex';
    document.getElementById('import-submit-btn').disabled = true;

    try {
      const formData = new FormData();
      if (hasFile) {
        formData.append('videoFile', fileInput.files[0]);
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

      const res = await fetch('/api/import', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || 'Error importando el archivo.');
      }

      const data = await res.json();
      alert('¡Archivo importado y organizado con éxito!');
      
      form.reset();
      if (fileLabel) fileLabel.textContent = 'Ningún archivo seleccionado';
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

      // Manage polling based on active sub-view
      stopAdminPolling();
      if (targetId === 'admin-sub-overview') {
        startAdminStatsPolling();
      } else if (targetId === 'admin-sub-console') {
        startAdminLogsPolling();
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
  // Reset tab selection to default
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
          const thumbImg = ep.thumbnail_path || 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=150&q=80';
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
              updateUserInterface(logData);
            }
          } else {
            // Standard login success
            localStorage.setItem('kura_user_session', JSON.stringify(data));
            updateUserInterface(data);
          }
          loginModal.style.display = 'none';
          
          // Refresh views to apply identity (update comments user info)
          if (currentView === 'show' && window.location.hash.startsWith('#/show/')) {
            const showId = window.location.hash.split('/').pop();
            loadShowComments(showId);
          }
        } else {
          errorMsg.textContent = data.message || 'Error al procesar la solicitud';
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
      updateUserInterface(null);
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

function updateUserInterface(session) {
  const loginTrigger = document.getElementById('btn-login-trigger');
  const userProfileMenu = document.getElementById('user-profile-menu');
  const userProfileName = document.getElementById('user-profile-name');
  const userAvatarInitial = document.getElementById('user-avatar-initial');
  const adminDirectBtn = document.getElementById('btn-admin-direct');

  if (session && session.success) {
    if (loginTrigger) loginTrigger.style.display = 'none';
    if (userProfileMenu) userProfileMenu.style.display = 'block';
    if (userProfileName) userProfileName.textContent = session.username;
    if (userAvatarInitial) userAvatarInitial.textContent = session.username[0].toUpperCase();
    
    // Set token for admin panel auth checks
    if (session.role === 'admin') {
      localStorage.setItem('kura_admin_token', session.token);
      if (adminDirectBtn) adminDirectBtn.style.display = 'flex';
    } else {
      localStorage.removeItem('kura_admin_token');
      if (adminDirectBtn) adminDirectBtn.style.display = 'none';
    }
  } else {
    if (loginTrigger) loginTrigger.style.display = 'flex';
    if (userProfileMenu) userProfileMenu.style.display = 'none';
    if (adminDirectBtn) adminDirectBtn.style.display = 'none';
    localStorage.removeItem('kura_admin_token');
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

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
    commentAvatar.textContent = username[0].toUpperCase();
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

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    dot.style.left = mouseX + 'px';
    dot.style.top = mouseY + 'px';
  });

  function animateRing() {
    ringX += (mouseX - ringX) * 0.15;
    ringY += (mouseY - ringY) * 0.15;
    ring.style.left = ringX + 'px';
    ring.style.top = ringY + 'px';
    requestAnimationFrame(animateRing);
  }
  animateRing();

  document.addEventListener('mouseover', (e) => {
    const target = e.target;
    if (!target) return;
    const isInteractive = target.closest('a, button, input, select, textarea, [role="button"], .show-card, .clickable, .episode-item, .player-btn, .nav-link, .dropdown-trigger, .carousel-nav-btn, .carousel-indicators span, .drop-zone, .user-profile-trigger, .user-dropdown-item, .back-link, .header-logo, #btn-login-trigger, #btn-logout, #detail-favorite-btn, #detail-trailer-btn, .play-btn, .next-btn, .back-btn, #trailer-close-btn');
    if (isInteractive) {
      dot.classList.add('hover');
      ring.classList.add('hover');
    }
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target;
    if (!target) return;
    const isInteractive = target.closest('a, button, input, select, textarea, [role="button"], .show-card, .clickable, .episode-item, .player-btn, .nav-link, .dropdown-trigger, .carousel-nav-btn, .carousel-indicators span, .drop-zone, .user-profile-trigger, .user-dropdown-item, .back-link, .header-logo, #btn-login-trigger, #btn-logout, #detail-favorite-btn, #detail-trailer-btn, .play-btn, .next-btn, .back-btn, #trailer-close-btn');
    if (isInteractive) {
      dot.classList.remove('hover');
      ring.classList.remove('hover');
    }
  });
}


