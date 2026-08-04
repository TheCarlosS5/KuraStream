# Especificación de Diseño: Integración de Mosaico en Dashboard y Reorganización del Proyecto

**Fecha:** 2026-08-04  
**Estado:** Aprobado por el usuario  

---

## 1. Visión General y Objetivos
- **Eliminación de la Landing Page de Introducción:** Se elimina por completo la vista `#landing-view` con textos de marketing ("Entretenimiento sin límites"), tarjetas de características y acordeón FAQ.
- **Flujo Directo de Autenticación y Perfiles:** 
  - Si el usuario **no ha iniciado sesión**, se muestra directamente la pantalla/modal de inicio de sesión.
  - Si el usuario **inició sesión pero no ha elegido perfil**, se muestra la pantalla de selección de perfiles (`#profile-switcher-view`).
  - Si el usuario **inició sesión y eligió un perfil**, se ingresa directamente al catálogo principal (`#dashboard-view`).
- **Mosaico Dinámico de Anime en el Dashboard:** El mosaico animado en cuadrícula infinita de portadas de anime (con desplazamiento bidireccional, overlay radial oscuro y brillo neón Electric Violet) se traslada como fondo activo del `#dashboard-view` (donde se eligen las series, animes y películas).
- **Organización del Proyecto:** Reorganizar los scripts auxiliares y archivos temporales dispersos en la raíz (`deploy.py`, `watch_sync.js`, `setup_ssh_key.py`, `clean_demos.js`, `auto_import_oshi_no_ko.js`, `dump_db.js`, `generate_existing_thumbs.js`, `restore_local_episodes.js`, `test.webm`, `browser_errors.log`) dentro de una estructura limpia de carpetas `scripts/` y `backend/scripts/`.

---

## 2. Cambios en la Interfaz de Usuario (Frontend)

### `frontend/index.html`
1. Remover el contenedor `#landing-view` (incluyendo hero, intro text, features grid y FAQ).
2. Insertar el contenedor `<div class="dashboard-mosaic-bg" id="dashboard-mosaic-bg"></div>` y `<div class="dashboard-gradient-overlay"></div>` al inicio del contenedor `#dashboard-view`.

### `frontend/style.css`
1. Ajustar los estilos de `.dashboard-mosaic-bg` posicionándolos en el fondo de `#dashboard-view`.
2. Mantener la paleta **Electric Violet (`#a855f7`)** y los efectos neón.

### `frontend/app.js`
1. Eliminar la lógica de inicialización de la landing page anterior (`initLandingView()`).
2. Implementar `initDashboardMosaic()` que carga las portadas de los animes disponibles desde `/api/shows` y las renderiza en columnas animadas de mosaico detrás del catálogo del Dashboard.
3. Actualizar `setupRouter()` para que dirija inmediatamente al usuario a la vista correspondiente sin pasar por pantallas de introducción.

---

## 3. Reorganización de Archivos y Carpetas del Proyecto

Directorio destino para scripts backend/despliegue: `backend/scripts/`
- Mover `deploy.py` -> `backend/scripts/deploy.py`
- Mover `watch_sync.js` -> `backend/scripts/watch_sync.js`
- Mover `setup_ssh_key.py` -> `backend/scripts/setup_ssh_key.py`
- Mover `clean_demos.js` -> `backend/scripts/clean_demos.js`
- Mover `auto_import_oshi_no_ko.js` -> `backend/scripts/auto_import_oshi_no_ko.js`
- Mover `dump_db.js` -> `backend/scripts/dump_db.js`
- Mover `generate_existing_thumbs.js` -> `backend/scripts/generate_existing_thumbs.js`
- Mover `restore_local_episodes.js` -> `backend/scripts/restore_local_episodes.js`
- Eliminar o mover archivos de registros temporales en raíz (`test.webm`, `browser_errors.log`).

Actualizar las rutas relativas en `deploy.py` y `watch_sync.js` para que apunten correctamente a la raíz del proyecto.

---

## 4. Pruebas de Integración y Verificación
1. Actualizar `tests/landing.test.js` (renombrando a `tests/router.test.js` o ajustando las aserciones) para verificar que el router dirija directamente al login/selector de perfiles sin cargar landing de introducción.
2. Ejecutar la suite completa de pruebas:
   `node --test --test-concurrency=1 tests/*.test.js`
