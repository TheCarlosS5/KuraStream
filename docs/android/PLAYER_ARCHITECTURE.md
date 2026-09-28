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

El backend KuraStream combina dos estrategias de entrega de video:
1. **Direct Play (HTTP Range 206)**: Para archivos MP4/WebM codificados en H.264 con pista de audio por defecto.
2. **Remux / Transcode Dinámico**: Para contenedores MKV, selección de pistas de audio secundarias, o forzado de H.264/downmix estéreo. En estos casos, FFmpeg inicia la salida desde el segundo solicitado (`?start=X&audio=Y`), entregando un stream cuyo tiempo interno parte de `00:00`.

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

## 6. Integración con el Sistema Operativo

- **MediaSession y `KuraPlaybackService`**: Servicio foreground declarado con `foregroundServiceType="mediaPlayback"`.
- **Notificación y Lockscreen**: Muestra el poster del show, título del episodio y controles nativos de Play/Pause y Seek.
- **Audio Becoming Noisy**: Pausa automáticamente la reproducción cuando se desconectan los auriculares por cable o Bluetooth.
- **Audio Focus**: Gestiona llamadas entrantes y solicitudes de audio de otras aplicaciones respetando las prioridades de Android.
- **Picture-in-Picture (PiP)**: Activación manual o al salir de la aplicación mediante `enterPictureInPictureMode(params)`.
