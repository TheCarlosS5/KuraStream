# KuraStream Android Native Client — API Contract & Architecture Specification

Este documento define de forma exhaustiva los contratos HTTP/REST, SSE y Streaming entre el cliente nativo Android de KuraStream y el backend oficial PHP 8.4 + MySQL.

---

## 1. Reglas Generales de Comunicación

- **Base URL Dinámica:** La aplicación soporta múltiples servidores self-hosted (`https://server.domain`, `http://192.168.1.50:3000`, etc.). Toda petición se realiza relativa a la URL normalizada activa.
- **Autenticación:** Cabecera estándar HTTP `Authorization: Bearer <token>`.
- **Aislamiento de Perfiles:** Al seleccionar un perfil, el servidor emite un JWT que incluye `profile_id`, `profile_name` y `is_kids`. Este token sustituye atómicamente al anterior en el almacenamiento seguro Android Keystore.
- **Modo Infantil (`is_kids`):** El backend filtra de forma autoritativa todo show con `is_adult=1`, ratings como `R`, `TV-MA`, `18+`, `NC-17`, `RX`, `R18`, o géneros `ecchi`, `hentai`, `erotica`. Si un endpoint restringido es invocado bajo este perfil, devuelve HTTP 403 `{"error": "Contenido restringido por el perfil infantil activo"}`.

---

## 2. Matriz de Endpoints

### 2.1 Servidor & Salud

#### `GET /api/health`
- **Auth requerida:** No
- **Perfil requerido:** No
- **Uso Android:** Ping de conectividad al añadir servidor o reconectar. Verifica conectividad antes de intentar login.
- **Request:** Ninguno
- **Response (200 OK):**
```json
{
  "success": true,
  "status": "healthy",
  "database": "connected",
  "storage": "readable",
  "php_version": "8.4.25",
  "timestamp": "2026-09-28T04:30:00+00:00"
}
```
- **Errores:**
  - `503 Service Unavailable`: Base de datos desconectada o almacenamiento inaccesible.
- **DTO:** `ServerHealthDto`

---

### 2.2 Autenticación

#### `POST /api/login`
- **Auth requerida:** No
- **Perfil requerido:** No
- **Uso Android:** Inicio de sesión con usuario y contraseña.
- **Request Body:**
```json
{
  "username": "calos",
  "password": "secretpassword"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "token": "eyJhbGciOi...",
  "role": "user",
  "username": "calos",
  "user": {
    "username": "calos",
    "role": "user"
  }
}
```
- **Errores:**
  - `400 Bad Request`: `{"error": "Usuario y contraseña requeridos"}`
  - `401 Unauthorized`: `{"error": "Credenciales incorrectas"}`
  - `429 Too Many Requests`: Rate limiter excedido (10 intentos / 300s).
- **DTOs:** `LoginRequestDto`, `AuthResponseDto`

#### `POST /api/register`
- **Auth requerida:** No
- **Perfil requerido:** No
- **Uso Android:** Registro de nueva cuenta de usuario.
- **Request Body:**
```json
{
  "username": "newuser",
  "password": "securepassword123"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "token": "eyJhbGciOi...",
  "role": "user",
  "username": "newuser",
  "user": {
    "username": "newuser",
    "role": "user"
  }
}
```
- **Errores:**
  - `400 Bad Request`: Usuario (3-64 caracteres) o contraseña (8-128 caracteres) inválidos.
  - `409 Conflict`: `{"error": "El nombre de usuario ya está registrado"}`
  - `429 Too Many Requests`: Rate limit de auth.
- **DTOs:** `RegisterRequestDto`, `AuthResponseDto`

#### `POST /api/logout`
- **Auth requerida:** Sí (Bearer o Cookie)
- **Perfil requerido:** No
- **Uso Android:** Notificar al servidor el cierre de sesión, seguido de limpieza local en Android Keystore, DataStore, Room y cancelación de Playback / Watch Party.
- **Response (200 OK):**
```json
{
  "success": true,
  "message": "Sesión cerrada"
}
```
- **DTO:** `BaseResponseDto`

---

### 2.3 Perfiles de Usuario

