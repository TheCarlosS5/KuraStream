# Plan integral de mejoras — KuraStream (auditoría del 5 de octubre de 2026)

## Contexto

Pediste una revisión a fondo de todo el proyecto para que los usuarios no tengan problemas, y ver qué funciones nuevas se pueden añadir. Por ahora solo se planifica, no se programa.

**Qué se revisó** (código leído, no solo buscado):
- Backend PHP: unas 11 000 líneas.
- Web/PWA: unas 23 000 líneas.
- App Android en Kotlin: unas 15 500 líneas.
- Además: Docker, `scripts/debian_setup.sh`, CI y pruebas.

Los hallazgos graves los comprobé yo mismo en el código.

**Tu contexto, según tus respuestas:**
- Solo red local (LAN o el hotspot del portátil).
- La prioridad es la app Android para móvil.
- Más de 30 usuarios a la vez.
- El registro sigue abierto.
- En Watch Party, los invitados sin cuenta solo entran si el anfitrión lo activa.
- No sabes si el servidor usa Docker o Debian, así que el plan cubre los dos.

**Conclusión:** el proyecto tiene muchísimas funciones y buena intención de seguridad (consultas SQL preparadas, `escapeshellarg`, `realpath`, tokens del Keystore en Android). Pero hay cuatro problemas que van a afectar a usuarios reales:

1. **Seguridad.** Hay agujeros que cualquiera conectado al WiFi puede aprovechar. Lo peor:
   - Se puede falsificar un token de admin si el `JWT_SECRET` es el de ejemplo.
   - Una sola petición de admin puede borrar toda la carpeta `Anime/`.
   - El PIN de 4 dígitos se adivina en menos de un minuto, lo que anula el modo infantil.
2. **Capacidad.** La infraestructura no aguanta 30 usuarios:
   - `php -S`, el servidor de desarrollo de PHP, tiene 16 procesos en total.
   - Cada video y cada conexión de Watch Party ocupa un proceso durante todo el episodio.
   - El hotspot está en 802.11g, unos 20 Mbps reales para todos.
3. **Errores visibles en Android y la web:**
   - Watch Party en Android se rompe a los 15 minutos.
   - La web puede quedar en blanco después de cada actualización.
   - Los errores se muestran como "tu lista está vacía".
4. **Las pruebas no protegen.** En CI, las pruebas PHP, E2E y Docker tienen `continue-on-error: true`. Además, las pruebas escriben en la misma base de datos que la app.

**Tamaño de cada tarea:** **S** = 1 día o menos · **M** = 2 a 4 días · **L** = 1 a 2 semanas.

---

## Fase 0 — Seguridad urgente (hacer antes que nada) · unas 1–2 semanas

**0.1 Secreto JWT y credenciales por defecto (S)**
- `php_backend/config.php:40-49` solo rechaza un secreto vacío:
  - Que el servidor no arranque si `JWT_SECRET` mide menos de 32 bytes o está en una lista negra (`change_me`, `secret`, …).
  - Lo mismo para `ADMIN_PASS=change_me`.
- `AuthController.php:36` compara `ADMIN_PASS` en texto plano con `===`. Usar `hash_equals`, o mejor exigir `ADMIN_PASS_HASH` y `password_verify`.
- Quitar el `PASSWORD_SALT='kurasalt'` por defecto (`config.php:50`).
- Migrar los hashes SHA-256 antiguos (`AuthController.php:76`) a una comparación en tiempo constante, y volver a guardarlos con bcrypt al iniciar sesión.

**0.2 Separar los tipos de token y comprobar el rol en la base de datos (M)**
- **Problema:** `AuthMiddleware::verifyToken/requireAuth` (`middleware/AuthMiddleware.php:21-106`) acepta cualquier JWT firmado. Los tickets de Watch Party (`type: watch_party_stream`, `party_sse`) pasan como sesión. `requireAdmin` (`:87`) se fía solo del claim `role`.
- **Cambio:**
  - Añadir el claim `typ: "session"` en `AuthController::issueProfileToken` y en el login.
  - `requireAuth` debe rechazar tokens con `type`/`typ` distinto de `session`.
  - Añadir la columna `users.token_version` (migración `013_...sql`) y meter `ver` en el JWT.
  - `requireAuth` hace una consulta barata por petición (cacheada en una variable estática). Si `ver`, `role` o el estado del usuario no coinciden, responde 401. Esa misma consulta vuelve a leer `is_kids` del perfil, para que activar el modo infantil se aplique al instante en todos los dispositivos.
  - Endpoints nuevos: `POST /api/account/password` (cambiar contraseña, sube `token_version`) y `POST /api/account/logout-all`.

**0.3 Límite de intentos del PIN (S)**
- `POST /api/profiles/select` (`router.php:176`, `AuthController.php:288`), `saveProfile` con `current_pin` (`db.php:1051`) y el borrado de perfil (`db.php:1203`) no tienen límite.
- Reutilizar `RateLimiter::enforce()` con la clave `pin_{username}_{profileId}`: 5 intentos fallidos cada 15 minutos, después bloqueo.
- Validar en el servidor que el PIN tenga entre 4 y 6 dígitos (`db.php:1104`).

**0.4 Borrado de shows y rutas de admin que pueden salirse de la biblioteca (S)**
- **Problema:** `DELETE /api/shows/%2E` borra toda la carpeta `Anime/`, y `..%2FMovies` borra las películas. Causa: `router.php:207` aplica `urldecode` después de comprobar la ruta, y `ShowController::deleteShow` (`:277-302`) construye la ruta con un id sin validar.
- **Cambio:**
  - Exigir que el show exista en la base de datos y construir la ruta desde su carpeta registrada.
  - Rechazar `.`, `..`, separadores y bytes de control.
  - En `deleteDirectoryRecursive` (`:305`), no seguir symlinks (`is_link` → `unlink`).
- Mismo patrón en `AdminController` cuando el show no existe y se usa el id crudo:
  - `uploadShowMedia` (`:750`), `uploadShowLoop` (`:798`) y `scrapeShowCover` (`:914`).
  - `sourcePath` acepta cualquier cosa bajo `/tmp` (`:19`); limitarlo a la carpeta de staging.
- Crear un helper único `LibraryPaths::showDir(array $show)` que reemplace las ~8 copias.

