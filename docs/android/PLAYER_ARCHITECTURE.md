# KuraStream Android Player Architecture & Media Pipeline

Este documento describe la arquitectura y los contratos del subsistema multimedia implementado en el cliente nativo de **KuraStream**, utilizando **AndroidX Media3 ExoPlayer 1.5.1** y **Jetpack Compose**.

---

## 1. Motor de Reproducción y Capas de UI

A diferencia de clientes básicos que incrustan el `PlayerView` estándar con sus controles predeterminados, KuraStream separa completamente el renderizado de video de la interfaz de usuario:

```
+--------------------------------------------------------------+
| CAPA 3: Interfaz Compose (KuraPlayerControls)                |
| - Top bar: Show, Txx Exx, Título, PiP, Watch Party badge      |
| - Centro: Rewind (-10s), Play/Pause, Fast-Forward (+10s)     |
| - Abajo: Timeline, Scrubbing preview, Tiempo actual/total,    |
|   Selectores de Audio/Subtítulo, Velocidad, Control Lock     |
| - Overlays contextuales: Skip Intro, Skip Outro, Next Ep     |
+--------------------------------------------------------------+
| CAPA 2: Vignette / Ambient Dark Overlay (Fade in/out)        |
+--------------------------------------------------------------+
| CAPA 1: AndroidView -> SurfaceView / PlayerView              |
|         (useController = false, resizeMode dinámico)          |
+--------------------------------------------------------------+
```

---

## 2. Resolución de Stream: Direct Play vs. Remux con Offset Absoluto

El backend KuraStream combina tres estrategias de entrega de video; `StreamResolver` elige una en este orden:

1. **Direct Play crudo (`?direct=1`, HTTP Range 206)**: el móvil consulta `MediaCodecList` (`DeviceVideoDecoders`) y, si decodifica el códec y la profundidad de bits del episodio (H.264, HEVC, VP9, AV1; también 10 bits si el decodificador lo soporta) y sus pistas de audio (AAC, AC3, EAC3, Opus, FLAC…), pide el archivo tal cual, MKV incluido. FFmpeg no interviene: los saltos son instantáneos y las pistas de audio se cambian en el reproductor con `TrackSelectionOverride`, sin recargar. Solo se muestra el subtítulo sideload (`/api/subtitles`, id `kura-sideloaded-subtitle`); los subtítulos propios del contenedor se desactivan para no duplicarlos.
2. **Direct Play clásico (HTTP Range 206)**: archivos MP4/WebM en H.264 de 8 bits con pista de audio por defecto, cuando el móvil no puede usar el modo crudo.
3. **Remux / Transcode Dinámico**: sin decodificador compatible (p. ej. H.264 Hi10P o HEVC en un móvil sin hardware), audio DTS/TrueHD, downmix estéreo o tras un fallo de decodificador (`forceH264`). FFmpeg inicia la salida desde el segundo solicitado (`?start=X&audio=Y`), entregando un stream cuyo tiempo interno parte de `00:00`.

### El Modelo de Tiempo Absoluto

Para garantizar que los marcadores de capítulos, los botones de skip intro/outro, la barra de progreso, la persistencia en el backend y la Watch Party mantengan coherencia, `StreamResolver` implementa la siguiente fórmula de tiempo absoluto:

$$\text{absolutePositionSeconds} = \text{streamStartOffsetSeconds} + \frac{\text{exoPlayer.currentPosition}}{1000}$$

#### Ejemplo:
- Si un usuario reanuda un archivo MKV en el minuto **20:00** (`1200s`):
  - URL solicitada: `/api/stream/{id}?start=1200&audio=1`
  - `streamStartOffsetSeconds` = `1200f`
  - Cuando ExoPlayer reproduce `30s` locales, `currentPosition` es `30000ms`.
  - $\text{absolutePositionSeconds} = 1200 + 30 = 1230\text{ s}$ (**20:30**).
  - La interfaz muestra **20:30 / 24:00**, no **00:30**.

---

## 3. Cambio de Pistas de Audio en Caliente