#### `GET /api/profiles`
- **Auth requerida:** Sí
- **Perfil requerido:** No
- **Uso Android:** Carga la lista de perfiles del usuario para la pantalla de selección o gestión.
- **Response (200 OK):**
```json
{
  "success": true,
  "profiles": [
    {
      "id": "prof_123abc",
      "username": "calos",
      "name": "Principal",
      "profile_name": "Principal",
      "color": "#818CF8",
      "avatar_color": "#818CF8",
      "is_kids": false,
      "has_pin": false
    },
    {
      "id": "prof_456def",
      "username": "calos",
      "name": "Niños",
      "profile_name": "Niños",
      "color": "#5ED8C6",
      "avatar_color": "#5ED8C6",
      "is_kids": true,
      "has_pin": true
    }
  ]
}
```
- **DTO:** `ProfilesResponseDto`, `ProfileDto`

#### `POST /api/profiles/select`
- **Auth requerida:** Sí
- **Perfil requerido:** No
- **Uso Android:** Seleccionar perfil activo. Si `has_pin` es `true`, debe incluirse `pin`. El nuevo token retornado contiene el contexto de perfil y sustituye al token anterior en Keystore.
- **Request Body:**
```json
{
  "profile_id": "prof_456def",
  "pin": "1234"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "token": "eyJhbGciOi...",
  "profile": {
    "id": "prof_456def",
    "username": "calos",
    "name": "Niños",
    "profile_name": "Niños",
    "color": "#5ED8C6",
    "avatar_color": "#5ED8C6",
    "is_kids": true,
    "has_pin": true
  }
}
```
- **Errores:**
  - `400 Bad Request`: Falta `profile_id` o `profile_name`.
  - `403 Forbidden`: `{"error": "PIN incorrecto"}`
  - `404 Not Found`: Perfil no encontrado o no pertenece al usuario.
- **DTOs:** `SelectProfileRequestDto`, `SelectProfileResponseDto`

#### `POST /api/profiles`
- **Auth requerida:** Sí
- **Perfil requerido:** No
- **Uso Android:** Crear o actualizar perfil.
- **Request Body:**
```json
{
  "id": "prof_optional_for_update",
  "name": "Hermano",
  "color": "#818CF8",
  "is_kids": false,
  "pin": "1234"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "profile": { ... }
}
```
- **DTOs:** `SaveProfileRequestDto`, `SaveProfileResponseDto`

#### `DELETE /api/profiles/{id}` o `POST /api/profiles/delete`
- **Auth requerida:** Sí
- **Perfil requerido:** No
- **Uso Android:** Eliminar un perfil secundario.
- **Response (200 OK):** `{"success": true}`
- **DTO:** `BaseResponseDto`

---

### 2.4 Catálogo & Shows

#### `GET /api/shows`
- **Auth requerida:** Opcional (filtra por perfil infantil si hay token activo)
- **Perfil requerido:** Opcional
- **Query Params:**
  - `type`: `all` | `anime` | `movie` (default `all`)
  - `status`: `all` | `airing` | `finished` | `upcoming`
  - `sort`: `default` | `year_desc` | `year_asc` | `rating_desc` | `title_asc`
- **Uso Android:** Pantalla de Inicio (carruseles) y Explorar (catálogo con filtros).
- **Response (200 OK):** Array de shows:
```json
[
  {
    "id": "frieren",
    "title": "Sousou no Frieren",
    "synopsis": "La maga elfa Frieren emprende un viaje...",
    "rating": 9.2,
    "year": 2023,
    "studio": "Madhouse",
    "director": "Keiichiro Saito",
    "writer": "Tomohiro Suzuki",
    "cast_members": "[\"Atsumi Tanezaki\", \"Nobuhiko Okamoto\"]",
    "poster_path": "/library/anime/frieren/poster.webp",
    "backdrop_path": "/library/anime/frieren/backdrop.webp",
    "media_type": "anime",
    "genres": "Aventura, Drama, Fantasía",
    "trailer_key": "qgQunxD0qLk",
    "age_rating": "PG-13",
    "status": "finished",
    "tmdb_id": 209867
  }
]
```
- **DTO:** `ShowDto` (en `List<ShowDto>`)

#### `GET /api/shows/random`
- **Auth requerida:** Opcional
- **Uso Android:** Función "Sorpréndeme" / Descubrimiento aleatorio.
- **Response (200 OK):** Objeto `ShowDto` individual.