**0.5 No mostrar errores internos al cliente (S)**
- El contenedor `php:8.4-cli` no trae php.ini, así que `display_errors=1` muestra trazas, rutas y SQL.
- **Cambio:**
  - En `config.php`: `ini_set('display_errors','0')`, `log_errors=1`, y un `set_exception_handler` / `register_shutdown_function` que responda `{"error":"Error interno","request_id":…}` con 500 y registre el detalle en el log.
  - Crear un helper de validación de entrada (`Input::string($data,'username',max:64)`, `Input::int`, …) y usarlo donde ahora se hace `trim($data['x'])` sobre un array (`AuthController.php:19`, `PartyController.php:206`, `ShowController.php:37`).
  - Capturar los errores de clave duplicada en `registerUser` (`db.php:954`) y `toggleFavorite` (`HistoryController.php:365`).

**0.6 Registro abierto pero controlado (S)**
- Mantener el registro abierto (lo decidiste así), con estos controles:
  - Variable `REGISTRATION_MODE=open|closed`, por defecto `open`, para poder cerrarlo sin tocar código.
  - Límite de 3 registros por IP y hora, que funcione bien detrás de nginx (ver 1.7).
  - Nombre de usuario de 3 a 32 caracteres `[a-zA-Z0-9_.-]`.
  - Reservar el nombre de `ADMIN_USER`.
  - Contraseña de mínimo 8 caracteres y máximo 72 bytes (bcrypt ignora el resto).
- La gestión de usuarios en el panel de admin (N-W1) va en la Fase 6, pero con registro abierto conviene adelantarla.

**0.7 Invitados en Watch Party solo si el anfitrión lo permite (M)**
- **Problema:** `POST /api/party/join` y `GET /api/party/public-rooms` no piden sesión (`PartyController.php:10-38, 280-365, 585`), y el ticket de stream se renueva sin límite (`:759-795`).
- **Cambio:**
  - Nueva columna `party_rooms.allow_guests` (por defecto 0).
  - Si es 0, `join` exige sesión con perfil. `public-rooms` siempre exige sesión.
  - Los nombres de invitado no pueden ser "Sistema" ni el nombre de un usuario existente.
  - `updateSettings` solo acepta una lista blanca de campos (hoy permite cambiar `host_user`, `db.php:1369`).

**0.8 Datos expuestos y archivos públicos (S)**
- `GET /api/comments` devuelve `c.*` con `username`, que es el nombre de login (`db.php:1225`). Devolver solo el nombre del perfil y el avatar.
- `/library/*` usa una lista negra de extensiones (`router.php:87-101`). Cambiarla por una lista blanca: imágenes (`jpg/png/webp/svg`) y `loop_*.mp4` mediante un endpoint propio. Así también se arregla el bug de que los videos de fondo nunca cargan.
- Los endpoints de catálogo (`/api/shows`, `/api/shows/{id}`, `/api/episodes/{id}`, `/api/calendar`, `/api/comments`) pasan a pedir sesión.
- `/api/calendar?force=1` queda solo para admin, porque hace hasta 4 llamadas a AniList.
- `/api/health` deja de mostrar la versión de PHP.

**0.9 Estilos inyectados y tokens en las URL de la web (S)**
- **Avatar y color de perfil:**
  - En `db.php:1077-1102`, validar `color` con `^#[0-9a-fA-F]{6}$` y `avatar` solo como `^/library/avatars/[A-Za-z0-9_./-]+$`.
  - En `frontend/js/main.js:1690-1692, 3513, 3909`, poner los estilos con `el.style.backgroundImage = 'url(' + JSON.stringify(src) + ')'` en lugar de concatenarlos en `style=""`.
- **Token en URL:** quitar `params.set('token', …)` de `frontend/player.js:283-284` y `:792-793`. El servidor nunca lo lee; la cookie HttpOnly ya autoriza el `<video>`, y así el token deja de aparecer en el log que muestra la Consola de admin.
- **CSRF:**
  - Las peticiones que cambian datos solo se aceptan si llevan `Authorization: Bearer` o la cabecera `X-Requested-With`.
  - La cookie queda solo para `GET /api/stream`, `/api/subtitles` y `/api/episodes/*/fonts`.
  - Los GET que hoy cambian datos pasan a POST: `detect-timings` (`AdminController.php:1325`) y `staged` (`:106`).

**0.10 Distribución segura de la app Android (M)**
- **Problema:** `AppDownloadController.php:12` sirve `KuraStream-debug.apk` (depurable, con el id `com.kurastream.app.debug`, firmado con la clave de un PC).
- **Cambio:**
  - **CI:** compilar `assembleRelease` firmado con una clave guardada en GitHub Secrets. Corregir los nombres de variables de firma, que no coinciden entre `build.gradle.kts:31-41` y `android/README.md`, y hacer que la compilación falle si no hay firma (hoy cae en `signingConfig = null`).
  - **Servidor:** `/api/app/android` devuelve `versionCode`, `versionName`, `sha256`, tamaño y novedades. El servidor los lee de un `app-release.json` que genera la CI, no de `build.gradle.kts`.
  - **Web:** la página de descarga muestra el SHA-256.
  - **Migración:** pasar de `.debug` a release cambia el id del paquete. Avisar en la app vieja para que los usuarios desinstalen e instalen la nueva.
  - **Respaldo:** guardar una copia segura del keystore. Si se pierde, ninguna actualización futura se podrá instalar encima.

---

## Fase 1 — Infraestructura para más de 30 usuarios a la vez · unas 2–3 semanas

**1.0 La red WiFi es el primer cuello de botella (decisión de hardware, S)**
- `scripts/debian_setup.sh:110-115` crea el hotspot con `802-11-wireless.band bg` (802.11g, unos 20–25 Mbps reales compartidos). Muchas tarjetas WiFi de portátil, además, no aceptan más de 8–10 clientes en modo AP.
- **El cálculo:** 30 personas × 3–5 Mbps por episodio = 90–150 Mbps sostenidos.
- **Recomendación:** un router o punto de acceso WiFi 5/6 dedicado, conectado al servidor por cable Gigabit. Dejar el hotspot del portátil como modo de respaldo, en banda `a` (5 GHz) si la tarjeta lo soporta.
- Cambios al script:
  - Contraseña del hotspot aleatoria (hoy es `kurastream2026` fija, `:14`).
  - No imprimir la contraseña de admin.
  - Usuario de servicio dedicado.

**1.1 Cambiar `php -S` por nginx + PHP-FPM (L)**
- **Stack:**
  - nginx sirve `frontend/` directamente, con gzip y caché.
  - Pasa `/api/*` a PHP-FPM con `router.php` como controlador frontal.
  - Se activa opcache.
- **Dos pools de FPM:**
  - `api`: `pm=dynamic`, unos 32 procesos, `request_terminate_timeout` de 120 s.
  - `sse`: `pm=ondemand`, unos 120 procesos con poco `memory_limit`, para `/api/party/stream` con `fastcgi_buffering off`.
