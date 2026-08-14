# 蔵 KuraStream — Personal Anime & Media Server

**KuraStream** es un servidor privado y ligero de transmisión de medios (Anime y Películas) optimizado para reproducción offline y streaming local en redes LAN/Internet.

---

## 🏛️ Arquitectura del Sistema (PHP 8.x + MySQL + Frontend Vanilla JS)

El backend de KuraStream fue migrado a una arquitectura altamente modular y limpia en **PHP 8.x**, desacoplada por controladores y servicios, utilizando **MySQL / MariaDB (PDO)** para eliminar la dependencia de archivos de base de datos dentro del repositorio del proyecto.

```
KuraStream/
├── frontend/                     # Interfaz de Usuario (HTML5, JS, CSS3)
│   ├── index.html                # Documento principal SPA (Single Page App)
│   ├── style.css                 # Sistema de diseño con modo oscuro y animaciones neón
│   └── app.js                    # Enrutador cliente, llamadas a API y reproducción
│
├── php_backend/                  # Servidor Backend Modular en PHP 8
│   ├── config.php                # Constantes globales, secretos JWT y headers CORS
│   ├── db.php                    # Conexión PDO MySQL y consultas a la Base de Datos
│   ├── router.php                # Enrutador principal (Front Controller) para PHP -S / Nginx
│   │
│   ├── controllers/              # Controladores de Endpoints por Módulo
│   │   ├── AuthController.php    # Autenticación, hashing de contraseñas y tokens JWT
│   │   ├── ShowController.php    # Catálogo, búsquedas, carátulas HD e insignias
│   │   ├── CalendarController.php# Calendario Simulcast (AniList API GraphQL + Caché)
│   │   ├── PlayerController.php  # Streaming de vídeo con HTTP 206 Partial Content (Range)
│   │   ├── HistoryController.php # Historial de reproducción "Seguir Viendo" y Favoritos
│   │   └── AdminController.php   # Panel Admin: Importaciones preparadas y estadísticas
│   │
│   └── services/                 # Servicios Lógicos Independientes
│       ├── TmdbScraper.php       # Cliente API para metadata e imágenes de TMDB
│       ├── FfmpegScanner.php     # Análisis técnico de vídeos (FFprobe) y thumbnails
│       └── LibraryScanner.php    # Escáner de la biblioteca física (/library/Anime)
│
├── library/                      # Almacén de Vídeos y Carátulas
│   ├── Anime/                    # Carpetas por serie con archivos .mkv / .mp4
│   └── Movies/                   # Películas independientes
│
├── docs/                         # Especificaciones técnicas y planes de arquitectura
└── README.md                     # Documentación general del proyecto
```

---

## 📖 Explicación Detallada de Cada Archivo

### 1. Núcleo Backend (`php_backend/`)
* **`php_backend/config.php`**: Define constantes de entorno (`DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`), secretos para tokens JWT y funciones auxiliares para responder respuestas JSON con cabeceras CORS.
* **`php_backend/db.php`**: Inicializa la conexión PDO a MySQL, crea automáticamente la base de datos `kurastream` y sus tablas (`shows`, `episodes`, `watch_history`, `favorites`, `staged_imports`) e incluye métodos CRUD seguros.
* **`php_backend/router.php`**: Punto de entrada del servidor (Front Controller). Sirve archivos estáticos directamente (`index.html`, `app.js`, `style.css`, imágenes de `/library`) y enruta llamadas a `/api/...` hacia su controlador correspondiente.

### 2. Controladores (`php_backend/controllers/`)
* **`AuthController.php`**: Procesa `/api/login`, realiza el hashing HMAC-SHA256 con sal y emite tokens JWT.
* **`ShowController.php`**: Procesa `/api/shows`, filtros por estado (En Emisión / Finalizado), ordenamiento por año/rating/título, búsquedas y alternancia de estado de emisión.
* **`CalendarController.php`**: Procesa `/api/calendar/schedule`. Consulta AniList GraphQL API, almacena en caché la respuesta por 6 horas y cruza los títulos con MySQL para marcar animes en biblioteca.
* **`PlayerController.php`**: Procesa `/api/episodes/{id}` y `/api/stream`. Implementa streaming de vídeo nativo con soporte `Range: bytes=X-Y` enviando código de estado HTTP `206 Partial Content`.
* **`HistoryController.php`**: Almacena el progreso de reproducción por usuario/perfil (*Seguir Viendo*) y gestiona *Mi Lista* de favoritos.
* **`AdminController.php`**: Gestiona la bandeja de preparación de descargas (`/api/admin/staged`), publicación en catálogo, borrado y estadísticas de almacenamiento.

### 3. Servicios (`php_backend/services/`)
* **`TmdbScraper.php`**: Realiza peticiones cURL a TheMovieDatabase API para descargar sinopsis, rating, reparto y carátulas HD.
* **`FfmpegScanner.php`**: Ejecuta `ffprobe` en línea de comandos para extraer duración, resolución, códecs, pistas de audio y subtítulos.
* **`LibraryScanner.php`**: Lee las carpetas físicas en `/library/Anime` y `/library/Movies`, sincronizando la estructura en MySQL.

---

## 🗄️ Base de Datos MySQL (Sin archivos dentro del proyecto)

La base de datos se aloja en el motor **MySQL / MariaDB** del sistema en `127.0.0.1:3306`.

### Tablas Creadas Automáticamente:
1. `shows`: Almacena información de series y películas (ID, título, sinopsis, rating, año, estado, carátulas).
2. `episodes`: Almacena metadata técnica de cada vídeo (ruta en disco, duración, códec, resolución, subtítulos).
3. `watch_history`: Registra el segundo exacto donde cada perfil pausó la reproducción.
4. `favorites`: Guarda la lista de animes favoritos por perfil.
5. `staged_imports`: Bandeja de descargas listas para organizar y publicar en el catálogo.

---

## 🚀 Cómo Iniciar el Servidor PHP

Para iniciar el servidor backend de KuraStream en el puerto `3000`:

```bash
php -d extension=pdo_mysql.so -S 0.0.0.0:3000 php_backend/router.php
```

Luego abre tu navegador en: `http://localhost:3000` o la IP local de tu máquina en la red.