#### `GET /api/shows/{id}`
- **Auth requerida:** Opcional (aplica filtro infantil si hay sesión)
- **Uso Android:** Pantalla de Detalle de Serie/Película. Retorna metadata completa, lista de episodios y temporadas agrupadas.
- **Response (200 OK):**
```json
{
  "id": "frieren",
  "title": "Sousou no Frieren",
  "synopsis": "...",
  "rating": 9.2,
  "year": 2023,
  "studio": "Madhouse",
  "genres": "Aventura, Drama, Fantasía",
  "poster_path": "...",
  "backdrop_path": "...",
  "episodes": [
    {
      "id": "frieren_s01e01",
      "show_id": "frieren",
      "season_number": 1,
      "episode_number": 1,
      "title": "El fin de la aventura",
      "synopsis": "...",
      "duration": 1472.0,
      "size": 650000000,
      "video_codec": "h264",
      "audio_codec": "aac",
      "resolution": "1920x1080",
      "fps": 24.0,
      "audio_tracks": [
        {
          "index": 1,
          "track_number": 0,
          "title": "Japanese",
          "language": "jpn",
          "codec": "aac",
          "channels": 2
        }
      ],
      "subtitle_tracks": [
        {
          "index": 2,
          "track_number": 0,
          "title": "Español Latino",
          "language": "spa",
          "format": "ass",
          "is_default": true,
          "is_forced": false,
          "is_bitmap": false
        }
      ],
      "thumbnail_path": "/library/anime/frieren/ep1_thumb.webp",
      "intro_start": 65.0,
      "intro_end": 155.0,
      "outro_start": 1380.0,
      "chapters": [],
      "stream_url": "/api/stream/frieren_s01e01",
      "direct_playable": true,
      "container": "mp4"
    }
  ],
  "seasons": {
    "1": [ ... ]
  }
}
```
- **Errores:**
  - `404 Not Found`: Show no encontrado.
  - `403 Forbidden`: Show restringido para el perfil infantil activo.
- **DTO:** `ShowDetailDto`, `EpisodeDto`, `AudioTrackDto`, `SubtitleTrackDto`, `ChapterDto`

---

### 2.5 Episodios & Metadata de Reproducción

#### `GET /api/episodes/{id}`
- **Auth requerida:** Opcional / Contextual
- **Uso Android:** Obtener metadata técnica actualizada de un episodio antes de inicializar Media3.
- **Response (200 OK):** `EpisodeDto`
- **Errores:** `404 Not Found`, `403 Forbidden` (kids).

#### `GET /api/episodes/{id}/fonts`
- **Uso Android:** Lista de fuentes incrustadas para renderizado ASS.
- **Response (200 OK):**
```json
{
  "fonts": ["TrebuchetMS.ttf", "Arial-Bold.ttf"]
}
```

#### `GET /api/episodes/{id}/fonts/{font}`
- **Uso Android:** Descarga de binario de fuente tipográfica para libass / renderizador de subtítulos.

---

### 2.6 Streaming & Subtítulos

#### `GET /api/stream/{episodeId}`
- **Auth requerida:** Sí (`Authorization: Bearer <token>` o `X-Stream-Capability: <ticket>` para Watch Party)
- **Perfil requerido:** Sí (salvo rol `admin` en preview o Watch Party con ticket válido)
- **Query Params:**
  - `start`: Desplazamiento inicial en segundos absolutos (ej. `125.5`). *Atención:* Si el video es direct-playable (MP4/WebM H.264 estéreo), el cliente usa HTTP Range nativo sin enviar `start`, permitiendo reproducción directa sin FFmpeg. Si requiere remux o transcodificación, se añade `start` para posicionar FFmpeg.
  - `audio`: Índice de pista de audio a extraer en remux (ej. `0`, `1`).
  - `codec`: Forzar transcode a `h264` si el decodificador de hardware local falla.
  - `downmix`: `stereo` para remux con mezcla estéreo de audio 5.1/7.1.
  - `transcode`: `1` para forzar transcodificación completa.
