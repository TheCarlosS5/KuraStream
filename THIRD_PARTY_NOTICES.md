# Avisos de terceros

KuraStream incluye o usa los componentes de abajo. Esto no es la licencia de KuraStream (esa la decide su autor): son
las licencias de lo que viene de otros.

## Datos e imágenes

| Origen | Uso | Condición |
|---|---|---|
| **TMDB** (The Movie Database) | Sinopsis, pósters, fondos, reparto | Debe mostrarse este aviso: *"This product uses the TMDB API but is not endorsed or certified by TMDB."* (en español, en Ajustes > Créditos de la web y en Ajustes de la app Android). Hace falta una clave propia de TMDB (`TMDB_API_KEY`), de uso no comercial salvo acuerdo con TMDB. Si publicas el servicio, TMDB pide además mostrar su logotipo en los créditos. |
| **AniList** | Calendario de emisión, equivalencias | Uso según sus términos de la API; se cita como fuente en los créditos. |

## Código incluido en el repositorio (`frontend/vendor`, `frontend/assets`)

| Componente | Licencia | Dónde |
|---|---|---|
| **JavascriptSubtitlesOctopus** (renderizado ASS) | MIT (Expat) | `frontend/vendor/subtitles-octopus/` |
| ↳ libass | ISC | compilado dentro del `.wasm` |
| ↳ FreeType | FreeType License (FTL) | ídem |
| ↳ HarfBuzz, Expat, Brotli | MIT / Expat | ídem |
| ↳ **FriBidi** | **LGPL-2.1 o posterior** | ídem. Está enlazado dentro del `.wasm`: el código fuente de esta versión es público (fribidi/fribidi) y el módulo se puede sustituir por otra compilación. Si redistribuyes KuraStream, conserva este aviso. |
| ↳ Zlib, BSL-1.0 | Zlib / Boost | ídem |
| **DejaVu Sans** (`default.ttf`, fuente de reserva de los subtítulos) | Bitstream Vera + dominio público | `frontend/vendor/subtitles-octopus/default.ttf` |
| **Lucide** (iconos) | ISC | `frontend/vendor/lucide/` y el paquete npm `lucide` |
| **Inter** | SIL Open Font License 1.1 | `frontend/assets/fonts/inter-*.woff2` |
| **Outfit** | SIL Open Font License 1.1 | `frontend/assets/fonts/outfit-*.woff2` |

## Dependencias de desarrollo (npm)

`esbuild` (MIT), `eslint` (MIT), `prettier` (MIT), `@playwright/test` (Apache-2.0), `globals` (MIT). No se distribuyen.

## App Android

Apache License 2.0: AndroidX (Core, Lifecycle, Activity, Compose, Navigation, Room, DataStore, WorkManager, Media3),
Kotlin y kotlinx (coroutines, serialization), OkHttp, Retrofit, Dagger/Hilt, Coil, Material Icons.
`retrofit2-kotlinx-serialization-converter` (Apache-2.0). Las dependencias se revisan contra la base de datos de
vulnerabilidades OSV en cada ejecución del CI (`scripts/check_vulnerable_deps.mjs`).

## Backend

PHP sin dependencias de Composer. Usa `ffmpeg` / `ffprobe` como programas externos (LGPL o GPL según la compilación
instalada; no se redistribuyen con KuraStream) y `mysqldump` para los respaldos.
