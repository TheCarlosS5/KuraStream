# Especificación de Diseño: Área de Preparación Admin (Staging), Póster Genérico y Corrección de Carga Masiva

**Fecha:** 7 de Agosto de 2026  
**Estado:** Aprobado por el usuario (Opción A)  

---

## 1. Visión General del Proyecto

Esta actualización introduce un sistema de **Área de Preparación / Staging Admin** para controlar los animes descargados automáticamente y los archivos importados manualmente antes de que aparezcan en el catálogo público de los usuarios.

Además, soluciona los errores de JavaScript y servidor durante la carga masiva de episodios (12+ capítulos) y genera **pósters genéricos elegantes con branding de KuraStream** cuando no hay conexión a internet o no se encuentran metadatos en TMDB.

---

## 2. Componentes del Sistema

### 2.1 Base de Datos (`backend/db.js`)
Se añade la tabla `staged_imports`:
```sql
CREATE TABLE IF NOT EXISTS staged_imports (
  id TEXT PRIMARY KEY,
  raw_title TEXT NOT NULL,
  clean_title TEXT,
  media_type TEXT NOT NULL DEFAULT 'anime',
  season INTEGER DEFAULT 1,
  episode INTEGER DEFAULT 1,
  file_path TEXT NOT NULL,
  tmdb_id TEXT,
  source_info TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'pending'
);
```
* **Helpers en `dbHelper`**:
  * `saveStagedImport(item)`
  * `getStagedImports()`
  * `getStagedImport(id)`
  * `deleteStagedImport(id)`
  * `updateStagedImport(id, updates)`

---

### 2.2 Motor de Descargas e Ingestión (`backend/scripts/anime_autodownloader.js`)
* **Redirección a Staging**: Los torrents descargados por el auto-descargador se guardan en `/library/downloads/staged/` y se registran en `staged_imports` con `status = 'pending'`.
* **Aislamiento**: **NO** se ejecutan llamadas automáticas a `runLibraryScan()` directamente a los catálogos públicos. Los usuarios **no ven** nombres técnicos o sucios en la pantalla principal.

---

### 2.3 Panel de Administración (`frontend/index.html` y `frontend/app.js`)
* **Nueva Pestaña "Biblioteca por Organizar" (Staging Area)**:
  * Lista todas las descargas pendientes de revisión.
  * Muestra el nombre técnico original y campos editables para:
    * Nombre limpio del anime/película.
    * Número de temporada y episodio.
    * Búsqueda/Asignación de ID de TMDB.
  * **Botón "Aprobar y Publicar al Catálogo"**:
    * Mueve el archivo de video directamente de `/library/downloads/staged/` a `/library/Anime/[Nombre]/Season XX/` (o `/library/Movies/[Nombre]/`).
    * **Cero Duplicación de Disco**: Utiliza `fs.rename` (movimiento directo) para mantener **1 sola copia física del archivo** y no duplicar espacio.
    * Ejecuta el escaneo de biblioteca para integrar el anime al catálogo público de inmediato.
    * Elimina la entrada de `staged_imports`.
  * **Botón "Eliminar"**:
    * Elimina el archivo físico de la carpeta staging y borra la entrada de la base de datos.

---

### 2.4 Servidor de Pósters Genéricos (`backend/server.js`)
* **Endpoint `/api/placeholder-poster`**:
  * Genera una imagen SVG dinámica y elegante con gradiente oscuro, efecto glassmorphism, el logotipo oficial de **KuraStream** y el título limpio del anime.
  * Se activa automáticamente en el catálogo público cuando un anime no tiene `poster_path` válido o cuando el servidor trabaja en modo offline.

---

### 2.5 Corrección de Carga Masiva de Episodios (12+ Archivos)
* **Backend (`backend/server.js`)**:
  * `/api/import` maneja de forma robusta los errores de episodios existentes (retornando JSON formateado `{ success: false, error: "..." }` en lugar de respuestas 400 en texto plano que rompen la subida).
* **Frontend (`frontend/app.js`)**:
  * El bucle de carga masiva en `uploadFileWithProgress` añade manejo de excepciones por cada episodio individual.
  * Si un capítulo falla o ya existe, la interfaz continúa con los siguientes capítulos, mostrando una barra de progreso limpia y evitando cierres inesperados de JavaScript.

---

## 3. Plan de Verificación

### Pruebas Automatizadas
* Ejecutar la suite completa de unit tests (`node --env-file=.env --test tests/*.test.js`) asegurando que todas las tablas y endpoints respondan con éxito.

### Verificación Manual
* Probar la adición de items a `staged_imports`.
* Verificar que los elementos en staging **no aparezcan** en `/api/shows` (catálogo público).
* Probar la publicación de un anime desde la pestaña Admin Staging y confirmar que el archivo se mueve a la biblioteca pública sin duplicar espacio en disco.
* Probar la generación del póster genérico para animes sin portada.
* Probar la subida masiva de episodios simulados en la interfaz de administración.