- **Uso Android:** Fuente multimedia para Media3 `OkHttpDataSource.Factory`.
- **Response:**
  - Direct Play: `206 Partial Content` (Accept-Ranges: bytes) o `200 OK`. `Content-Type: video/mp4`.
  - Transcode/Remux: `200 OK` stream continuo fragmented MP4.
- **Errores:**
  - `401 Unauthorized`: Token ausente o inválido.
  - `403 Forbidden`: Perfil infantil restringido o ticket de sala inválido.
  - `404 Not Found`: Archivo de video no encontrado en storage.
  - `503 Service Unavailable`: Servidor de transcodificación ocupado (`Retry-After: 5`).

#### `GET /api/subtitles/{episodeId}/{track}`
- **Auth requerida:** Sí
- **Perfil requerido:** Sí
- **Uso Android:** Descarga de subtítulo nativo (.ass/.srt/.vtt) para inyectar como `MediaItem.SubtitleConfiguration` en Media3 con `MimeTypes.TEXT_SSA`.
- **Response (200 OK):** Texto plano del subtítulo (`Content-Type: text/plain; charset=utf-8`).

---

### 2.7 Progreso & Historial

#### `GET /api/history`
- **Auth requerida:** Sí
- **Perfil requerido:** Sí
- **Uso Android:** Pantalla de Historial y fila "Continuar viendo" de Inicio.
- **Response (200 OK):** Array de entradas de historial:
```json
[
  {
    "username": "calos",
    "profile_name": "Principal",
    "episode_id": "frieren_s01e01",
    "progress_seconds": 650.0,
    "duration": 1472.0,
    "completed": false,
    "updated_at": "2026-09-28 03:15:20",
    "show_id": "frieren",
    "season_number": 1,
    "episode_number": 1,
    "thumbnail_path": "...",
    "show_title": "Sousou no Frieren",
    "poster_path": "...",
    "backdrop_path": "..."
  }
]
```
- **DTO:** `HistoryItemDto` (en `List<HistoryItemDto>`)

#### `GET /api/progress/{episodeId}`
- **Auth requerida:** Sí
- **Perfil requerido:** Sí
- **Response (200 OK):**
```json
{
  "progress": 650.0,
  "completed": false,
  "duration": 1472.0
}
```
- **DTO:** `ProgressResponseDto`

#### `POST /api/progress/{episodeId}` o `POST /api/progress`
- **Auth requerida:** Sí
- **Perfil requerido:** Sí
- **Uso Android:** Guardar progreso periódicamente (throttled cada 10s), al pausar, al hacer seek o al salir del player.
- **Request Body:**
```json
{
  "episode_id": "frieren_s01e01",
  "progress": 650.0,
  "duration": 1472.0
}
```
- **Response (200 OK):** `{"success": true}`
- **DTOs:** `SaveProgressRequestDto`, `BaseResponseDto`

#### `DELETE /api/history`
- **Auth requerida:** Sí
- **Perfil requerido:** Sí
- **Uso Android:** Eliminar un elemento (`?episode_id=...`) o borrar todo (`?clear=all`).
- **Response (200 OK):** `{"success": true}`

---

### 2.8 Favoritos ("Mi Lista")

#### `GET /api/favorites`
- **Auth requerida:** Sí
- **Perfil requerido:** Sí
- **Uso Android:** Pantalla "Mi Lista" del perfil activo.
- **Response (200 OK):** Array de `ShowDto`.

#### `POST /api/favorites`
- **Auth requerida:** Sí
- **Perfil requerido:** Sí
- **Uso Android:** Alternar show en favoritos (toggle).
- **Request Body:** `{"show_id": "frieren"}`
- **Response (200 OK):** `{"favorited": true}`
- **DTO:** `ToggleFavoriteResponseDto`

#### `GET /api/favorites/check?showId={showId}`
- **Auth requerida:** Sí
- **Perfil requerido:** Sí
- **Response (200 OK):** `{"favorited": true}`

---

### 2.9 Calendario de Emisiones

