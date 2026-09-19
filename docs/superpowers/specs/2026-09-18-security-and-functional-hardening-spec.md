# Especificación Técnica: Seguridad Integral y Correcciones Funcionales (KuraStream Hardening)

Fecha: 2026-09-18  
Estado: Aprobado  
Módulos Afectados: `php_backend/` (Auth, History, Show, Player, Admin, TorrentDownloader, Router, DB), `frontend/` (app.js, player.js, auth.js)

---

## 1. Contexto y Objetivos

KuraStream ha completado la migración principal hacia su arquitectura modular en PHP 8.4 con MySQL. No obstante, para garantizar una operación robusta, segura y lista para producción, es prioritario cerrar vulnerabilidades de control de acceso, XSS, fugas de credenciales y desajustes de API entre el cliente y el servidor.

El objetivo de esta especificación es definir los requisitos técnicos y contratos de interfaz para:
1. **Seguridad de Sesión y Control de Acceso (Prioridad 1)**: Forzar la identidad por JWT para datos de usuario, migrar tokens a cookies HttpOnly/SameSite, hashear PINs de perfiles, eliminar credenciales hardcodeadas, sanitizar entradas contra XSS, proteger `/api/debug-log`, implementar rate limiting y validar subidas de archivos.
2. **Correcciones Funcionales y Consolidación (Prioridad 2)**: Corregir el sistema de comentarios, formalizar PHP/MySQL como único backend aislando el código Node heredado, soportar `aria2c.exe` en Windows, reportar errores de APIs externas, validar episodios antes de publicación y blindar el streaming por ID de episodio.
3. **Hoja de Ruta (Prioridades 3, 4 y 5)**: Establecer las bases para la suite de pruebas multiplataforma, el refactor CSS/móvil y el despliegue de vídeo en la nube.

---

## 2. Requerimientos de Seguridad (Prioridad 1)

### 2.1 Identidad Exclusiva por JWT para Datos Privados
- **Problema actual**: `HistoryController::resolveUserAndProfile` permitía recibir `username` vía `$_GET` o cuerpo JSON como fallback cuando no había token o para sobreescribir la identidad.
- **Requisito**:
  - `HistoryController::getHistory`, `saveProgress`, `getProgress`, `getFavorites`, `toggleFavorite`, `getUserPreferences` y `saveUserPreferences` DEBEN extraer obligatoriamente la identidad `$username` del payload del JWT verificado vía `AuthMiddleware::requireAuth()`.
  - Se prohíbe terminantemente aceptar `username` proveniente de query string o payload JSON para alterar datos de cuenta.
  - Usuarios no autenticados (invitados) recibirán HTTP 401 si intentan consultar o mutar historial/favoritos en el servidor. El cliente web mantendrá el historial de invitados exclusivamente en `localStorage` del navegador.

### 2.2 Eliminación de Credenciales Predefinidas y Aislamiento de Backend Node
- **Problema actual**: Existían cuentas fijas (`TheCarlosS5`, contraseñas `Carlos2009`, PIN `0101`) en el código.
- **Requisito**:
  - Eliminar cualquier credencial hardcodeada en archivos PHP y scripts.
  - El backend Node (`backend/`) se traslada a `legacy_backend/` y se desvincula de los scripts de arranque en `package.json`.

### 2.3 Hasheo de PINs de Perfiles
- **Problema actual**: La columna `pin` en `user_profiles` almacenaba texto plano (`VARCHAR(10)`).
- **Requisito**:
  - Modificar columna `pin` a `VARCHAR(255)` para almacenar hashes bcrypt generados con `password_hash($pin, PASSWORD_BCRYPT)`.
  - Al guardar o editar un perfil (`DbHelper::saveUserProfile`), si se proporciona un PIN de 4 dígitos, se hashea antes de persistirlo.
  - `getProfiles()` NUNCA devolverá el hash ni el PIN al cliente; únicamente devolverá una bandera booleana `has_pin: true/false`.
  - Implementar endpoint `POST /api/profiles/select` que verifique `$pin` con `password_verify()` contra el hash almacenado y devuelva el token de sesión asociado al perfil.

### 2.4 Sesión en Cookies HttpOnly / SameSite
- **Requisito**:
  - En `AuthController::login` y `AuthController::register`, además de retornar el token en JSON, se emitirá una cookie HTTP:
    ```php
    setcookie('kurastream_token', $token, [
        'expires' => time() + (30 * 24 * 3600),
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    ]);
    ```
  - `AuthMiddleware::getBearerToken()` se actualiza para leer tanto de `$_COOKIE['kurastream_token']` como del encabezado `Authorization: Bearer <token>`.
  - Se añade `POST /api/logout` para limpiar la cookie (`setcookie('kurastream_token', '', time() - 3600, '/')`).