Cuando el usuario selecciona una pista de audio alternativa:
1. Se captura la posición absoluta actual: $P_{\text{abs}} = \text{calculateAbsolutePosition}()$.
2. Se consulta la metadata de pistas (`audioTracks`).
3. Si la nueva pista requiere remux del servidor:
   - Se reconstruye la URL: `/api/stream/{id}?start=P_abs&audio=newTrackIndex`.
   - Se preserva el estado de reproducción (`playWhenReady`) y la velocidad seleccionada.
   - Se reanuda en el tiempo exacto sin desincronizaciones en el historial de progreso.

---

## 4. Subtítulos SSA/ASS Nativos

KuraStream utiliza el endpoint `/api/subtitles/{episodeId}/{trackIndex}` para side-load de subtítulos en Media3:
- **MIME Type**: `MimeTypes.TEXT_SSA` (SubStation Alpha / Advanced SubStation Alpha).
- Soporte nativo para estilos de texto, negrita, cursiva, colores y posicionamiento en pantalla mediante el renderizador SSA de Media3.
- Selección dinámica y opción de desactivar subtítulos (`selectedSubtitleTrackIndex = -1`).

---

## 5. Control de Gestos Táctiles

El área del reproductor implementa un controlador de puntero Compose no bloqueante (`pointerInput`):
- **Doble Toque Izquierda**: Salto de `-10` segundos.
- **Doble Toque Derecha**: Salto de `+10` segundos.
- **Pulsación Larga (Hold)**: Aceleración instantánea a `2.0x` (modo "Fast Scan") que regresa a la velocidad original al levantar el dedo.
- **Arrastre Vertical Izquierdo**: Regulación fina de brillo de pantalla (`Activity.window.attributes.screenBrightness`).
- **Arrastre Vertical Derecho**: Regulación de volumen del canal multimedia (`AudioManager.STREAM_MUSIC`).
- **Bloqueo de Pantalla (Control Lock)**: Deshabilita los gestos táctiles accidentales y muestra un botón discreto de desbloqueo.

---

## 6. Integración con el Sistema Operativo y MediaSession Unificada

- **Arquitectura de Servicio Único (`KuraPlaybackService`)**:
  - Un único servicio persistente `KuraPlaybackService` (`MediaSessionService`) aloja la instancia central de `ExoPlayer`.
  - Se eliminan duplicaciones de `ExoPlayer` entre `PlayerViewModel` y el servicio; la UI se comunica de manera asíncrona a través de `PlaybackConnectionManager` que enlaza un `MediaController`.
  - Declarado en el AndroidManifest con `foregroundServiceType="mediaPlayback"` y permisos `FOREGROUND_SERVICE` y `FOREGROUND_SERVICE_MEDIA_PLAYBACK`.

- **Media OkHttp DataSource y Autenticación de Stream**:
  - `DefaultMediaSourceFactory` está configurado con `OkHttpDataSource.Factory(mediaOkHttpClient)`.
  - `MediaAuthInterceptor` adjunta automáticamente:
    - Cabecera estándar `Authorization: Bearer <token>` en todas las peticiones.
    - Cabecera `X-Stream-Capability: <capability_token>` además, cuando la reproducción proviene de una sala de Watch Party y solo para el episodio de esa sala. El ticket dura 15 minutos y `WatchPartyRepository` lo renueva cada 8 (`/api/party/refresh-ticket`); si caduca, el servidor recurre a la sesión.
  - No expone tokens ni capabilities en URLs ni query parameters.

- **Notificación y Lockscreen**:
  - Muestra el poster del show, título del episodio y controles nativos de Play/Pause y Seek sincronizados con MediaSession.

- **Audio Becoming Noisy**:
  - Pausa automáticamente la reproducción cuando se desconectan los auriculares por cable o Bluetooth.

- **Audio Focus**:
  - Gestiona llamadas entrantes y solicitudes de audio de otras aplicaciones respetando las prioridades de audio de Android.

- **Picture-in-Picture (PiP)**:
  - Activación manual o contextual al minimizar la aplicación mediante `enterPictureInPictureMode(params)` en dispositivos Android 8.0+ (API 26+).