#### `GET /api/calendar` o `GET /api/calendar/schedule`
- **Auth requerida:** No
- **Uso Android:** Vista de Calendario semanal en pestaña Explorar.
- **Response (200 OK):** Mapa de días de la semana (`Monday`..`Sunday`) a lista de shows en emisión:
```json
{
  "Friday": [
    {
      "schedule_id": 12345,
      "airing_at": 1727445600,
      "time_until": 3600,
      "episode": 24,
      "title": "Sousou no Frieren",
      "romaji_title": "Sousou no Frieren",
      "english_title": "Frieren: Beyond Journey's End",
      "cover_image": "...",
      "genres": "Aventura, Fantasía",
      "studio": "Madhouse",
      "in_library": true,
      "library_show_id": "frieren",
      "local_show_id": "frieren"
    }
  ]
}
```
- **DTO:** `Map<String, List<CalendarScheduleItemDto>>`

---

### 2.10 Notificaciones

#### `GET /api/notifications`
- **Auth requerida:** Sí
- **Perfil requerido:** Sí
- **Uso Android:** Feed de notificaciones y badge de no leídas en Top Bar / Perfil.
- **Response (200 OK):**
```json
{
  "success": true,
  "notifications": [
    {
      "id": 1,
      "title": "Nuevo episodio disponible",
      "message": "Episodio 24 de Sousou no Frieren ya está listo",
      "show_id": "frieren",
      "episode_id": "frieren_s01e24",
      "created_at": "2026-09-28 01:00:00"
    }
  ],
  "unread_count": 1,
  "last_seen_at": "2026-09-27 20:00:00"
}
```
- **DTO:** `NotificationsResponseDto`, `NotificationItemDto`

#### `POST /api/notifications/seen`
- **Auth requerida:** Sí
- **Perfil requerido:** Sí
- **Uso Android:** Marcar notificaciones como leídas al abrir la bandeja.
- **Response (200 OK):** `{"success": true}`

---

### 2.11 Preferencias y Estadísticas de Usuario

#### `GET /api/user/preferences`
- **Auth requerida:** Sí
- **Perfil requerido:** Sí
- **Response (200 OK):**
```json
{
  "success": true,
  "preferences": {
    "auto_skip_intro": true,
    "auto_play_next": true,
    "preferred_audio_language": "jpn",
    "preferred_subtitle_language": "spa",
    "audio_boost": 100,
    "audio_preset": "flat"
  }
}
```
- **DTO:** `UserPreferencesResponseDto`, `UserPreferencesDto`

#### `POST /api/user/preferences`
- **Auth requerida:** Sí
- **Perfil requerido:** Sí
- **Request Body:** Objeto parcial o completo de `UserPreferencesDto`.
- **Response (200 OK):** `{"success": true}`

#### `GET /api/user/stats`
- **Auth requerida:** Sí
- **Perfil requerido:** Sí
- **Uso Android:** Tarjeta de resumen estadístico en pantalla Perfil.
- **Response (200 OK):**
```json
{
  "success": true,
  "stats": {
    "total_time_seconds": 43200,
    "watched_episodes": 36,
    "completed_shows": 2,
    "top_genre": "Fantasía",
    "genres_breakdown": {
      "Fantasía": 18,
      "Aventura": 14
    }
  }
}
```
- **DTO:** `UserStatsResponseDto`, `UserStatsDto`

---

### 2.12 Comentarios

#### `GET /api/comments?show_id={showId}`
- **Auth requerida:** Opcional
- **Response (200 OK):**
```json
{
  "success": true,
  "comments": [
    {
      "id": 1,
      "username": "calos",
      "profile_name": "Principal",
      "content": "Una obra maestra de la animación moderna.",
      "created_at": "2026-09-28 02:00:00"
    }
  ]
}
```
- **DTO:** `CommentsResponseDto`, `CommentDto`

#### `POST /api/comments`
- **Auth requerida:** Sí
- **Perfil requerido:** Sí
- **Request Body:**
```json
{
  "show_id": "frieren",
  "content": "Excelente episodio.",
  "episode_id": "frieren_s01e01"
}
```
- **Response (200 OK):** `{"success": true, "comment": { ... }}`

---

### 2.13 Watch Party (Salas Compartidas & Sincronización)