- **Tamaño de subida:** `client_max_body_size` de 4 GB solo en `/api/import`; 1 MB en el resto. Hoy `post_max_size=4096M` aplica a todo (`.user.ini`, `php.ini`), así que cualquiera puede mandar varios GB a cualquier URL.
- **Docker:** `docker-compose.yml` con los servicios `nginx`, `app` (php-fpm), `worker` (ver 1.5) y `mysql`. Añadir `healthcheck` y un UID fijo para el volumen de la biblioteca.
- **Debian:** `debian_setup.sh` instala `nginx` y `php8.4-fpm`, crea los pools, `kurastream-worker.service` y un usuario de sistema `kurastream`.
- **Archivos nuevos:** `deploy/nginx/kurastream.conf`, `deploy/php-fpm/{api,sse}.conf`, `deploy/systemd/kurastream-worker.service`.
- **Windows:** `npm run dev` con `php -S` se queda solo para desarrollo, y el README lo debe decir claramente.

**1.2 Reproducción directa servida por nginx con `X-Accel-Redirect` (M)**
- **Problema:** en `PlayerController::streamVideo` (`:692-781`), PHP lee el archivo en bloques de 64 KB. A los clientes sin "Mozilla/" en el User-Agent (ExoPlayer) les manda el archivo entero en una respuesta (`:717-719`), ocupando un proceso todo el episodio.
- **Cambio:** PHP solo autoriza:
  - Reutilizar `authorizeStreamAccess` y `checkKidsModeAccess`.
  - Responder con la cabecera `X-Accel-Redirect: /_media/<ruta relativa>`.
  - nginx sirve el archivo desde un `location /_media/ { internal; alias LIBRARY_DIR/; }` con `sendfile`, y los rangos los gestiona nginx.
- Se elimina el truco de "Mozilla/" y los bloques de 8 MB.
- Mantener el código PHP actual como respaldo cuando no hay nginx (variable `X_ACCEL=0` para Windows).

**1.3 Android reproduce MKV y HEVC directo, sin ffmpeg (M) — la mejora más importante para tu caso**
- **Hoy:**
  - `StreamResolver.canDirectPlay` (`android/.../core/player/StreamResolver.kt:22-40`) solo acepta mp4/webm/m4v con H.264, igual que la web.
  - Así, cada MKV abre un ffmpeg en el servidor, adelantar reinicia ffmpeg, y cambiar audio o subtítulos recarga todo.
  - ExoPlayer/Media3 reproduce MKV de forma nativa: pistas de audio, subtítulos SSA/ASS incrustados y HEVC por hardware en casi todos los móviles.
- **Servidor:**
  - `streamVideo` acepta `?direct=1`: reproducción directa por rangos de cualquier contenedor si el cliente lo pide (y vía 1.2).
  - `FfmpegScanner::probeVideo` (`services/FfmpegScanner.php:105-111`) pasa a guardar `profile`, `pix_fmt` y `bit_depth`. Hace falta para detectar H.264 de 10 bits (Hi10P), que ni los navegadores ni la mayoría de móviles decodifican por hardware.
- **Android:**
  - `canDirectPlay` consulta `MediaCodecList` según el códec, el perfil y la profundidad de bits del episodio.
  - Las pistas de audio y subtítulos se eligen en el cliente con `TrackSelectionParameters`, sin recargar.
  - Si no hay decodificador, vuelve al remux del servidor.
- **Resultado:**
  - Casi cero ffmpeg por usuario Android.
  - Adelantar es instantáneo.
  - Cambiar de audio no corta la reproducción.
  - También es la base de las descargas offline (N-A3).

**1.4 Transcodificación más eficiente (M)**
- `TranscodeLimiter::$maxWorkers = 8` está fijo (`PlayerController.php:9`): pasarlo a la variable `TRANSCODE_MAX_WORKERS`, por defecto `nproc/2`.
- **Al adelantar:** liberar la ranura del ffmpeg anterior. Hoy se devuelve 503 porque el proceso viejo no la suelta (`:533-539`). Usar una clave por sesión y episodio, y matar el proceso previo.
- **Hi10P:** transcodificar a 8 bits cuando `bit_depth > 8`, aunque el códec sea h264 (`:492, 588`).
- **Aceleración por hardware (opcional):** si existe `/dev/dri` (VAAPI o QSV de Intel), usar `h264_vaapi`. Detectarlo en el diagnóstico de admin.
- **Mensaje claro en la web:** como `<video>` no puede leer el 503, la web debe consultar antes un endpoint ligero `GET /api/stream/{id}/availability` y mostrar "Servidor ocupado (n/8), reintentando…".

**1.5 Cola de trabajos en segundo plano (L)**
- **Problema:** hoy el escaneo de biblioteca, la importación, la sincronización de temporadas y TMDB se ejecutan dentro de la petición HTTP:
  - `router.php:510-514`
  - `AdminController.php:280, 568, 691`
  - `LibraryScanner.php:393`, con un presupuesto de 90 s
- **Cambio:**
  - Tabla `jobs` (id, tipo, payload, estado, progreso, error, fechas).
  - `php_backend/worker.php`: un bucle CLI que toma trabajos con `SELECT … FOR UPDATE SKIP LOCKED`.
  - Los endpoints de admin encolan el trabajo y devuelven `job_id`.
  - Nuevo `GET /api/admin/jobs/{id}`; el panel de admin muestra el progreso.
- **Trabajos periódicos:**
  - `DbHelper::cleanupExpiredPartyRooms` (`db.php:1462`, hoy nunca se llama).
  - `PlayerController::pruneCacheDir`.
  - Limpieza de los archivos del rate limiter y de la caché de TMDB.
  - Copia de seguridad diaria con `mysqldump`.

**1.6 Subtítulos y fuentes preparados de antemano (M)**
- Al escanear, un trabajo extrae cada pista de subtítulos a `.ass` y las fuentes incrustadas, escribiendo en un archivo temporal y renombrándolo al terminar.
- Esto arregla la caché truncada: si ffmpeg se corta a los 20 s, hoy se sirve el `.ass` incompleto durante una semana (`PlayerController.php:394, 431, 838`).
- `streamSubtitle` queda como respaldo con escritura atómica y un límite de procesos ffmpeg simultáneos.

