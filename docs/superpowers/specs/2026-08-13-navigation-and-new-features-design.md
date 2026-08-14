# Design Specification: Navegación Reorganizada & Nuevas Secciones en KuraStream

**Fecha:** 13 de Agosto de 2026  
**Estado:** Especificación de Diseño Aprobada por el Usuario  
**Componentes Impactados:**
- Header Navbar & Estilos (`frontend/index.html`, `frontend/style.css`, `frontend/js/modules/navigation.js`)
- Vistas SPA y Enrutador (`frontend/app.js`)
- Backend PHP 8 & MySQL (`php_backend/controllers/ShowController.php`, `php_backend/controllers/HistoryController.php`, `php_backend/db.php`)

---

## 1. Visión General y Objetivos

Reorganizar la estructura de navegación global de KuraStream y agregar 6 nuevas características y secciones dedicadas para elevar la plataforma a una experiencia de streaming moderna estilo Crunchyroll / Netflix.

### Objetivos Clave:
1. **Navegación Compacta con Iconos + Texto (Enfoque A):**
   - Navbar horizontal limpia con iconos de Lucide + texto.
   - Menú desplegable **"Explorar"** que agrupa Películas, Géneros y el Descubrimiento Aleatorio.
   - Accesos directos dedicados a **Mi Lista** e **Historial**.
   - Widget de **Notificaciones** con badge de episodios nuevos.
   - Opción **"Mis Estadísticas"** dentro del menú de perfil de usuario.

2. **6 Nuevas Vistas y Funcionalidades:**
   - `#/my-list` — Página dedicada para favoritos con ordenamiento y poster grid.
   - `#/history` — Página dedicada para el historial de reproducción completo con barra de progreso y opción para borrar/limpiar.
   - `#/genres` — Página de exploración visual por categorías de géneros (Acción, Isekai, Romance, etc.).
   - `#/stats` — Dashboard de estadísticas personalizadas por perfil (tiempo visto, animes completados, géneros favoritos).
   - **Modal Aleatorio 🎲** — Selector instantáneo de anime al azar ("¿No sabes qué ver?").
   - **Campana de Notificaciones 🔔** — Alertas en tiempo real de nuevos episodios de tus series favoritas.

---

## 2. Arquitectura de Navegación y UI

### 2.1 Estructura del Header Navbar (`frontend/index.html`)

```html
<header class="app-header">
  <a href="#/" class="header-logo" id="header-logo">
    <img id="custom-logo" src="/library/logo.png" alt="KuraStream Logo">
    <div id="fallback-logo">
      <span class="logo-icon">蔵</span>
      <span class="logo-text">Kura<span class="accent-text">Stream</span></span>
    </div>
  </a>

  <nav class="header-nav">
    <a href="#/" class="nav-link" id="nav-home"><i data-lucide="home"></i> Inicio</a>
    <a href="#/airing" class="nav-link" id="nav-airing"><i data-lucide="flame"></i> En Emisión <span class="airing-pulse-dot"></span></a>
    <a href="#/calendar" class="nav-link" id="nav-calendar"><i data-lucide="calendar"></i> Calendario</a>

    <!-- Dropdown Explorar -->
    <div class="nav-dropdown" id="nav-explore-dropdown">
      <button class="nav-link nav-dropdown-trigger"><i data-lucide="compass"></i> Explorar <i data-lucide="chevron-down"></i></button>
      <div class="nav-dropdown-menu">
        <a href="#/movies" class="dropdown-item"><i data-lucide="film"></i> Películas</a>
        <a href="#/genres" class="dropdown-item"><i data-lucide="layout-grid"></i> Géneros</a>
        <a href="javascript:void(0)" id="btn-random-anime" class="dropdown-item"><i data-lucide="sparkles"></i> Descubrimiento Aleatorio</a>
      </div>
    </div>

    <a href="#/my-list" class="nav-link" id="nav-mylist"><i data-lucide="heart"></i> Mi Lista</a>
    <a href="#/history" class="nav-link" id="nav-history"><i data-lucide="history"></i> Historial</a>
  </nav>

  <div class="header-right">
    <div class="header-search">
      <input type="text" id="search-input" placeholder="Buscar series, películas...">
      <i data-lucide="search" class="search-icon"></i>
    </div>

    <!-- Notifications Bell Dropdown -->
    <div class="notifications-container" id="notifications-container">
      <button class="nav-icon-btn" id="btn-notifications-trigger" title="Notificaciones">
        <i data-lucide="bell"></i>
        <span class="notification-badge" id="notification-badge" style="display: none;">0</span>
      </button>
      <div class="notifications-dropdown" id="notifications-dropdown" style="display: none;">
        <div class="notifications-header">
          <span>Notificaciones</span>
          <button id="btn-mark-notifications-read" class="btn-text-sm">Marcar leídas</button>
        </div>
        <div class="notifications-list" id="notifications-list"></div>
      </div>
    </div>

    <!-- User Profile Dropdown -->
    <div class="user-account-container" id="user-account-container">
      <!-- User profile menu with Stats link included -->
    </div>
  </div>
</header>
```