#### `POST /api/party/create`
- **Auth requerida:** Sí
- **Perfil requerido:** Sí
- **Request Body:**
```json
{
  "episode_id": "frieren_s01e01",
  "name": "Frieren Noche de Estreno",
  "is_public": true
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "room_id": "room_xyz123",
  "member_id": "mem_abc789",
  "member_token": "tok_sec...",
  "stream_capability_token": "ey...",
  "stream_ticket": "ey...",
  "sse_ticket": "ey..."
}
```
- **DTO:** `PartyCreateResponseDto`

#### `POST /api/party/join`
- **Auth requerida:** Opcional (admite invitados o usuarios autenticados)
- **Request Body:**
```json
{
  "room_id": "room_xyz123"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "room": {
    "id": "room_xyz123",
    "name": "Frieren Noche de Estreno",
    "episode_id": "frieren_s01e01",
    "host_user": "calos",
    "current_time": 120.5,
    "is_playing": true
  },
  "member_id": "mem_user456",
  "member_token": "tok_...",
  "stream_capability_token": "ey...",
  "stream_ticket": "ey...",
  "sse_ticket": "ey..."
}
```
- **DTO:** `PartyJoinResponseDto`, `PartyRoomDto`

#### `POST /api/party/sync`
- **Cabeceras:** `X-Party-Member-Id: <id>`, `X-Party-Member-Token: <token>`
- **Request Body:**
```json
{
  "room_id": "room_xyz123",
  "current_time": 125.0,
  "is_playing": true,
  "playback_rate": 1.0
}
```
- **Response (200 OK):** `{"success": true}`

#### `POST /api/party/message`
- **Cabeceras:** `X-Party-Member-Id`, `X-Party-Member-Token`
- **Request Body:**
```json
{
  "room_id": "room_xyz123",
  "message": "¡Qué buena animación!"
}
```
- **Response (200 OK):** `{"success": true}`

#### `GET /api/party/stream?room_id={roomId}&ticket={ticket}`
- **Protocolo:** Server-Sent Events (SSE) `text/event-stream`
- **Eventos:**
  - `init`: Inicialización de la sala con datos del host y miembros.
  - `sync`: `{ "current_time": 130.0, "is_playing": true, "updated_by": "calos" }`
  - `messages`: Array de `PartyMessageDto` con autor, texto y fecha.
  - `ping`: Keepalive cada 15 segundos para mantener abierta la conexión SSE en redes móviles.
  - `room_closed`: La sala ha sido terminada por el anfitrión.
- **DTO:** `PartySyncEventDto`, `PartyMessageDto`

#### `GET /api/party/poll?room_id={roomId}&last_sync={timestamp}&last_message_id={id}`
- **Uso:** Fallback automático cuando SSE no está disponible o la conexión se interrumpe.
- **Response (200 OK):**
```json
{
  "success": true,
  "room": { ... },
  "messages": [ ... ]
}
```
- **DTO:** `PartyPollResponseDto`

#### `GET /api/party/public-rooms`
- **Auth requerida:** No
- **Response (200 OK):** Array de salas públicas disponibles con show y cantidad de miembros.
- **DTO:** `PublicPartyRoomDto`

---

## 3. Resumen de Flujos de Navegación y Ciclo de Vida Android

1. **Bootstrap / Splash:** Carga `ServerProfile` activo de DataStore -> Carga JWT de Android Keystore -> Llama a `/api/health`.
   - Si no hay servidor: Navega a `ServerSetupScreen`.
   - Si servidor inaccesible: Muestra diálogo de reconexión / diagnóstico sin borrar credenciales.
   - Si no hay token: Navega a `LoginScreen`.
   - Si hay token pero sin perfil: Navega a `ProfileSelectScreen`.
   - Si hay token con perfil: Comprueba validez y entra a `HomeScreen`.
2. **Player Lifecycle:**
   - Detecta si episodio es `direct_playable` (`mp4`/`webm` H.264 estéreo).
   - En Direct Play, Media3 busca con HTTP Range sin reenviar al backend.
   - Si requiere remux (MKV o pista de audio no primaria o downmix): Llama a `/api/stream/{id}?start={startSeconds}&audio={audioTrackIndex}` y mapea `absolutePosition = streamStartOffset + player.currentPosition`.
   - Carga subtítulo ASS como pista `MimeTypes.TEXT_SSA` y fuentes si es necesario.
   - Reporta progreso periódicamente (throttled a 10s) a `/api/progress/{episodeId}`.