**1.7 Límite de peticiones que funcione detrás de nginx (S)**
- Con nginx, poner `TRUSTED_PROXIES` con la IP de nginx automáticamente en Docker y Debian. Sin eso, todos los usuarios comparten un mismo contador (`RateLimiter.php:51-76`): 10 logins cada 5 minutos para todo el mundo.
- Guardar los contadores en una tabla MySQL `rate_limits` (upsert atómico) en lugar de un archivo por IP en `/tmp` que nunca se borra.
- Si falla, rechazar (hoy deja pasar, `:15-22`).
- Añadir claves por cuenta además de por IP.

**1.8 Watch Party (SSE) más ligero y estable (M)**
- Columna `party_rooms.version`, que sube con cada cambio. El bucle SSE (`PartyController.php:691-737`, unas 5 consultas por segundo) solo consulta la versión cada segundo y lee el resto cuando cambia.
- Añadir `ignore_user_abort(true)` para que la limpieza de `:740-754` se ejecute de verdad.
- No borrar al miembro al cortarse la conexión (`:741-746`): darle 60 s de gracia usando `last_ping`.
- Índice en `party_members.last_ping`, y quitar el `DELETE` global en cada llamada (`db.php:1588-1594`).
- Número de secuencia en el estado (`seq`), para que un heartbeat viejo del anfitrión no pise un salto reciente.

**1.9 HTTPS en la LAN (opcional; solo si quieres la PWA completa en la web, M)**
- Sin HTTPS, en `http://10.42.0.1:3000` no funcionan ni el service worker, ni la instalación de la PWA, ni el portapapeles. Toda la capa PWA está inactiva para los móviles en la LAN.
- **Opción recomendada:**
  - Un dominio gratuito de DuckDNS apuntando a la IP de la LAN.
  - Certificado Let's Encrypt por DNS-01 con `acme.sh` (soporta DuckDNS).
  - nginx en el puerto 443.
  - Ojo: algunos routers bloquean respuestas DNS con IP privada (protección "DNS rebinding").
- Como Android es la prioridad, esto puede esperar.

---

## Fase 2 — App Android: errores que ven los usuarios · unas 2 semanas

**2.1 Watch Party se rompe a los 15 minutos (S, crítico)**
- El ticket dura 900 s (`PartyController.php:258, 343, 788`). Android nunca llama a `/api/party/refresh-ticket`, y `AppModule.kt:152-168` deja de mandar el token de sesión cuando hay ticket.
- **Cambio:**
  - En `WatchPartyRepository`, renovar el ticket cada 8 minutos y emitir el evento `TicketExpiring` (ya existe, `WatchPartyClient.kt:23`).
  - En el interceptor, mandar siempre `Authorization` además de `X-Stream-Capability`. El servidor (`PlayerController.php:104-145`) prueba primero el ticket y, si falla, la sesión.
  - Cambiar el mensaje engañoso "contenido restringido" (`PlayerViewModel.kt:474`).

**2.2 La sesión de Watch Party nunca termina (M)**
- Al recibir `RoomClosed`, 404 o 401 en SSE o en el sondeo, limpiar `WatchPartyRepository.activeSession` y `PartyPlaybackContext`, y avisar al usuario (`WatchPartyViewModel.kt:90-93, 216-220`).
- Reintentos con espera exponencial y aleatoria (de 1 s hasta 60 s); `WatchPartyClient.kt:108-114, 218-263` hoy reintenta cada 5 s para siempre.
- Detectar conexiones muertas con `readTimeout` de unos 30 s y el ping del servidor; hoy `readTimeout(0)` en `:86`.
- Reconectar al cambiar de red con `ConnectivityManager.NetworkCallback`.
- El ticket de la sala solo se manda a `/api/stream/{episodio de la sala}`, nunca a otros episodios.
- `change_episode` se envía en un scope que sobreviva a la navegación (`PlayerViewModel.kt:946-959`).

**2.3 Cierres inesperados y bloqueos (S)**
- **PiP:** comprobar `hasSystemFeature(FEATURE_PICTURE_IN_PICTURE)` antes de llamar a `setPictureInPictureParams` o `enterPictureInPictureMode` (`PlayerScreen.kt:242-252, 513-519`). Sin esa comprobación es probable que la app se cierre en Android Go.
- **Arranque:** quitar `runBlocking` de `MainActivity.onCreate` (`:55-67`) usando una splash screen que espera a un `StateFlow`. En los interceptores (`AppModule.kt:46, 97, 140, 175`), leer las preferencias de un caché en memoria.
- **Keystore:** poner `try/catch` en `SecureTokenStorage` (`:42-44`); si el Keystore falla, regenerar la clave y pedir login.
- **Conexión con el reproductor:** `PlaybackConnectionManager` debe avisar del error, reintentar, liberar el controlador anterior y llamar a `release()`.

**2.4 Preferencias que se sobrescriben (S)**
- Cambiar el idioma de audio en Ajustes manda un objeto `UserPreferences` parcial (`SettingsViewModel.kt:103-150`). Eso desactiva el salto de intro y resetea el EQ que se configuró en la web.
- **Servidor:** `POST /api/user/preferences` aplica solo los campos que llegan (semántica PATCH).
- **App:** lee `GET /api/user/preferences` al iniciar. Unificar el valor por defecto de `autoSkipIntro` (`KuraPreferencesDataSource.kt:17`).

**2.5 Permiso de red local en Android 17 (S)**
- Hoy solo se pide en la configuración del servidor (`ServerSetupScreen.kt:54-64`).
- Pedirlo también al iniciar si hay un servidor guardado.
- Ampliar `isLocalAddress` (`ServerUrlResolver.kt:99-122`) para cubrir IPv6 ULA, `100.64/10`, `.home.arpa` y nombres que resuelven a IP privada.

**2.6 Navegación y estado (M)**
- **Un solo NavHost:** usar un único `NavHost` dentro de `NavigationSuiteScaffold` (riel lateral en tablet, barra inferior en móvil). Hoy hay dos ramas (`AppNavGraph.kt:77-168`) y al rotar se pierde el scroll.
- **Pilas duplicadas:** quitar la pila duplicada al cambiar de perfil o de servidor (`:204-250`).
- **Brillo:** restaurar el brillo al salir del reproductor (`PlayerScreen.kt:166-185`).
- **Cerrar PiP:** al cerrar la ventana PiP siendo invitado sin control, parar solo la reproducción local (`:228-232`).
- **Progreso sin conexión:** guardarlo en una cola Room y enviarlo con WorkManager (`HistoryRepository.kt:56-63`).
- **Errores 401 y 403:** clasificarlos por el código HTTP (`HttpDataSource.InvalidResponseCodeException`), no buscando texto (`PlayerViewModel.kt:472-477`).

