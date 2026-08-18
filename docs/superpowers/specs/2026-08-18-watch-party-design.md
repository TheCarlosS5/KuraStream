# Especificación de Diseño: Watch Party (Salas Virtuales en Vivo) para KuraStream

## 1. Visión General
**Watch Party** permite a múltiples usuarios ver anime de forma simultánea y sincronizada en tiempo real, interactuando a través de un chat en vivo, reacciones animadas flotantes y una lista de participantes conectados, sin requerir servicios externos ni puertos adicionales.

---

## 2. Requerimientos y Casos de Uso

### 2.1 Creación y Acceso a Salas
* **Creación de Sala**: Desde la barra superior o directamente desde el reproductor de cualquier episodio, un usuario puede pulsar **"🎉 Iniciar Watch Party"**.
* **Código y Enlace Único**: Se genera un código de sala corto (ej. `KURA-9A4F`) y un enlace directo compartible (`/#/party/KURA-9A4F`).
* **Privacidad**:
  * **Privada (Por Enlace/Código)**: Solo entran quienes tengan el enlace o código.
  * **Pública**: Aparece en un listado de salas activas en la pestaña de Watch Party.
* **Soporte de Usuarios e Invitados**: Usuarios registrados usan su nombre y avatar; usuarios invitados pueden ingresar asignando un apodo rápido.

### 2.2 Sincronización de Reproducción (Play / Pause / Seek / Siguiente Cap.)
* **Modo Anfitrión (Por Defecto)**:
  * El anfitrión controla la reproducción (play, pause, salto temporal y cambio de episodio).
  * Los espectadores se sincronizan automáticamente con el tiempo del anfitrión.
  * **Algoritmo de Suavizado (Drift Correction)**: Si un espectador tiene una diferencia de tiempo menor a 1.5 segundos, el reproductor ajusta sutilmente la velocidad (`playbackRate: 1.05` o `0.95`) para no provocar cortes; si la diferencia supera 2 segundos (por ejemplo un salto de escena), realiza un `currentTime = hostTime` directo.
* **Control Compartido (Opcional)**: El anfitrión puede activar la opción *"Permitir que cualquiera controle la reproducción"*.

### 2.3 Chat en Vivo y Reacciones Flotantes
* **Chat Integrado**: Panel lateral translúcido y retráctil junto al reproductor (y compatible en modo Pantalla Completa).
* **Mensajes del Sistema**: Alertas visuales cuando alguien entra, sale, pausa o adelanta el video.
* **Reacciones Flotantes (Danmaku / Flying Emojis)**: Botones rápidos de emojis (🔥, 😭, 😱, ❤️, 🎉) que lanzan partículas animadas sobre el reproductor para todos los miembros de la sala.
* **Lista de Participantes**: Muestra quiénes están viendo el episodio en tiempo real con indicador del anfitrión 👑.

---

## 3. Arquitectura Técnica

### 3.1 Backend (PHP 8.4 + MySQL)
* **Tablas de Base de Datos**:
  1. `party_rooms`:
     * `id` (VARCHAR(16) PRIMARY KEY, ej. `KURA-9A4F`)
     * `host_user` (VARCHAR(64))
     * `episode_id` (VARCHAR(255))
     * `is_playing` (TINYINT(1) DEFAULT 0)
     * `current_time` (DOUBLE DEFAULT 0)
     * `last_sync_timestamp` (BIGINT)
     * `is_public` (TINYINT(1) DEFAULT 0)
     * `allow_guest_controls` (TINYINT(1) DEFAULT 0)
     * `created_at`, `updated_at`
  2. `party_messages`:
     * `id` (INT AUTO_INCREMENT PRIMARY KEY)
     * `room_id` (VARCHAR(16))
     * `username` (VARCHAR(64))
     * `message` (TEXT)
     * `type` (ENUM: 'chat', 'reaction', 'system')
     * `created_at` (TIMESTAMP)
* **Endpoints REST & Eventos**:
  * `POST /api/party/create`: Crea una nueva sala.
  * `POST /api/party/join`: Une a un participante.
  * `POST /api/party/leave`: Desconecta a un participante.
  * `POST /api/party/sync`: Actualiza estado de reproducción (play/pause/seek/episodio).
  * `POST /api/party/message`: Envía mensaje o reacción.
  * `GET /api/party/stream?room_id=...`: Canal de eventos **Server-Sent Events (SSE)** con heartbeat para emitir cambios de estado y mensajes a baja latencia.
  * `GET /api/party/poll?room_id=...&last_id=...`: Fallback de polling para navegadores o redes con restricciones de SSE.
  * `GET /api/party/public-rooms`: Lista salas públicas activas.

### 3.2 Frontend (Vanilla JS + CSS Modular)
* **Módulo `party.js`**:
  * Maneja la conexión SSE / Polling, sincronización de audio/video, envío de mensajes y recepción de eventos.
  * Conexión directa con [player.js](file:///home/carlossgr/Escritorio/KuraStream/frontend/player.js).
* **Componente UI de Sala**:
  * Panel de chat con tema oscuro y glassmorphism.
  * Botón para copiar enlace / código de sala con feedback visual.
  * Menú de controles de anfitrión (transferir mando, cambiar privacidad, expulsar).

---

## 4. Plan de Pruebas y Validación Local
1. **Pruebas Unitarias de Backend**:
   - `test_party_rooms.php`: Creación de salas, cambio de anfitrión, inserción de mensajes y limpieza de salas expiradas.
2. **Pruebas de Concurrencia y Sincronización**:
   - Validación de dos clientes simultáneos sincronizando `play`, `pause` y `seek`.
3. **Validación Visual y Responsive**:
   - Verificación del chat flotante en escritorio, móviles y modo pantalla completa.
