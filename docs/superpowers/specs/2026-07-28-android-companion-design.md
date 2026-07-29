# Especificación de Diseño: KuraStream Android Companion App

Esta especificación detalla la arquitectura, interfaz de usuario y flujos de integración para la aplicación móvil nativa de KuraStream en Android.

---

## 1. Arquitectura del Proyecto

La aplicación se construirá bajo la arquitectura recomendada por Google en capas (Clean Architecture / MVVM) utilizando **Kotlin** y **Jetpack Compose**.

### Estructura de Directorios (`/android`)
* `/android/app/build.gradle.kts`: Declaración de dependencias (Jetpack Compose, Media3 ExoPlayer, Retrofit, OkHttp).
* `/android/app/src/main/java/com/kurastream/app`:
  * `data/`: Modelos de datos, clientes de red y persistencia local (`SharedPreferences`).
  * `player/`: Lógica de integración de Media3 ExoPlayer.
  * `ui/theme/`: Configuración estética de KuraStream (Chameleon Colors, tipografías Outfit/Inter).
  * `ui/screens/`:
    * `ConnectionScreen.kt`: Ingreso manual de dirección IP/Puerto.
    * `CatalogScreen.kt`: Dashboard con lista de shows clasificados por categorías.
    * `DetailsScreen.kt`: Sinopsis de shows, trailers y selector de temporadas/episodios.
    * `PlayerScreen.kt`: Reproductor táctil a pantalla completa.

---

## 2. UI del Reproductor Personalizado (Aesthetic Web-Matching)

Para evitar la estética genérica del reproductor de Android, el `PlayerView` de Media3 se configurará con `useController = false` y dibujaremos los controles íntegramente con Compose:

### Capas de Interfaz (Z-Index)
1. **Base**: Canvas de video de ExoPlayer (`AndroidView`).
2. **Capa Intermedia (Sakura Canvas)**: Un canvas animado que dibuja pétalos cayendo lentamente por la pantalla cuando la reproducción está en estado **Pausado**.
3. **Capa Superior (Controles)**:
   * **Barra de Progreso**: Control deslizable táctil en color rojo acento con indicador de tiempo actual y total.
   * **Selector de Pistas**: Botones flotantes difuminados (Glassmorphism) para abrir paneles emergentes donde se listarán las pistas de audio y subtítulos incrustadas en el archivo multimedia, permitiendo cambiarlas al vuelo en ExoPlayer.

---

## 3. Efecto Sakura en Pausa (Kotlin & Jetpack Compose Canvas)

Replicaremos el efecto visual de pétalos de cerezo cayendo:
* **Estado de Animación**: Cuando el estado del reproductor cambia a `PAUSED`, se inicializa una corrutina que corre un ciclo de renderizado continuo (`withFrameMillis`).
* **Modelo del Pétalo**: Cada pétalo tendrá atributos dinámicos: coordenadas $(x, y)$, velocidad de caída, velocidad de deriva del viento, rotación y tamaño.
* **Dibujado**: Usamos la función `Canvas` de Compose y el método `drawPath` para modelar la forma orgánica de los pétalos de cerezo con el color rosa característico de KuraStream (`#FFB7C5`).
* **Fade out**: Al reanudar la reproducción (`PLAYING`), la opacidad de los pétalos disminuye gradualmente hasta desaparecer y se detiene el bucle para ahorrar batería.

---

## 4. Integración y Sincronización

* **OkHttp Interceptor**: Adjunta de manera segura el token JWT en las cabeceras `Authorization: Bearer <JWT>` de todas las peticiones a la API del servidor.
* **Guardado de Progreso**: Escucha los eventos periódicos del reproductor y realiza peticiones POST a `/api/progress` cada 10 segundos para mantener el historial del usuario sincronizado en tiempo real.
