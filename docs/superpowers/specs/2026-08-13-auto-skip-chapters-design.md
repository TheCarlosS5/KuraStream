# Design Specification: Auto-Skip Intro/Outro & Marcadores de Capítulos

**Date:** 2026-08-13  
**Status:** In Review / Awaiting User Feedback  
**Target Component:** Player UI (`frontend/player.js`), Ajustes del usuario (`frontend/app.js`), Backend PHP 8 (`php_backend/`) y MySQL (`php_backend/db.php`).

---

## 1. Visión General y Objetivos

Añadir un sistema integrado de **Marcadores de Capítulos** y **Auto-Skip de Intro/Outro** al reproductor multimedia de KuraStream.

### Objetivos Clave:
1. **Auto-Skip de Intro/Outro Opt-in (Ajustes):**
   - El salto automático de Intro/Outro sólo ocurrirá si el usuario lo habilita explícitamente en el panel de **Ajustes -> Preferencias**.
   - Por defecto vendrá **Desactivado** (OFF).
   - Cuando el vídeo alcance `intro_start`, si la preferencia está activa, el reproductor saltará automáticamente a `intro_end`.
   - Si la preferencia está desactivada, aparecerá el botón superpuesto (Overlay) **"Saltar Intro"** para salto manual a un solo clic.

2. **Marcadores de Capítulos (Activados por Defecto):**
   - Todos los usuarios verán los marcadores de capítulos en la barra de progreso del reproductor.
   - Botón de **Capítulos** en la barra de controles del reproductor para abrir un menú desplegable con la lista de secciones ("Intro", "Parte A", "Parte B", "Outro", etc.) y saltar directamente a cualquiera de ellas.

3. **Compatibilidad Backend PHP 8 + MySQL:**
   - La base de datos MySQL registrará `intro_start`, `intro_end`, `outro_start` y `chapters` (JSON) en la tabla `episodes`.
   - Nueva tabla `user_preferences` en MySQL para guardar las opciones por usuario/perfil.
   - Endpoints REST en `php_backend/controllers/PlayerController.php` y `php_backend/controllers/HistoryController.php`.

---

## 2. Arquitectura de Datos y MySQL

### 2.1 Esquema de Base de Datos (`php_backend/db.php`)

```sql
-- Columna de capítulos en la tabla episodes (si no existe)
ALTER TABLE episodes ADD COLUMN chapters LONGTEXT DEFAULT NULL;

-- Tabla de preferencias de usuario por perfil
CREATE TABLE IF NOT EXISTS user_preferences (
    username VARCHAR(255) NOT NULL,
    profile_name VARCHAR(255) NOT NULL DEFAULT 'Principal',
    auto_skip_intro TINYINT(1) DEFAULT 0,
    auto_play_next TINYINT(1) DEFAULT 1,
    default_subtitles_enabled TINYINT(1) DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (username, profile_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 3. Endpoints de la API Backend (PHP 8)

1. `GET /api/episodes/{id}`
   - Retorna la metadata del episodio incluyendo `intro_start`, `intro_end`, `outro_start` y `chapters` (como array JSON parseado).

2. `GET /api/user/preferences`
   - Retorna las preferencias del perfil actual (`auto_skip_intro`, `auto_play_next`, etc.).

3. `POST /api/user/preferences`
   - Guarda/actualiza las preferencias en la tabla `user_preferences`.

4. `POST /api/episodes/{id}/timestamps`
   - Permite a los administradores o escáneres actualizar los tiempos de intro/outro y capítulos de un episodio.

---

## 4. Diseño del Frontend e Interfaz de Usuario

### 4.1 Panel de Preferencias (`frontend/app.js` / Modal de Ajustes)
- Toggle en la pestaña Preferencias: **"Saltar Intro/Outro Automáticamente"** (Switch ON/OFF).
- Al cambiar el switch, se guarda localmente en `localStorage` (para respuesta instantánea) y se sincroniza mediante `POST /api/user/preferences`.

### 4.2 Reproductor de Vídeo (`frontend/player.js` y `frontend/style.css`)
- **Overlay de Salto Manual:**
  - Si la posición actual `$time >= intro_start && $time < intro_end`, muestra el botón flotante en la esquina inferior derecha: **`[ ⏩ Saltar Intro ]`**.
  - Al pulsar, realiza `video.currentTime = intro_end`.
- **Lógica Auto-Skip:**
  - Si `auto_skip_intro` es `true` y el tiempo alcanza `intro_start`, el reproductor avanza inmediatamente a `intro_end` e informa brevemente con un Toast notification: *"Intro saltada automáticamente"*.
- **Indicadores en la Barra de Progreso:**
  - Muestra marcas visuales (marcadores verticales / líneas de color acentuado) en la barra de búsqueda para delimitar la intro/outro y capítulos.
- **Menú Selector de Capítulos:**
  - Icono de lista/marcador en la barra inferior del reproductor.
  - Al hacer clic, despliega un panel lateral/popup limpio con la lista de capítulos y sus tiempos exactos (ej. `00:00 - Intro`, `01:30 - Episodio`, `21:00 - Outro`).

---

## 5. Plan de Verificación

1. **Pruebas de Base de Datos y PHP:**
   - Ejecutar script PHP de prueba para verificar creación de la tabla `user_preferences` y columna `chapters` en MySQL.
   - Probar endpoints GET/POST de preferencias y timestamps con cURL / scripts PHP.
2. **Pruebas de Frontend (UI / Player):**
   - Probar la activación/desactivación del toggle en Preferencias.
   - Probar el reproductor con episodios con marcas de tiempo (simuladas o guardadas) verificando tanto el botón "Saltar Intro" manual como el Auto-Skip cuando está activado.
   - Verificar la renderización del menú de capítulos y las marcas en la barra de progreso.