---

## 3. Especificación de Nuevas Vistas y Endpoints API

### 3.1 `#/my-list` — Vista Mi Lista (`#mylist-view`)
- Muestra los animes y películas marcadas como favoritas del perfil actual.
- Filtros rápidos por tipo (Todos, Anime, Películas) y ordenación por Título, Año o Calificación.
- Endpoint: Consume `GET /api/favorites`.

### 3.2 `#/history` — Vista Historial (`#history-view`)
- Lista horizontal/grid con tarjetas detalladas del progreso de cada episodio visto.
- Muestra: poster, episodio, segundo de pausa/duración en porcentaje, fecha.
- Acciones: Continuar reproducción, eliminar de historial (`DELETE /api/history?episode_id=X`), o borrar historial completo (`DELETE /api/history?clear=all`).

### 3.3 `#/genres` — Vista Géneros (`#genres-view`)
- Grid de tarjetas temáticas de géneros con degradados y miniaturas (Acción, Romance, Isekai, Shonen, Fantasía, Ciencia Ficción, Comedia, etc.).
- Al hacer clic en un género, filtra y presenta las series pertenecientes a esa categoría.
- Endpoint: Consume `GET /api/shows` filtrado por género.

### 3.4 `#/stats` — Vista Estadísticas de Perfil (`#stats-view`)
- Resumen métrico visual por usuario/perfil:
  - Tiempo total de reproducción (convertido a días, horas y minutos).
  - Cantidad de episodios y animes completados.
  - Distribución gráfica por géneros favoritos.
- Endpoint: `GET /api/user/stats`.

### 3.5 Modal Aleatorio — Descubrimiento 🎲 (`#random-modal`)
- Ventana modal que selecciona al azar una serie/película de la biblioteca MySQL.
- Presenta animación de ruleta con la carátula, título, sinopsis y botones `[▶️ Ver Ahora]` y `[🎲 Otro Anime]`.
- Endpoint: `GET /api/shows/random`.

### 3.6 Notificaciones 🔔 (`#notifications-dropdown`)
- Muestra alertas cuando se añaden episodios de series presentes en los favoritos del usuario.
- Endpoint: `GET /api/notifications`.

---

## 4. Cambios en Backend PHP 8 (`php_backend/`)

1. **`php_backend/db.php` & `DbHelper`**:
   - `getRandomShow()`: Retorna un registro al azar de `shows` (`ORDER BY RAND() LIMIT 1`).
   - `getUserStats($username, $profile)`: Calcula suma de `progress_seconds` de `watch_history`, conteo de episodios únicos vistos, y conteo por género.
   - `deleteHistoryItem($username, $profile, $episodeId)` / `clearUserHistory($username, $profile)`.
   - `getNotifications($username, $profile)`: Encuentra episodios recientes de series en `favorites`.

2. **Controladores**:
   - `ShowController.php`: Endpoint `GET /api/shows/random`.
   - `HistoryController.php`: Endpoints `GET /api/user/stats`, `DELETE /api/history`, `GET /api/notifications`.

---

## 5. Plan de Verificación

1. **Backend PHP Tests**:
   - `tests/test_new_features_db.php`: Verificación de `getRandomShow`, `getUserStats`, `deleteHistoryItem` y `getNotifications`.
2. **Frontend UI Tests**:
   - `tests/navigation_new_views.test.js`: Verificación de enrutamiento hash (`#/my-list`, `#/history`, `#/genres`, `#/stats`), modal aleatorio y elementos del navbar.