**2.7 Seguridad de la app (S)**
- **HTTP en claro:** se mantiene, porque se necesita en la LAN con IP dinámica. La app debe avisar claramente si la dirección no es privada, y no mandar el token si el servidor activo está vacío (`Interceptors.kt:85-90`, `AppModule.kt:144-149`).
- **Copias de seguridad:** excluir el archivo DataStore (`backup_rules.xml`, `data_extraction_rules.xml`).
- **Enlaces profundos:** validar los deep links con `DeepLinkParser` (hoy no se usa) o borrarlo.
- **Limpieza al cerrar sesión:** el logout borra la caché de shows e historial (`AuthRepository.kt:145-158`).
- **Versión:** la de Ajustes sale de `BuildConfig.VERSION_NAME` (`SettingsScreen.kt:447` dice 2.0.0).

**2.8 Mantenimiento de la app (M)**
- **Librerías:** actualizar AGP a una versión que soporte oficialmente `compileSdk 37` y quitar `android.suppressUnsupportedCompileSdk`. Actualizar también Kotlin 2.x (`compilerOptions`), Media3, Compose BOM, Room, Navigation, OkHttp y Coil (`android/gradle/libs.versions.toml`).
- **Lint:** volver a activar la regla `NewApi` y `checkReleaseBuilds` (`build.gradle.kts:86-90`).
- **ProGuard:** ajustar las reglas demasiado amplias (`proguard-rules.pro:6-8, 21`).
- **Archivos grandes:** dividir `PlayerViewModel.kt` (1170 líneas) en `PlaybackController`, `PartySyncCoordinator`, `ProgressSaver` y `UpNextController`, y `PlayerScreen.kt` (2075) en gestos, barra de progreso y hojas.
- **Textos:** pasar los 132 textos fijos a `strings.xml`.
- **Accesibilidad:**
  - `semantics` en la barra de progreso (`PlayerScreen.kt:1585-1710`).
  - Pausar el carrusel con `reducedMotion` (`HomeScreen.kt:407`).
  - Icono adaptativo y monocromático.
- **Documentación:** poner al día `docs/android/*.md`, que contradicen el código en varios puntos.

---

## Fase 3 — Backend: integridad de datos y API · unas 1–2 semanas

**3.1 Progreso de visualización (S)**
- Guardar el progreso con el id canónico del episodio; hoy se usa el id pedido, pero `getEpisode` acepta variantes (`HistoryController.php:258, 307`, `db.php:373-395`).
- `completed = GREATEST(completed, VALUES(completed))`: volver a ver el inicio no debe desmarcar el episodio (`db.php:200`).
- Cambiar la sintaxis obsoleta `VALUES()` por un alias `AS new`.
- Añadir `client_updated_at` para que gane la escritura más reciente entre dispositivos.

**3.2 Claves foráneas y huérfanos (M)**
- La migración `002_foreign_keys_and_indexes.sql` no crea ninguna clave foránea.
- **Nueva migración:**
  1. Limpiar los datos huérfanos.
  2. Añadir `FOREIGN KEY … ON DELETE CASCADE` para episodios, historial, favoritos, comentarios y salas.
- **Perfiles:** usar `profile_id` en lugar del nombre del perfil como clave en el historial, para que renombrar sea trivial. `moveProfileData` (`db.php:1114-1136`) hoy está fuera de transacción.

**3.3 Migraciones robustas (S)**
- **Fallos:**
  - Si `GET_LOCK` falla, no ejecutar las migraciones (`db.php:57-59`).
  - Si una migración falla, detener y marcar `/api/health` como "degraded"; no reintentar en cada petición.
- **Formato:**
  - Una sentencia por archivo, o un divisor de SQL que respete cadenas (`MigrationManager.php:62`).
  - Cada migración debe ser idempotente.

**3.4 Zona horaria (S)**
- Conexión PDO con `SET time_zone = '+00:00'`.
- Guardar todas las fechas en UTC y responder en ISO-8601 con zona (`db.php:1259`, `PartyController.php:549`).
- Para el calendario se mantiene `APP_TIMEZONE`.

**3.5 Rendimiento de la API (M)**
- `getShows` (`db.php:98-117`):
  - columnas concretas en lugar de `SELECT *` con LONGTEXT;
  - paginación;
  - filtros en SQL;
  - `ETag` / `304`.
- `getShowDetails` envía los episodios 4 veces (`ShowController.php:160-168`): enviarlos una sola.
- `getRandomShow`: aleatorio en SQL (`db.php:765`).
- Arreglar las consultas N+1 de `SeasonSync::staleShowIds`.
- `findShowByFolderOrTitle` (`db.php:135-145`): búsqueda exacta, o FULLTEXT si hace falta.

**3.6 Episodios desaparecidos (S)**
- `availability_status='missing'` se escribe (`LibraryScanner.php:379`) pero nunca se lee: marcar esos episodios como "No disponible" en la API y en la interfaz.

**3.7 Limpieza de código del backend (L, se puede hacer poco a poco)**
- **Dividir `db.php` (1606 líneas)** en repositorios: `ShowRepository`, `EpisodeRepository`, `UserRepository`, `ProfileRepository`, `PartyRepository` y `CommentRepository`. La capa de datos no debe llamar a `jsonError`.
- **Dividir `AdminController.php` (1636 líneas)** en `AdminImportController`, `AdminLibraryController`, `AdminTimingsController` y `AdminSystemController`.
- **Código muerto a borrar:**
  - `hashPassword`, `uploadAvatar`, `publishStagedImport`, `searchTmdb`;
  - las ramas SQLite;
  - `correlateAudioOpening`, que duplica `AudioIntroDetector`.
- **Código específico de tu biblioteca o de pruebas a borrar:**
  - títulos fijos en `AdminController.php:174-181, 1056-1060`;
  - el filtro de ids de prueba en `ShowController.php:43-57`;
  - las rutas `/home/dserver-calos/...` en `getLogs` (`:361-379`).
- **Copias repetidas a unificar:**
  - el cálculo de `isSecure`, copiado 6 veces, en `Http::isSecure()`;
  - el JSON de pistas en `Episode::tracks()`;
  - la comprobación infantil en `KidsPolicy`.
- **Formato de respuesta:** siempre `{success, data|error}`, con mensajes en español.

---

## Fase 4 — Web: errores que ven los usuarios · unas 2 semanas

