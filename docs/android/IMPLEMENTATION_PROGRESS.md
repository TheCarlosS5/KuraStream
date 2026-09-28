# KuraStream Native Android Implementation Progress

Registro completo del desarrollo, auditoría, implementación y verificación del cliente nativo Android de **KuraStream**.

---

## 1. Fases del Proyecto

- [x] **Fase 0: Auditoría exhaustiva del repositorio**
  - Análisis del backend PHP 8.4, esquema MySQL, serializadores y router.
  - Estudio de `tokens.css` y la identidad visual Nocturnal Indigo / Mint.
  - Identificación de los contratos de streaming HTTP Range 206 y remux FFmpeg.
- [x] **Fase 1: Contratos API y Arquitectura**
  - Creación de [`docs/android/API_CONTRACT.md`](file:///C:/Users/Calos/Desktop/KuraStream/docs/android/API_CONTRACT.md) documentando los 30+ endpoints y eventos SSE.
  - Creación de [`docs/android/ARCHITECTURE.md`](file:///C:/Users/Calos/Desktop/KuraStream/docs/android/ARCHITECTURE.md).
- [x] **Fase 2: Estructura del Proyecto, Gradle y Design System**
  - Creación de `android/gradle/libs.versions.toml` con versiones estables de AndroidX, Media3, Compose, Retrofit, Room y Hilt.
  - Configuración de `minSdk 26`, `compileSdk 37` y `targetSdk 37` (Android 17).
  - Implementación del sistema de diseño KuraTheme, colores, tipografía y dimensiones (rejilla de 4dp, radios 8/12/14/16dp).
- [x] **Fase 3: Conexión Multiserver, Autenticación y Perfiles**
  - Implementación de `ServerUrlResolver` con soporte para LAN, dominios y detección de IP privada.
  - Pantalla de conexión con validación contra `/api/health`.
  - Flujo de Login y Registro nativo sin campos inventados.
  - Selector de perfiles con diálogo de PIN y protección de perfiles infantiles (Kids).
  - Persistencia segura con `SecureTokenStorage` (Android Keystore AES-256-GCM) y reemplazo atómico de JWT.
- [x] **Fase 4: Catálogo, Explorar, Búsqueda y Detalle**
  - Pantalla de Inicio con Billboard Hero dinámico y rieles temáticos.
  - Búsqueda con debounce, filtros y calendario de emisiones.
  - Detalle de show con metadatos completos, selector de temporadas, episodios y botón de acción principal ("Continuar" / "Ver Ep 1").
- [x] **Fase 5: Mi Lista, Historial, Calendario, Notificaciones y Ajustes**
  - "Mi Lista" con sincronización optimista y rollback ante error.
  - Historial con reanudación precisa y borrado seguro.
  - Notificaciones en la app con badge de no leídas y navegación a contenido.
  - Ajustes de reproducción, servidor activo y diagnóstico sanitizado del sistema.
- [x] **Fase 6 & 7: Reproductor Media3 y Pipeline de Streaming**
  - Integración de Media3 ExoPlayer desacoplado con controles Compose (`useController = false`).
  - `StreamResolver` con discriminación entre Direct Play (HTTP Range) y Remux FFmpeg.
  - Modelo de tiempo absoluto (`streamStartOffsetSeconds`) para mantener consistencia de progreso y UI.
  - Cambio de pistas de audio preservando la posición y estado de reproducción.
  - Soporte de subtítulos SSA/ASS con side-loading nativo en Media3.
- [x] **Fase 8: Gestos, Skip Intro/Outro, MediaSession y Picture-in-Picture**
  - Gestos táctiles: doble toque seek (+/-10s), long press 2.0x speed, brillo (izquierda), volumen (derecha), control lock.
  - Botones de Skip Intro y Skip Outro basados en timestamps reales del backend.
  - Cuenta regresiva automática para el siguiente episodio con soporte para cambios de temporada (S1E12 -> S2E1).
  - `KuraPlaybackService` para controles nativos de lockscreen y audio focus.
  - Soporte para Picture-in-Picture (PiP).
- [x] **Fase 9: Watch Party Nativa**
  - Cliente SSE (`WatchPartyClient`) con reconexión automática y fallback a polling.
  - `WatchPartySyncController` para corrección de drift temporal y sincronización con el anfitrión.
  - Chat en vivo y reacciones dentro de la sala.
- [x] **Fase 10: Interfaz Adaptativa y Rendimiento**
  - Soporte para teléfonos y tabletas con redimensionamiento de columnas.
  - Optimización de bitmaps en Coil y claves estables en listas perezosas.
- [x] **Fase 11: Pruebas y Verificación Integral**
  - Pruebas unitarias en Android (`./gradlew testDebugUnitTest`): 100% pasando.
  - Análisis estático (`./gradlew lintDebug`): 100% pasando.
  - Verificación de contratos y arquitectura (`scripts/test_android_contracts.mjs`): 100% pasando.
  - Suite de regresión del backend PHP (`npm test`): 41/41 pasando.
  - CI de GitHub Actions configurado para ramas `feat/*` con jobs de validación unitaria, lint y APK de Android.
- [x] **Fase 12: Generación de APK y Documentación Final**
  - Compilación exitosa de APK Debug: `android/app/build/outputs/apk/debug/app-debug.apk`.
  - Documentación técnica exhaustiva (`README.md`, `ARCHITECTURE.md`, `API_CONTRACT.md`, `PLAYER_ARCHITECTURE.md`, `SECURITY.md`, `TEST_MATRIX.md`).

---

## 2. Auditoría y Correcciones de la Revisión Bloqueante (feat/native-android-client)

- [x] **Watch Party conectado al ciclo de ExoPlayer:** Sincronización en tiempo real vía `PartyRealtimeEvent.Sync` procesado por `WatchPartySyncController` en `PlayerViewModel` y actualización de estado en `WatchPartyViewModel`, emisión automática de acciones del host (`play`, `pause`, `seek`, `change_episode`) mediante `WatchPartyRepository.syncPlayback`.
- [x] **Inyección de Ticket de Capacidad de Streaming:** `PartyPlaybackContext` almacena de forma segura en memoria el ticket de reproducción sin exponerlo en URLs de navegación, e inyecta `X-Stream-Capability` en el DataSource OkHttp de Media3 a partir del contexto activo.
- [x] **Encabezados de Salida de Watch Party:** Envío de `X-Party-Member-Id` y `X-Party-Member-Token` en `leavePartyRoom` para validar la sesión del huésped sin error 401.
- [x] **Creación Contextual de Watch Party:** Botón y diálogo nativo en `PlayerScreen` para crear sala directamente desde el episodio activo; eliminación del campo inútil de passcode en `WatchPartyScreen` y `WatchPartyViewModel`, y guía de creación en `WatchPartyScreen`.
- [x] **Aislamiento de Caché Multiusuario en Room:** Clave primaria compuesta `(serverId, username, profileId, id)` en `CachedShowEntity` para evitar filtración de contenidos adultos en perfiles infantiles y aislar datos entre diferentes usuarios.
- [x] **Preservación de Estado del Reproductor en Rebuild de MediaItem:** Conservación de `wasPlaying`, `playbackSpeed` y `positionSeconds` al alternar pistas de audio o subtítulos.
- [x] **Resolución de Parámetro de Pistas de Audio:** Traducción de índice UI a identificador de backend (`trackNumber` > 0 -> `trackNumber`, o `index`) en `StreamResolver.resolveAudioTrackBackendParam`.
- [x] **Reintento Controlado ante Error 503:** Manejo de servidor ocupado con lectura del encabezado `Retry-After` (fallback 5s) y un único reintento controlado cancelable en `onCleared()`.
- [x] **Validación de Origen JWT Estricta:** Comparación de esquema, host y puerto en `hasSameOrigin` para evitar compartir tokens entre diferentes instancias locales.
- [x] **Manejo Seguro de Redirecciones:** `SafeOriginInterceptor` con `followRedirects(false)` y verificación de origen cruzado antes de seguir redirecciones 3xx.
- [x] **Auto-Descubrimiento LAN de Servidores:** Escaneo asíncrono de subred local en puertos 3000, 8080 y 80 con feedback en `ServerSetupScreen` y verificación estricta de permisos LAN también en servidores recientes.
- [x] **Mapeo de Deep Links:** Manejo de `onNewIntent` en `MainActivity` y ruta `kurastream://server?url=...`.
- [x] **Ajustes de Usuario:** Selección interactiva de idioma preferido de audio y subtítulos, y segundos de salto por doble toque dinámicos en el reproductor.
- [x] **Eliminación de Items Fantasma en Historial:** Transacción atómica `replaceHistory` (clear + insert).
- [x] **Localización:** Actualizado string a "Lanzamientos recientes".
- [x] **Evaluación Media3:** Verificada la versión `1.5.1` como la última versión estable oficial de `androidx.media3` (versión 1.11.1 no existe en los repositorios de Google).
- [x] **Pipeline CI en GitHub Actions:** Agregado trigger `feat/*` y job `android` para `testDebugUnitTest`, `lintDebug` y `assembleDebug`.

---

## 3. Verificación de Definition of Done

- [x] Proyecto Android NATIVO en Kotlin + Jetpack Compose.
- [x] `minSdk 26`, `compileSdk 37`, `targetSdk 37` (Android 17).
- [x] Build debug compila (`./gradlew assembleDebug` EXIT 0).
- [x] Servidor configurable (LAN, dominios, IPs) con escáner automático.
- [x] Hotspot/LAN sin internet soportado sin bloqueos.
- [x] Permiso `ACCESS_LOCAL_NETWORK` de Android 17 manejado contextualmente.
- [x] HTTP local con advertencia de red y HTTPS seguro sin bypasses.
- [x] Login y Registro reales.
- [x] Perfiles con PIN y protección Kids aislados.
- [x] Inicio, Búsqueda, Detalle, Episodios, Mi Lista e Historial con datos reales.
- [x] Reproductor Media3 ExoPlayer desacoplado con controles Compose.
- [x] HTTP Range y Remux con offset de tiempo absoluto.
- [x] Pistas de audio dinámicas y subtítulos SSA/ASS nativos.
- [x] Skip intro/outro y siguiente episodio (S1E12 -> S2E1).
- [x] Gestos de brillo, volumen, seek y bloqueo de controles.
- [x] Picture-in-Picture (PiP) y MediaSessionService con lockscreen controls.
- [x] Watch Party con cliente SSE, chat en vivo, sincronización de drift y control de host en ExoPlayer.
- [x] Aislamiento de caché por `(serverId, profileId, id)`.
- [x] Sin tokens en logs ni secretos en el repositorio.
- [x] Cero WebViews, cero mocks en runtime y cero botones muertos.
- [x] Suite de pruebas unitarias y de backend pasando al 100%.