### 2.5 Prevención de XSS y Saneamiento en Frontend
- **Requisito**:
  - Implementar un helper centralizado y seguro `escapeHtml(str)` en el frontend.
  - Reemplazar todas las interpolaciones inseguras de texto de usuario (títulos de series, nombres de usuario, comentarios, nombres de salas de Watch Party, mensajes de error) en cadenas `innerHTML` por texto escapado o mediante asignación directa con `.textContent` y `.setAttribute()`.

### 2.6 Protección y Restricción de `/api/debug-log`
- **Requisito**:
  - El endpoint `/api/debug-log` solo estará disponible si `getenv('APP_ENV') === 'development'` o si el usuario autenticado tiene rol `admin`.
  - El contenido del log estará limitado a un máximo de 2048 caracteres por petición.

### 2.7 Rate Limiting en API
- **Requisito**:
  - Crear clase `RateLimiter` en `php_backend/middleware/RateLimiter.php` con almacenamiento temporal en archivos bajo `sys_get_temp_dir() . '/kura_ratelimit_' . md5($key)`.
  - Límites aplicados:
    - Login / Registro: 10 intentos por IP cada 5 minutos.
    - Comentarios: 5 comentarios por usuario/IP cada 1 minuto.
    - Watch Party (creación de salas): 10 salas por hora por usuario.

### 2.8 Validación Estricta de Subidas de Archivos
- **Requisito**:
  - `AdminController` validará en toda subida (`video`, `poster`, `backdrop`, `avatar`):
    - Tamaño máximo: 15MB para imágenes, 4GB para vídeos.
    - Extensiones permitidas: `.jpg`, `.jpeg`, `.png`, `.webp` para imágenes; `.mp4`, `.mkv`, `.webm` para vídeos.
    - Tipo MIME real verificado mediante `finfo_file(finfo_open(FILEINFO_MIME_TYPE), $tmpPath)`.

---

## 3. Requerimientos Funcionales (Prioridad 2)

### 3.1 Corrección del Módulo de Comentarios
- **Problema actual**: El cliente consultaba `/api/comments?showId=...` y enviaba `{ showId, username, comment }`, mientras que el backend esperaba `show_id` y `content`, requiriendo auth.
- **Requisito**:
  - En backend (`ShowController.php` y `router.php`):
    - Aceptar tanto `show_id` como `showId` en `GET /api/comments`.
    - En `POST /api/comments`: validar que el contenido no esté vacío, obtener el autor del JWT, aceptar tanto `content` como `comment` en el payload. Retornar el comentario recién creado con su ID y fecha.
  - En frontend (`app.js`):
    - Enviar `show_id` y `content`.
    - Renderizar los comentarios de forma segura sanitizando el contenido con `escapeHtml()`.

### 3.2 Consolidación en PHP/MySQL
- **Requisito**:
  - Mover `backend/` a `legacy_backend/`.
  - Actualizar `package.json` para que scripts apunten a validaciones y tareas de mantenimiento PHP o Docker, evitando que el servidor Node se inicie por omisión.

### 3.3 Soporte Windows para `aria2c.exe`
- **Requisito**:
  - En `TorrentDownloader.php`:
    - `getAria2Path()` debe detectar `bin/aria2c.exe` en Windows y buscar vía `where aria2c.exe`.
    - Reemplazar comandos de shell Unix (`ps -p`, `kill -STOP`, `kill -CONT`) por mecanismos multiplataforma (detección con `tasklist` en Windows, o pausado mediante control de cola/archivo de estado).

### 3.4 Reporte de Errores en Servicios Externos
- **Requisito**:
  - En `TmdbScraper.php`, `CalendarController.php` y `TorrentDownloader.php`: capturar excepciones de red/cURL o respuestas inválidas y retornar mensajes JSON estructurados con código de error y detalle informativo, en lugar de cadenas vacías o terminaciones abruptas.

### 3.5 Validación de Integridad de Episodios antes de Publicar
- **Requisito**:
  - En `AdminController::publishStagedImport`, antes de insertar o mover un episodio a `Anime/` o `Movies/`, verificar:
    - Que el archivo de origen exista físicamente y sea legible.
    - Que el tamaño sea mayor a 1 MB.
    - Ejecutar probe rápido vía `FfmpegScanner` para confirmar duración > 0 y resolución válida. Si falla, responder con error 422 descriptivo.

### 3.6 Blindaje de Streaming por ID de Episodio
- **Requisito**:
  - `PlayerController::streamVideo` debe aceptar únicamente identificadores de episodio registrados en la base de datos (`/api/stream/{episode_id}`).
  - Desactivar o restringir el acceso directo a archivos de vídeo arbitrarios a través de URLs de biblioteca estática en `router.php`.