**4.1 Página en blanco tras cada actualización (M, crítico)**
- Solo `main.js?v=` y `player.js?v=` llevan versión (`index.html:67, 1671`). Los demás módulos se cachean 24 h (`router.php:58-59`) y el service worker los sirve desde caché (`sw.js:113-131`). Al mezclarse versiones, la importación falla y la página queda en blanco.
- **Solución recomendada:** añadir **esbuild** (sin framework) con `npm run build`. Genera:
  - `frontend/dist/` con nombres con hash, minificado;
  - división de código: admin, Watch Party y calendario cargados bajo demanda con `import()`;
  - `asset-manifest.json`.
- **Cómo lo sirve nginx:** `dist/` con `Cache-Control: immutable`; `index.html` sin caché. PHP inyecta las rutas desde el manifiesto.
- **Lucide:** usar el paquete npm `lucide` importando solo los ~80 iconos que se usan. Hoy son 411 KB que bloquean la carga (`index.html:1669`).
- **Docker:** compilación en varias etapas (Node para el build y PHP para ejecutar).
- **Mantenimiento:** se acaba el `?v=` manual en 6 sitios.

**4.2 Service worker (S; solo tiene efecto con HTTPS)**
- Ignorar peticiones a otros orígenes: `if (url.origin !== location.origin) return;`. Hoy rompe las imágenes de TMDB y AniList y las fuentes (`sw.js:146-166`).
- **Precarga:**
  - precargar desde `asset-manifest.json`;
  - precarga tolerante a fallos (no `addAll`, que falla entero si falla un archivo);
  - límite de tamaño para la caché de imágenes.
- Avisar de "Nueva versión disponible → Recargar".
- Quitar el `notificationclick` muerto.

**4.3 Errores que parecen listas vacías (M)**
- Adoptar `frontend/js/core/api.js` (`ApiError` ya existe) como cliente único:
  - un 401 abre el login con un mensaje;
  - los errores de red muestran un aviso con "Reintentar".
- Distinguir "vacío" de "error" en Mi Lista, Historial, Estadísticas, Catálogo y Comentarios (`main.js:1797, 1855, 2208, 3045, 1676`). Avisar cuando falla guardar los ajustes (`:3306`).
- Mostrar el banner de sin conexión (`#offline-status-banner`, hoy nunca se activa).

**4.4 Respuestas viejas que pisan la vista actual (S)**
- Un token de navegación en `setupRouter` (`main.js:2661-2893`), con el mismo patrón de generación que ya usa `player.js:2220-2317`. Si llega la respuesta de la serie A cuando ya estás en la B, se descarta.
- Los botones Favorito y Comentar leen el id actual, no uno capturado en el momento del clic (`:1601, 1716`).
- No arrancar el video de fondo si ya saliste de la vista (`:1050-1078`).
- Restaurar el scroll al volver y subir arriba al entrar en una vista nueva.

**4.5 Watch Party en la web (M)**
- Mostrar el historial del chat al unirse; hoy se emite antes de que el reproductor esté escuchando (`party.js:236-241`).
- Guardar la membresía en `sessionStorage` para volver a unirse tras recargar, y salir de la sala en `pagehide`.
- **Sondeo de respaldo** (hoy cada 1,5 s para siempre):
  - que vuelva a intentar SSE;
  - que pare ante 403/404;
  - que se pause con la pestaña oculta.
- El anfitrión envía `episode_change` antes de pedir el stream (`player.js:2328-2334`).
- Indicador de conexión real (no "Sincronizado" fijo).
- Pedir confirmación antes de unirse con `#/party/CODE`.

**4.6 Reproductor web (M)**
- **Miniaturas de la barra de progreso:**
  - hoy un segundo `<video preload="auto">` descarga el episodio otra vez (`player_scrub_preview.js:80-103`);
  - reemplazarlo por miniaturas pregeneradas (N-W8).
- **WebAssembly de los subtítulos:**
  - añadir `'wasm-unsafe-eval'` y `worker-src 'self' blob:` a la CSP;
  - sin eso, SubtitlesOctopus usa el motor asm.js de 4,8 MB, mucho más pesado en PCs viejos.
- **Audio en silencio:**
  - no crear el AudioContext del ecualizador antes de un gesto del usuario (`player.js:2305`);
  - hoy, con boost o EQ activo, un enlace directo reproduce sin sonido.
- Si el navegador bloquea la reproducción automática, mostrar el botón grande "Reproducir".
- **Idioma de audio:** unificar el valor por defecto (hoy es `spa`/`jpn`/`default` en 3 sitios: `main.js:903, 1487`, `player.js:2271`), guardarlo por perfil en el servidor y añadirlo en Ajustes.
- **iPhone/Safari:** los MKV remuxados probablemente no se reproducen, porque el stream no acepta rangos. Se documenta como limitación conocida; la solución real es HLS (Fase 6, opcional).

**4.7 Accesibilidad (M)**
- **Tarjetas de perfil:** que sean `<button>` (`main.js:3920, 3948`).
- **Modales:**
  - usar `core/ui.js openModal` (existe pero no se usa);
  - `role="dialog"`, `aria-modal`, foco atrapado, Escape y devolver el foco al cerrar.
- **Controles del reproductor:** que no se oculten mientras tengan el foco (`player.js:637`).
- **Login:**
  - que sea un `<form>` con `autocomplete`;
  - PIN con `inputmode="numeric"` y pegado de los 4 dígitos (`main.js:3837`);
  - quitar el `window.prompt` del PIN (`:3376`).
- **Tarjetas de catálogo:** que sean `<a href>` para poder abrir en una pestaña nueva.

