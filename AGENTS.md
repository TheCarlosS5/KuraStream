# KuraStream — reglas para agentes (agy / Gemini, Codex, Claude)

Antigravity CLI (`agy`) carga este archivo solo al trabajar dentro del repositorio. Son las reglas del proyecto: síguelas aunque el prompt no las repita.

## Qué es
Streaming de anime autoalojado para una familia, en un servidor Debian modesto (2 núcleos, 3.7 GB).
- `php_backend/`: PHP 8.4 sin framework (`router.php` → `controllers/` → `DbHelper` en `db.php`), MariaDB. Migraciones en `php_backend/migrations/NNN_*.sql`: se aplican solas en la primera petición y se registran por nombre de archivo.
- `frontend/`: JS vanilla con módulos ES (`js/main.js`, `player.js`) y build con esbuild (`npm run build`).
- `android/`: app nativa en Kotlin + Compose + Hilt + Media3.

## Verificar antes de dar algo por terminado
- PHP: `npm test` (sin MySQL, las suites de BD se saltan). Con BD: una base cuyo nombre termine en `_test` (`DB_NAME=kurastream_test npm test`). El runner se niega a usar otra base.
- Web: `npx eslint frontend --rule '{"no-undef":"error"}'`, `npm run build` y `node tests/ui_catalogue_rendering.mjs`.
- Android: `android\gradlew.bat assembleDebug testDebugUnitTest lintDebug`. **No lances Gradle si el prompt dice que compila otro** (el PC es justo de memoria). Tras compilar: `gradlew --stop`.

## Reglas que se han roto antes (no repetir)
- **Nada de reemplazos masivos con regex** ni reformatear archivos enteros. Edita solo las líneas necesarias.
- **Finales de línea LF**: no conviertas archivos a CRLF.
- **Kotlin/Compose legible**: una sentencia por línea, imports completos y correctos, llaves cerradas. Nada de una línea gigante.
- **Sin UI muerta**: cada botón nuevo necesita su handler y su ruta en el backend.
- **CSP estricta** (`kuraSecurityHeaders()` en `php_backend/config.php`): sin `<script>` inline, sin `onclick=""` ni otros atributos `on*`, sin CDNs. Los handlers se registran desde JS.
- **No toques la versión de assets** salvo que la tarea lo pida. Si cambias archivos de `frontend/`, súbela en todos estos sitios a la vez: `frontend/index.html` (`?v=`), `frontend/sw.js` (`CACHE_NAME` y lista), `frontend/js/main.js` y `frontend/js/features/player/player_controller.js` (import de `player.js?v=`), `tests/test_pwa_docker_security.php`, `tests/e2e/pwa.spec.js`.
- **Severidades honestas** en revisiones: "crítico" solo si hay pérdida de datos, fallo de seguridad explotable o caída. Cita archivo y línea.
- No ejecutes nada contra el servidor Debian ni leas `.env`, `apikeys.txt` o los `scripts/*.py` de instalación: contienen credenciales.

## Convenciones
- Comentarios de código en inglés, breves, explicando el *porqué*. Textos de la interfaz en español.
- Tests: PHP en `tests/test_*.php` (regístralos en `tests/run_all_tests.php`), Android en `android/app/src/test` (JUnit4 + mockk + coroutines-test).
- Las fiestas (watch party) sincronizan por `party_rooms.version` (SSE) y `last_sync_member` (quién mandó el último sync). No reescribas el reloj de la sala en join/leave.
- Al terminar, resume qué archivos tocaste y qué cambió en cada uno. Si no pudiste verificar algo, dilo.