**4.8 CSP estricta (S, después de 4.1)**
- Mover los 3 `<script>` en línea de `index.html` a archivos.
- Quitar los `onerror=""` y los `href="javascript:void(0)"`; el manejador global de errores de `main.js:48-55` ya cubre las imágenes.
- CSP final: `script-src 'self'` (sin `'unsafe-inline'`), `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.
- Alojar Google Fonts en el propio servidor: en un hotspot sin internet hoy retrasan la primera carga.

**4.9 Rendimiento y limpieza de la web (M)**
- **Catálogo:**
  - pedir `/api/shows` una vez y reutilizarlo desde `appState`; hoy se pide en 7 sitios;
  - no reconstruir el popover en cada clic de filtro.
- **Imágenes:**
  - miniaturas de pósteres al importar (w342 y w780, WebP);
  - `srcset` y `loading="lazy"`;
  - hoy se usa `/original` de TMDB incluso en tarjetas pequeñas.
- **Código muerto a borrar:**
  - `core/router.js`;
  - `modules/catalog.js`;
  - `player_controller.js` (no sirve);
  - las ramas de respaldo del router (`main.js:2851-2860`).
- **Duplicados a unificar:**
  - `escapeHtml` ×4, `showToast` ×3, `formatTime` ×2;
  - la detección de idioma (unas 180 líneas en `main.js:739-853` y `1374-1442`), que debe usar `js/player/tracks.js`.
- **Dividir `main.js` (4169 líneas):** por vistas en `js/features/{catalog,detail,profiles,history,settings,calendar,admin}/`, como ya decía el plan del 25 de septiembre.

---

## Fase 5 — Calidad: CI, pruebas y operación · continua, empezar en paralelo a la Fase 0

**5.1 Que la CI falle de verdad (S)**
- Quitar `continue-on-error: true` de las pruebas PHP, E2E, Docker y capturas (`.github/workflows/ci.yml:68, 82, 96`).
- Usar MySQL 8.4 en CI, igual que en compose.
- Ejecutar `security.yml` también en las ramas `feat/*` y `claude/*`.
- Añadir `assembleRelease` y `lintRelease` a la CI de Android.

**5.2 Base de datos de pruebas aislada (S)**
- `tests/run_all_tests.php:77` usa la misma `DB_NAME` que la app. Si alguien ejecuta `npm test` en el servidor, se crean usuarios y shows falsos en producción.
- Exigir `DB_NAME_TEST`; si el nombre no termina en `_test`, el runner se niega a ejecutar.

**5.3 Pruebas nuevas (M)**
- **PHP**, una por cada arreglo de la Fase 0:
  - arranque con un secreto débil;
  - ticket de Watch Party usado como sesión → 401;
  - fuerza bruta del PIN → 429;
  - `DELETE /api/shows/%2E` → 400;
  - `{"username":[]}` → 400 JSON sin traza;
  - CSS en el avatar → rechazado;
  - invitado en una sala sin `allow_guests` → 403.
- **Android:**
  - ViewModels con Turbine (ya declarado);
  - interceptores con MockWebServer;
  - `WatchPartyClient`: renovación del ticket, espera exponencial, fin por 404.
- **Web:**
  - proyecto WebKit en `playwright.config.js`;
  - una prueba con el service worker activo;
  - una prueba de dos "despliegues" seguidos sin página en blanco.

**5.4 Prueba de carga para más de 30 usuarios (M)**
- Script k6 en `tests/load/k6_30_users.js`, que simula 30 usuarios haciendo:
  - login;
  - catálogo;
  - streaming por rangos (para la reproducción directa);
  - 10 en Watch Party con SSE;
  - 4 remux.
- **Objetivo:** `/api/shows` con p95 por debajo de 300 ms mientras todo eso corre. Ejecutarlo antes y después de la Fase 1 para comparar.

**5.5 Operación (S)**
- Copias de seguridad automáticas con `mysqldump` (trabajo diario, 7 copias) y botón "Descargar respaldo" en el panel de admin.
- Logs con `request_id`.
- **Panel de salud en admin:**
  - procesos FPM ocupados;
  - transcodificaciones activas (conectar `/api/admin/active-streams`, que ya existe pero no se usa);
  - conexiones SSE;
  - espacio en disco.
- **Repositorio:**
  - Arreglar `.gitignore`: `! .env.example` tiene un espacio, y `.superpowers/` está ignorado pero versionado.
  - Añadir una LICENCIA.

---

## Fase 6 — Funciones nuevas (Android primero)

Ordenadas por valor para tu caso (LAN, Android, más de 30 usuarios). Para cada una se indica qué existe ya y qué falta.

### App Android

| # | Función | Cómo se haría | Tamaño |
|---|---|---|---|
| A1 | **Actualizaciones automáticas desde el servidor** | Usa el `/api/app/android` de 0.10. La app consulta al abrir y una vez al día con WorkManager. Descarga el APK, comprueba el SHA-256 e instala con `PackageInstaller` (permiso `REQUEST_INSTALL_PACKAGES`). Con 30+ personas instalando a mano es lo que más soporte ahorra. | M |
| A2 | **Notificaciones de episodios nuevos** (sin Firebase) | WorkManager cada 15 min o más (solo con WiFi) consulta `GET /api/notifications` y muestra una notificación local. Pedir `POST_NOTIFICATIONS` en el momento oportuno; hoy está declarado pero nunca se pide. | S |
| A3 | **Descargas para ver sin conexión** | Media3 `DownloadManager` y `DownloadService`, que descargan el archivo directo de 1.3 por rangos. Pantalla "Descargas" con espacio usado. El progreso sin conexión va a la cola de 2.6. En el servidor: permiso por perfil (modo infantil), límite por usuario y, para códecs no compatibles, un trabajo que prepare un MP4. | L |
| A4 | **Gestión de perfiles en la app** | Crear, editar, borrar, PIN, avatar y modo infantil. Los endpoints ya existen y `KuraApiService` los declara sin usarlos. | M |
| A5 | **Watch Party completa** | Unirse por enlace (`kurastream://party/{code}` hoy se ignora) o por el QR de la web. Compartir el código con el menú de Android, lista de salas públicas, ajustes del anfitrión (control de invitados, `allow_guests`) y estado de la conexión. | M |
| A6 | **Comentarios por serie** | Leer y publicar con `GET/POST /api/comments` (ya existen). | S |
| A7 | **PiP mejorado** | Botones dentro del PiP (pausa, +10 s) y entrada automática en Android 8–11 con `onUserLeaveHint`. | S |
| A8 | **Widget "Seguir viendo" y accesos directos** | Widget con Jetpack Glance y accesos directos dinámicos a la última serie. | M |
| A9 | **Subtítulos ASS completos** (fuentes, karaoke) | **Hay que investigarlo:** el soporte ASS de Media3 es básico. Probar una librería basada en libass para Media3 (por ejemplo libass-android) usando `/api/episodes/{id}/fonts`. | L |
| A10 | **Chromecast** | **Hay que investigarlo:** Cast no reproduce MKV (necesita MP4/HLS desde el remux) y puede tener problemas con HTTP en la LAN. Hacer primero un prototipo. | L |
| A11 | **Android TV** (opcional, futuro) | Compose for TV, navegación con mando (D-pad) y lanzador Leanback. No lo marcaste como prioridad. | L |

### Web y servidor (sirven a ambas apps)

| # | Función | Cómo se haría | Tamaño |
|---|---|---|---|
| W1 | **Gestión de usuarios en el panel de admin** (importante con registro abierto) | Listar, desactivar o borrar, restablecer contraseña, cambiar rol y cerrar sesiones (con `token_version` de 0.2). | M |
| W2 | **Moderación de comentarios** | Borrar los propios y como admin, reportar, etiqueta de spoiler, paginación y largo máximo. | S |
| W3 | **Marcar como visto / no visto** (episodio o temporada) y **listas de estado** (viendo, pendiente, completado, abandonado) | Columnas nuevas en history/favorites, con botones en la web y en Android. | M |
| W4 | **Valoraciones y "Porque viste X"** | Puntuación de 1 a 5 por perfil. Recomendaciones con SQL a partir de géneros y de lo que ven otros perfiles. | M |
| W5 | **Editor de intro y ending en el panel de admin** | Los endpoints ya existen (`save-episode-timings`, `detect-timings`, `apply-timings`); hoy el editor es de solo lectura. | S |
| W6 | **Ajustes de sala después de crearla** | Usar `/api/party/settings` (ya existe) desde la web y Android. | S |
| W7 | **Control parental mejorado** | Clasificación máxima por perfil (G/PG/PG-13/R), en lugar de solo "infantil sí o no", y tiempo de pantalla diario para perfiles infantiles, controlado en el servidor. | M |
| W8 | **Miniaturas de la barra de progreso pregeneradas** | Un trabajo de la cola (1.5) genera, con ffmpeg `fps=1/10,scale=160:-1,tile`, hojas de imágenes con su índice JSON. Las usan la web (quita el segundo `<video>`) y Android. | M |
| W9 | **Ajustes de subtítulos** | Tamaño, color, borde y desfase en la web. El desfase ya existe en el backend (`shiftAssTimestamps`). | S |
| W10 | **Resumen anual del perfil** | A partir de `/api/user/stats`. Opcional y divertido. | S |
| W11 | **HLS para iPhone/Safari** (opcional, si algún día hace falta iOS) | Generar HLS en vivo o empaquetado al importar, con hls.js en otros navegadores. Arregla el problema de iOS de 4.6. | L |

**Descartado por el contexto LAN:** notificaciones Web Push y Firebase. Necesitan internet tanto en el servidor como en el servicio de push, y A2 cubre lo mismo sin depender de terceros.

---

## Orden sugerido (hitos)

1. **Hito 1** (semanas 1–2):
   - Fase 0 completa.
   - 5.1 y 5.2: CI que falle de verdad y base de datos de pruebas aislada.
2. **Hito 2** (semanas 3–5): Fase 1. Primero 1.0 (la red), luego 1.1, 1.2, 1.3, 1.7 y 1.8; después 1.4, 1.5 y 1.6. Validar con la prueba de carga 5.4.
3. **Hito 3** (semanas 5–7):
   - Fase 2 de Android, en este orden: 2.1, 2.2, 2.3, 2.4, 2.5, luego el resto.
   - Además, A1 (actualizaciones automáticas), para poder repartir los arreglos sin que cada persona reinstale a mano.
4. **Hito 4** (semanas 7–9): Fase 4 (web) y Fase 3 (datos).
5. **Hito 5 en adelante:**
   - Funciones nuevas: A2, A4, A5, A6, W1, W3, W5, W6; después A3, W8, W4, W7.
   - Al final, lo que requiere investigación (A9, A10, A11 y W11).

Cada tarea va en su propia rama y su propio PR pequeño, con sus pruebas; nada de mezclar fases en un solo commit.

---

## Verificación

- **Seguridad (Fase 0):**
  - Pruebas PHP nuevas (5.3) en verde con MySQL de pruebas: `DB_NAME=kurastream_test php tests/run_all_tests.php`.
  - Comprobaciones manuales con `curl`:
    - un token firmado con `change_me` → el servidor no arranca;
    - 6 PIN erróneos → 429;
    - `DELETE /api/shows/%2E` como admin → 400;
    - el ticket de una sala en `/api/profiles` → 401;
    - `POST /api/login` con `{"username":[]}` → 400 JSON sin traza.
- **Capacidad (Fase 1):**
  - k6 (`tests/load/k6_30_users.js`) antes y después.
  - Con 30 usuarios simulados: ninguna petición de API debe esperar más de 1 s.
  - `ps` debe mostrar 0 procesos ffmpeg para clientes Android reproduciendo MKV.
  - Prueba real con 5 o más móviles en el router nuevo.
- **Android (Fase 2):**
  - `./gradlew testDebugUnitTest lintRelease assembleRelease` en verde.
  - Pruebas manuales:
    - Watch Party de 40 minutos con adelantos y cambio de audio, sin errores 403;
    - un emulador sin PiP;
    - Android 8, 12, 14 y 17;
    - rotación en tablet sin perder el scroll;
    - cambiar el idioma de audio sin perder el salto de intro.
- **Web (Fase 4):**
  - `npm run build && npm run lint && npm run test:e2e`, también en WebKit.
  - Desplegar dos versiones seguidas y comprobar que no queda la página en blanco.
  - Con 4.8 hecho: la consola sin violaciones de CSP, y SubtitlesOctopus dice "WebAssembly support detected: yes".
- **CI:** forzar una prueba fallida en una rama y confirmar que el workflow se pone en rojo.

## Archivos críticos

- **Backend:**
  - `php_backend/config.php`, `router.php`, `db.php`
  - `middleware/AuthMiddleware.php`, `middleware/RateLimiter.php`
  - `controllers/{Auth,Player,Party,Show,Admin,AppDownload,History}Controller.php`
  - `services/{FfmpegScanner,LibraryScanner,MigrationManager}.php`
  - `migrations/013+`
- **Infraestructura:**
  - `Dockerfile`, `docker-compose.yml`, `scripts/debian_setup.sh`
  - nuevos: `deploy/nginx/*`, `deploy/php-fpm/*`, `deploy/systemd/*`, `php_backend/worker.php`
- **Web:**
  - `frontend/index.html`, `js/main.js`, `player.js`, `sw.js`, `manifest.json`
  - `js/core/{api,ui,auth}.js`, `js/modules/{party,player_scrub_preview}.js`
  - nuevos: `package.json` (esbuild), `scripts/build.mjs`
- **Android:**
  - `app/build.gradle.kts`, `gradle/libs.versions.toml`, `AndroidManifest.xml`, `res/xml/*`
  - `core/di/AppModule.kt`, `core/network/{WatchPartyClient,Interceptors,ServerUrlResolver}.kt`
  - `core/player/{StreamResolver,PlaybackConnectionManager}.kt`
  - `feature/player/{PlayerScreen,PlayerViewModel}.kt`, `feature/party/*`, `feature/settings/SettingsViewModel.kt`
  - `navigation/AppNavGraph.kt`, `MainActivity.kt`
- **CI y pruebas:**
  - `.github/workflows/{ci,security}.yml`, `tests/run_all_tests.php`, `playwright.config.js`
  - nuevos: `tests/load/`
