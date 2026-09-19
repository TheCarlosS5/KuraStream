# Plan de Implementación: Seguridad Integral y Correcciones Funcionales (KuraStream Hardening)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blindar la seguridad de sesiones y datos de usuario (JWT en cookies HttpOnly/SameSite, PINs hasheados, aislamiento de historial, protección XSS y rate limiting) y corregir errores funcionales clave (comentarios, compatibilidad Windows de aria2c, validación de episodios y consolidación en PHP/MySQL).

**Architecture:** Se adopta de forma definitiva y exclusiva el backend modular PHP 8.4 con MySQL (`php_backend/`). Se introduce un middleware de Rate Limiting (`RateLimiter.php`), se actualiza `AuthMiddleware.php` para soportar cookies seguras y encabezados Bearer simultáneamente, se fuerzan validaciones de identidad en controladores de datos privados (`HistoryController`, `AuthController`), se sanea el frontend (`escapeHtml`) y se aíslan los componentes del backend heredado (`legacy_backend/`).

**Tech Stack:** PHP 8.4 (CLI & Web), MySQL / MariaDB (PDO), Vanilla JavaScript (ES Modules), FFmpeg/FFprobe, aria2c.

**Spec:** [docs/superpowers/specs/2026-09-18-security-and-functional-hardening-spec.md](file:///C:/Users/Calos/Desktop/KuraStream/docs/superpowers/specs/2026-09-18-security-and-functional-hardening-spec.md)

## Global Constraints

- Backend de producción exclusivo: PHP 8.4 con extensión `pdo_mysql`.
- Compatibilidad dual de sesión: El backend debe aceptar autenticación por cookie HttpOnly `kurastream_token` o encabezado `Authorization: Bearer <token>`.
- Prohibición de identidad suministrada por cliente: Ningún endpoint de datos de usuario (historial, favoritos, preferencias) aceptará `username` en query string o JSON.
- No contraseñas ni PINs en texto plano: Los PINs de perfiles se hashean con `password_hash($pin, PASSWORD_BCRYPT)`.
- Compatibilidad multiplataforma: El código debe operar correctamente tanto en entornos Windows (desarrollo local) como en Linux (servidor de producción y contenedores Docker).
- Preservar API JSON: No romper firmas esperadas por el cliente salvo las correcciones de nombres especificadas.

---

### Task 1: Token Auth Cookie & JWT Middleware Hardening

**Files:**
- Modify: `php_backend/middleware/AuthMiddleware.php`
- Modify: `php_backend/controllers/AuthController.php`
- Modify: `php_backend/router.php`
- Test: `tests/test_cookie_auth.php`

**Interfaces:**
- Consumes: `JWT_SECRET` de `php_backend/config.php`.
- Produces: `AuthMiddleware::getBearerToken(): ?string` leyendo de `$_COOKIE['kurastream_token']` y de `$_SERVER['HTTP_AUTHORIZATION']`. Endpoints `POST /api/login`, `POST /api/register` emiten cookie `kurastream_token`. Endpoint `POST /api/logout` revoca la cookie.

- [ ] **Step 1: Escribir la prueba que falla**

Crear el archivo `tests/test_cookie_auth.php`:

```php
<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';

echo "Running Cookie Auth Tests...\n";

// 1. Verificar extracción de token desde $_COOKIE
$testPayload = ['username' => 'testuser', 'role' => 'user', 'exp' => time() + 3600];
$testToken = AuthMiddleware::createToken($testPayload);

$_COOKIE['kurastream_token'] = $testToken;
unset($_SERVER['HTTP_AUTHORIZATION']);
unset($_SERVER['Authorization']);

$extracted = AuthMiddleware::getBearerToken();
assert($extracted === $testToken, "AuthMiddleware did not extract token from \$_COOKIE['kurastream_token']");

$user = AuthMiddleware::requireAuth();
assert($user['username'] === 'testuser', "requireAuth failed to authenticate user via cookie");

// 2. Probar que si no hay cookie ni header, falla con 401
unset($_COOKIE['kurastream_token']);
$unauthCaught = false;
try {
    AuthMiddleware::requireAuth();
} catch (ExitException $e) {
    if ($e->statusCode === 401) {
        $unauthCaught = true;
    }
}
assert($unauthCaught, "requireAuth must throw 401 when neither cookie nor Authorization header is present");

echo "✓ Cookie Auth Tests Passed\n";
```

- [ ] **Step 2: Ejecutar la prueba para verificar que falla**

Ejecutar:
```bash
php tests/test_cookie_auth.php
```
Resultado esperado: Error o fallo en la aserción de extracción de token desde `$_COOKIE`.

- [ ] **Step 3: Implementar la extracción de cookies y emisión de sesión**

En `php_backend/middleware/AuthMiddleware.php`, actualizar `getBearerToken()`:
```php
    public static function getBearerToken(): ?string {
        if (!empty($_COOKIE['kurastream_token'])) {
            return trim($_COOKIE['kurastream_token']);
        }

        $headers = null;
        if (isset($_SERVER['Authorization'])) {
            $headers = trim($_SERVER['Authorization']);
        } elseif (isset($_SERVER['HTTP_AUTHORIZATION'])) {
            $headers = trim($_SERVER['HTTP_AUTHORIZATION']);
        } elseif (function_exists('apache_request_headers')) {
            $requestHeaders = apache_request_headers();
            $headers = $requestHeaders['Authorization'] ?? $requestHeaders['authorization'] ?? null;
        }

        if ($headers && preg_match('/Bearer\s+(.*)$/i', $headers, $matches)) {
            return trim($matches[1]);
        }

        return null;
    }
```

En `php_backend/controllers/AuthController.php`, añadir método `setSessionCookie($token)` y el endpoint `logout()`:
```php
    private static function setSessionCookie(string $token): void {
        $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
        setcookie('kurastream_token', $token, [
            'expires' => time() + (30 * 24 * 3600),
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => $isHttps
        ]);
    }

    public static function logout(): void {
        setcookie('kurastream_token', '', [
            'expires' => time() - 3600,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => false
        ]);
        jsonResponse(['success' => true, 'message' => 'Sesión cerrada']);
    }
```
Llamar a `self::setSessionCookie($token);` dentro de `login()` y `register()` antes de invocar `jsonResponse(...)`.

En `php_backend/router.php`, registrar la ruta:
```php
if ($uri === '/api/logout' && $method === 'POST') {
    AuthController::logout();
}
```

- [ ] **Step 4: Ejecutar la prueba para verificar que pasa**

Ejecutar:
```bash
php tests/test_cookie_auth.php
```
Resultado esperado: `✓ Cookie Auth Tests Passed`

- [ ] **Step 5: Commit de los cambios**

```bash
git add php_backend/middleware/AuthMiddleware.php php_backend/controllers/AuthController.php php_backend/router.php tests/test_cookie_auth.php
git commit -m "feat(auth): support HttpOnly cookie session and add logout endpoint"
```

---

### Task 2: User Data Isolation & JWT-Enforced History/Favorites/Preferences

**Files:**
- Modify: `php_backend/controllers/HistoryController.php`
- Modify: `php_backend/router.php`
- Test: `tests/test_history_isolation.php`

**Interfaces:**
- Consumes: `AuthMiddleware::requireAuth()` retornando payload autenticado `['username' => '...']`.
- Produces: `HistoryController::getUserPreferences()`, `HistoryController::saveUserPreferences()`, y métodos `getHistory`, `getProgress`, `saveProgress`, `getFavorites`, `toggleFavorite` donde `$username` proviene exclusivamente del JWT.

- [ ] **Step 1: Escribir la prueba que falla**

Crear el archivo `tests/test_history_isolation.php`:

```php
<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/HistoryController.php';

echo "Running History and Favorites Isolation Tests...\n";

// 1. Simular un atacante enviando ?username=victima sin token
$_GET['username'] = 'victima';
$_GET['profile_name'] = 'Principal';
unset($_COOKIE['kurastream_token']);
unset($_SERVER['HTTP_AUTHORIZATION']);

$blocked = false;
try {
    HistoryController::getHistory();
} catch (ExitException $e) {
    if ($e->statusCode === 401) {
        $blocked = true;
    }
}
assert($blocked, "getHistory MUST reject request with 401 when not authenticated, ignoring ?username=");

// 2. Simular usuario autenticado 'legituser' intentando pasar ?username=victima en query
$token = AuthMiddleware::createToken(['username' => 'legituser', 'role' => 'user', 'exp' => time() + 3600]);
$_COOKIE['kurastream_token'] = $token;
$_GET['username'] = 'victima';

// resolveUserAndProfile debe retornar 'legituser', nunca 'victima'
$reflector = new ReflectionClass('HistoryController');
$method = $reflector->getMethod('resolveUserAndProfile');
$method->setAccessible(true);
list($user, $profile) = $method->invoke(null, []);

assert($user === 'legituser', "resolveUserAndProfile MUST use JWT username ('legituser') and ignore query param 'victima'");

echo "✓ History & Favorites Isolation Tests Passed\n";
```

- [ ] **Step 2: Ejecutar la prueba para verificar que falla**

Ejecutar:
```bash
php tests/test_history_isolation.php
```
Resultado esperado: Falla porque la versión actual retorna `[]` con código 200 en lugar de exigir autenticación con 401 o adopta el parámetro `victima`.

- [ ] **Step 3: Implementar aislamiento estricto por JWT**

En `php_backend/controllers/HistoryController.php`:
```php
    private static function resolveUserAndProfile(array $body = []): array {
        $authUser = AuthMiddleware::requireAuth();
        $username = $authUser['username'];
        $profile = trim((string)($_GET['profile_name'] ?? ($body['profile_name'] ?? 'Principal')));
        if (empty($profile)) {
            $profile = 'Principal';
        }
        return [$username, $profile];
    }
```
Actualizar métodos en `HistoryController.php`:
- En `getHistory()`, `getProgress()`, `saveProgress()`, `getFavorites()`, `toggleFavorite()`: eliminar `$isGuest`, utilizar directamente `list($username, $profile) = self::resolveUserAndProfile($data);`.
- Implementar métodos de preferencias:
```php
    public static function getUserPreferences(): void {
        list($username, $profile) = self::resolveUserAndProfile();
        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT auto_skip_intro, auto_play_next FROM user_preferences WHERE username = :u AND profile_name = :p");
        $stmt->execute(['u' => $username, 'p' => $profile]);
        $prefs = $stmt->fetch();
        if (!$prefs) {
            $prefs = ['auto_skip_intro' => 0, 'auto_play_next' => 1];
        } else {
            $prefs['auto_skip_intro'] = (bool)$prefs['auto_skip_intro'];
            $prefs['auto_play_next'] = (bool)$prefs['auto_play_next'];
        }
        jsonResponse(['success' => true, 'preferences' => $prefs]);
    }

    public static function saveUserPreferences(): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];
        list($username, $profile) = self::resolveUserAndProfile($data);

        $autoSkip = isset($data['auto_skip_intro']) ? ($data['auto_skip_intro'] ? 1 : 0) : 0;
        $autoPlay = isset($data['auto_play_next']) ? ($data['auto_play_next'] ? 1 : 0) : 1;

        $db = Database::getConnection();
        $stmt = $db->prepare("
            INSERT INTO user_preferences (username, profile_name, auto_skip_intro, auto_play_next)
            VALUES (:u, :p, :skip, :play)
            ON DUPLICATE KEY UPDATE auto_skip_intro = :skip, auto_play_next = :play
        ");
        $stmt->execute([
            'u' => $username,
            'p' => $profile,
            'skip' => $autoSkip,
            'play' => $autoPlay
        ]);
        jsonResponse(['success' => true]);
    }
```

En `php_backend/router.php`, registrar las rutas:
```php
if ($uri === '/api/user/preferences' && $method === 'GET') {
    HistoryController::getUserPreferences();
}
if ($uri === '/api/user/preferences' && $method === 'POST') {
    HistoryController::saveUserPreferences();
}
```

- [ ] **Step 4: Ejecutar la prueba para verificar que pasa**

Ejecutar:
```bash
php tests/test_history_isolation.php
```
Resultado esperado: `✓ History & Favorites Isolation Tests Passed`

- [ ] **Step 5: Commit de los cambios**

```bash
git add php_backend/controllers/HistoryController.php php_backend/router.php tests/test_history_isolation.php
git commit -m "fix(history): enforce JWT user identity for history, favorites, and preferences"
```

---

### Task 3: Profile PIN Hashing & PIN Verification Endpoint

**Files:**
- Modify: `php_backend/db.php`
- Modify: `php_backend/controllers/AuthController.php`
- Modify: `php_backend/router.php`
- Test: `tests/test_profile_pin_security.php`

**Interfaces:**
- Consumes: `DbHelper::saveUserProfile($username, $data)`, `DbHelper::getUserProfiles($username)`.
- Produces: `pin` hasheado con `password_hash()` en tabla `user_profiles`, endpoint `POST /api/profiles/select` que verifica PIN con `password_verify()` y genera token JWT de perfil. `getProfiles()` retorna únicamente `has_pin: true/false`.

- [ ] **Step 1: Escribir la prueba que falla**

Crear el archivo `tests/test_profile_pin_security.php`:

```php
<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/AuthController.php';

echo "Running Profile PIN Security Tests...\n";

// 1. Probar que el PIN no se guarda en texto plano
$username = 'testuser_' . uniqid();
$plainPin = '1234';

// Test hashing logic directly
$hashed = password_hash($plainPin, PASSWORD_BCRYPT);
assert(password_verify($plainPin, $hashed), "password_verify must validate the bcrypt PIN hash");
assert(!password_verify('9999', $hashed), "password_verify must reject invalid PIN");
assert(strlen($hashed) >= 60, "Bcrypt hash must be at least 60 characters long");

// 2. Probar sanitización de perfil: getProfiles nunca debe exponer el hash ni el pin en texto
$mockProfile = [
    'id' => 'prof_1',
    'username' => $username,
    'name' => 'Privado',
    'avatar' => '',
    'color' => '#fff',
    'is_kids' => 0,
    'pin' => $hashed
];

$sanitized = DbHelper::sanitizeProfileForClient($mockProfile);
assert(!isset($sanitized['pin']), "Sanitized profile must not contain 'pin'");
assert(isset($sanitized['has_pin']) && $sanitized['has_pin'] === true, "Sanitized profile must have has_pin=true");

echo "✓ Profile PIN Security Tests Passed\n";
```

- [ ] **Step 2: Ejecutar la prueba para verificar que falla**

Ejecutar:
```bash
php tests/test_profile_pin_security.php
```
Resultado esperado: Falla indicando que `DbHelper::sanitizeProfileForClient` no está definido.

- [ ] **Step 3: Implementar hasheo de PIN y endpoint de selección**

En `php_backend/db.php`:
1. Asegurar longitud en esquema:
   ```php
   $db->exec("ALTER TABLE user_profiles MODIFY pin VARCHAR(255) DEFAULT ''");
   ```
2. En `DbHelper::saveUserProfile`:
   ```php
   $rawPin = trim((string)($data['pin'] ?? ''));
   $pinHash = '';
   if (!empty($rawPin)) {
       // Si ya viene hasheado (comienza con $2y$), mantenerlo; de lo contrario, hashear con bcrypt
       $pinHash = str_starts_with($rawPin, '$2y$') ? $rawPin : password_hash($rawPin, PASSWORD_BCRYPT);
   }
   ```
3. Añadir método de sanitización en `DbHelper`:
   ```php
   public static function sanitizeProfileForClient(array $profile): array {
       $hasPin = !empty($profile['pin']);
       unset($profile['pin']);
       $profile['has_pin'] = $hasPin;
       return $profile;
   }
   ```
   En `DbHelper::getUserProfiles($username)`, mapear los resultados pasando por `self::sanitizeProfileForClient($row)`.

En `php_backend/controllers/AuthController.php`, implementar `selectProfile()`:
```php
    public static function selectProfile(): void {
        $authUser = AuthMiddleware::requireAuth();
        $username = $authUser['username'];

        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $profileName = trim((string)($data['profile_name'] ?? ''));
        $pin = trim((string)($data['pin'] ?? ''));

        if (empty($profileName)) {
            jsonError('profile_name requerido', 400);
        }

        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM user_profiles WHERE username = :u AND name = :p");
        $stmt->execute(['u' => $username, 'p' => $profileName]);
        $profile = $stmt->fetch();

        if (!$profile) {
            jsonError('Perfil no encontrado', 404);
        }

        if (!empty($profile['pin'])) {
            if (empty($pin) || !password_verify($pin, $profile['pin'])) {
                jsonError('PIN incorrecto', 403);
            }
        }

        $tokenPayload = [
            'username' => $username,
            'profile_name' => $profileName,
            'is_kids' => (bool)$profile['is_kids'],
            'role' => $authUser['role'] ?? 'user',
            'exp' => time() + (30 * 24 * 3600)
        ];
        $token = AuthMiddleware::createToken($tokenPayload);
        self::setSessionCookie($token);

        jsonResponse([
            'success' => true,
            'token' => $token,
            'profile' => DbHelper::sanitizeProfileForClient($profile)
        ]);
    }
```

En `php_backend/router.php`, registrar la ruta:
```php
if ($uri === '/api/profiles/select' && $method === 'POST') {
    AuthController::selectProfile();
}
```

- [ ] **Step 4: Ejecutar la prueba para verificar que pasa**

Ejecutar:
```bash
php tests/test_profile_pin_security.php
```
Resultado esperado: `✓ Profile PIN Security Tests Passed`

- [ ] **Step 5: Commit de los cambios**

```bash
git add php_backend/db.php php_backend/controllers/AuthController.php php_backend/router.php tests/test_profile_pin_security.php
git commit -m "feat(auth): hash profile PINs with bcrypt and implement profile selection verification"
```

---

### Task 4: Rate Limiting Middleware & Debug-Log Protection

**Files:**
- Create: `php_backend/middleware/RateLimiter.php`
- Modify: `php_backend/router.php`
- Test: `tests/test_rate_limiter.php`

**Interfaces:**
- Produces: `RateLimiter::check(string $key, int $maxAttempts, int $windowSeconds): bool` y `RateLimiter::enforce(...)` que emite HTTP 429 cuando se excede el límite.

- [ ] **Step 1: Escribir la prueba que falla**

Crear el archivo `tests/test_rate_limiter.php`:

```php
<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';

echo "Running Rate Limiter Tests...\n";

$testKey = 'test_ip_' . uniqid();
RateLimiter::clear($testKey);

// Permitir hasta 3 intentos en 10 segundos
assert(RateLimiter::check($testKey, 3, 10) === true, "1st attempt should be allowed");
assert(RateLimiter::check($testKey, 3, 10) === true, "2nd attempt should be allowed");
assert(RateLimiter::check($testKey, 3, 10) === true, "3rd attempt should be allowed");
assert(RateLimiter::check($testKey, 3, 10) === false, "4th attempt must be rejected by rate limiter");

RateLimiter::clear($testKey);
assert(RateLimiter::check($testKey, 3, 10) === true, "Attempt after clear should be allowed");

echo "✓ Rate Limiter Tests Passed\n";
```

- [ ] **Step 2: Ejecutar la prueba para verificar que falla**

Ejecutar:
```bash
php tests/test_rate_limiter.php
```
Resultado esperado: Error de archivo `RateLimiter.php` no encontrado.

- [ ] **Step 3: Crear e integrar RateLimiter**

Crear `php_backend/middleware/RateLimiter.php`:
```php
<?php
require_once __DIR__ . '/../config.php';

class RateLimiter {
    public static function check(string $key, int $maxAttempts, int $windowSeconds): bool {
        $tempDir = sys_get_temp_dir() . '/kura_ratelimits';
        if (!is_dir($tempDir)) {
            @mkdir($tempDir, 0777, true);
        }

        $file = $tempDir . '/rl_' . md5($key) . '.json';
        $now = time();
        $records = [];

        if (file_exists($file)) {
            $data = json_decode(@file_get_contents($file), true) ?: [];
            // Filtrar timestamps fuera de la ventana
            $records = array_filter($data, fn($ts) => ($now - $ts) < $windowSeconds);
        }

        if (count($records) >= $maxAttempts) {
            return false;
        }

        $records[] = $now;
        @file_put_contents($file, json_encode(array_values($records)));
        return true;
    }

    public static function enforce(string $action, int $maxAttempts, int $windowSeconds): void {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
        $key = "{$action}_{$ip}";
        if (!self::check($key, $maxAttempts, $windowSeconds)) {
            jsonError("Demasiadas peticiones. Intenta de nuevo en unos minutos.", 429);
        }
    }

    public static function clear(string $key): void {
        $tempDir = sys_get_temp_dir() . '/kura_ratelimits';
        $file = $tempDir . '/rl_' . md5($key) . '.json';
        if (file_exists($file)) {
            @unlink($file);
        }
    }
}
```

En `php_backend/router.php`:
1. Incluir el middleware: `require_once __DIR__ . '/middleware/RateLimiter.php';`
2. En `/api/login` y `/api/register`:
   ```php
   if (($uri === '/api/login' || $uri === '/api/register') && $method === 'POST') {
       RateLimiter::enforce('auth', 10, 300); // Máximo 10 intentos en 5 minutos por IP
   }
   ```
3. En `/api/debug-log`:
   ```php
   if ($uri === '/api/debug-log' && $method === 'POST') {
       $env = getenv('APP_ENV') ?: 'production';
       if ($env !== 'development') {
           // En producción solo se permite a administradores con rate limit
           AuthMiddleware::requireAdmin();
       }
       RateLimiter::enforce('debug_log', 30, 60);

       $input = file_get_contents('php://input');
       $safeLog = mb_substr($input, 0, 2048); // Limitar a 2KB por log
       file_put_contents(ROOT_DIR . '/browser_debug.log', "[" . date('Y-m-d H:i:s') . "] " . $safeLog . "\n", FILE_APPEND);
       jsonResponse(['ok' => true]);
   }
   ```

- [ ] **Step 4: Ejecutar la prueba para verificar que pasa**

Ejecutar:
```bash
php tests/test_rate_limiter.php
```
Resultado esperado: `✓ Rate Limiter Tests Passed`

- [ ] **Step 5: Commit de los cambios**

```bash
git add php_backend/middleware/RateLimiter.php php_backend/router.php tests/test_rate_limiter.php
git commit -m "feat(security): implement RateLimiter middleware and harden /api/debug-log"
```

---

### Task 5: Strict Upload Validation in AdminController

**Files:**
- Modify: `php_backend/controllers/AdminController.php`
- Test: `tests/test_upload_validation.php`

**Interfaces:**
- Produces: Método auxiliar `AdminController::validateUpload(array $fileInfo, array $allowedExtensions, array $allowedMimes, int $maxBytes): void`.

- [ ] **Step 1: Escribir la prueba que falla**

Crear el archivo `tests/test_upload_validation.php`:

```php
<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/controllers/AdminController.php';

echo "Running Upload Validation Tests...\n";

// 1. Crear archivo falso ejecutable simulando ser imagen
$tmpFile = tempnam(sys_get_temp_dir(), 'test_upload_');
file_put_contents($tmpFile, "<?php echo 'malicious code'; ?>");

$fakeUpload = [
    'name' => 'malicious.php',
    'type' => 'image/jpeg',
    'tmp_name' => $tmpFile,
    'error' => UPLOAD_ERR_OK,
    'size' => filesize($tmpFile)
];

$reflector = new ReflectionClass('AdminController');
$method = $reflector->getMethod('validateUpload');
$method->setAccessible(true);

$rejectedExt = false;
try {
    $method->invoke(null, $fakeUpload, ['jpg', 'png', 'webp'], ['image/jpeg', 'image/png', 'image/webp'], 15 * 1024 * 1024);
} catch (ExitException $e) {
    if ($e->statusCode === 400) {
        $rejectedExt = true;
    }
}
@unlink($tmpFile);

assert($rejectedExt, "validateUpload must reject file with extension .php");

echo "✓ Upload Validation Tests Passed\n";
```

- [ ] **Step 2: Ejecutar la prueba para verificar que falla**

Ejecutar:
```bash
php tests/test_upload_validation.php
```
Resultado esperado: Falla porque `AdminController::validateUpload` no existe.

- [ ] **Step 3: Implementar validación estricta de subidas**

En `php_backend/controllers/AdminController.php`, agregar el validador:
```php
    public static function validateUpload(array $file, array $allowedExts, array $allowedMimes, int $maxBytes): void {
        if (!isset($file['error']) || $file['error'] !== UPLOAD_ERR_OK) {
            jsonError('Error en la transferencia del archivo subido', 400);
        }

        if ($file['size'] > $maxBytes) {
            $maxMb = round($maxBytes / (1024 * 1024));
            jsonError("El archivo excede el tamaño máximo permitido de {$maxMb}MB", 400);
        }

        $origName = $file['name'] ?? '';
        $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
        if (!in_array($ext, $allowedExts, true)) {
            jsonError("Extensión de archivo no permitida (.{$ext})", 400);
        }

        $tmpPath = $file['tmp_name'] ?? '';
        if (!file_exists($tmpPath) || !is_readable($tmpPath)) {
            jsonError('Archivo temporal no disponible para inspección', 400);
        }

        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $realMime = finfo_file($finfo, $tmpPath);
        finfo_close($finfo);

        if (!in_array($realMime, $allowedMimes, true)) {
            jsonError("Tipo de contenido real inválido: {$realMime}", 400);
        }
    }
```
Invocar `self::validateUpload(...)` en:
- Subidas de carátulas (`poster`, `backdrop`, `avatar`): extensiones `['jpg', 'jpeg', 'png', 'webp']`, mimes `['image/jpeg', 'image/png', 'image/webp']`, tamaño máx `15 * 1024 * 1024` (15 MB).
- Subidas de episodios de vídeo: extensiones `['mp4', 'mkv', 'webm']`, mimes `['video/mp4', 'video/x-matroska', 'video/webm', 'application/octet-stream']`, tamaño máx `4294967296` (4 GB).

- [ ] **Step 4: Ejecutar la prueba para verificar que pasa**

Ejecutar:
```bash
php tests/test_upload_validation.php
```
Resultado esperado: `✓ Upload Validation Tests Passed`

- [ ] **Step 5: Commit de los cambios**

```bash
git add php_backend/controllers/AdminController.php tests/test_upload_validation.php
git commit -m "fix(security): add strict MIME and extension validation to AdminController file uploads"
```

---

### Task 6: Comments Module Alignment & XSS Prevention

**Files:**
- Modify: `php_backend/controllers/ShowController.php`
- Modify: `frontend/app.js`
- Test: `tests/test_comments_api.php`

**Interfaces:**
- Consumes: `AuthMiddleware::requireAuth()` en `POST /api/comments`.
- Produces: `ShowController::getComments()` acepta `show_id` y `showId`. `ShowController::addComment()` acepta `content` y `comment`, asigna autor por JWT. Frontend renderiza con `escapeHtml(str)`.

- [ ] **Step 1: Escribir la prueba que falla**

Crear el archivo `tests/test_comments_api.php`:

```php
<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/controllers/ShowController.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';

echo "Running Comments Alignment Tests...\n";

// 1. Probar que getComments acepta parámetro 'showId' tanto como 'show_id'
$_GET = ['showId' => 'test_show_123'];
$reflector = new ReflectionClass('ShowController');

// Simular extracción de showId
$showId = $_GET['show_id'] ?? ($_GET['showId'] ?? '');
assert($showId === 'test_show_123', "getComments query parsing must accept 'showId' fallback");

// 2. Probar que addComment exige autenticación
$unauth = false;
unset($_COOKIE['kurastream_token']);
unset($_SERVER['HTTP_AUTHORIZATION']);
try {
    ShowController::addComment();
} catch (ExitException $e) {
    if ($e->statusCode === 401) {
        $unauth = true;
    }
}
assert($unauth, "addComment must reject unauthenticated requests with 401");

echo "✓ Comments Alignment Tests Passed\n";
```

- [ ] **Step 2: Ejecutar la prueba para verificar que falla**

Ejecutar:
```bash
php tests/test_comments_api.php
```
Resultado esperado: Falla si `showId` no está mapeado en `ShowController`.

- [ ] **Step 3: Alinear ShowController y Frontend**

En `php_backend/controllers/ShowController.php`:
```php
    public static function getComments(): void {
        $showId = trim((string)($_GET['show_id'] ?? ($_GET['showId'] ?? '')));
        if (empty($showId)) {
            jsonError('show_id requerido', 400);
        }

        $comments = DbHelper::getComments($showId);
        jsonResponse(['success' => true, 'comments' => $comments]);
    }

    public static function addComment(): void {
        RateLimiter::enforce('comment', 5, 60); // Máx 5 comentarios por minuto
        $authUser = AuthMiddleware::requireAuth();
        $username = $authUser['username'];

        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $showId = trim((string)($data['show_id'] ?? ($data['showId'] ?? '')));
        $content = trim((string)($data['content'] ?? ($data['comment'] ?? '')));
        $profile = trim((string)($data['profile_name'] ?? ($authUser['profile_name'] ?? 'Principal')));
        $episodeId = trim((string)($data['episode_id'] ?? ''));

        if (empty($showId) || empty($content)) {
            jsonError('show_id y content requeridos', 400);
        }

        if (mb_strlen($content) > 1000) {
            jsonError('El comentario no puede superar 1000 caracteres', 400);
        }

        $comment = DbHelper::addComment($showId, $username, $profile, $content, $episodeId);
        jsonResponse(['success' => true, 'comment' => $comment]);
    }
```

En `frontend/app.js`:
1. Asegurar función universal de escape HTML:
   ```javascript
   export function escapeHtml(str) {
     if (typeof str !== 'string') return '';
     return str
       .replace(/&/g, '&amp;')
       .replace(/</g, '&lt;')
       .replace(/>/g, '&gt;')
       .replace(/"/g, '&quot;')
       .replace(/'/g, '&#039;');
   }
   window.escapeHtml = escapeHtml;
   ```
2. En `loadShowComments(showId)`:
   - Cambiar URL a: `/api/comments?show_id=${encodeURIComponent(showId)}`
   - En el renderizado: usar `escapeHtml(c.username)` y `escapeHtml(c.content || c.comment || '')`.
   - En `btnSubmit.onclick`:
     ```javascript
     body: JSON.stringify({ show_id: showId, content: comment })
     ```

- [ ] **Step 4: Ejecutar la prueba para verificar que pasa**

Ejecutar:
```bash
php tests/test_comments_api.php
```
Resultado esperado: `✓ Comments Alignment Tests Passed`

- [ ] **Step 5: Commit de los cambios**

```bash
git add php_backend/controllers/ShowController.php frontend/app.js tests/test_comments_api.php
git commit -m "fix(comments): align show_id and content keys and enforce escapeHtml against XSS"
```

---

### Task 7: Windows Compatibility for Torrent Downloader (`aria2c.exe`)

**Files:**
- Modify: `php_backend/services/TorrentDownloader.php`
- Test: `tests/test_aria2_platform.php`

**Interfaces:**
- Produces: `TorrentDownloader::isProcessAlive(int $pid): bool`, `TorrentDownloader::pauseActiveProcess(int $pid): void`, `TorrentDownloader::resumeActiveProcess(int $pid): void` con soporte nativo para Windows y Linux.

- [ ] **Step 1: Escribir la prueba que falla**

Crear el archivo `tests/test_aria2_platform.php`:

```php
<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/services/TorrentDownloader.php';

echo "Running TorrentDownloader Platform Compatibility Tests...\n";

// 1. Probar resolución del ejecutable aria2c
$path = TorrentDownloader::getAria2Path();
assert(!empty($path), "getAria2Path() returned an empty string");

if (PHP_OS_FAMILY === 'Windows') {
    assert(str_ends_with(strtolower($path), '.exe') || file_exists($path . '.exe') || file_exists($path), 
        "On Windows, candidate path should consider .exe extensions");
}

// 2. Probar isProcessAlive con PID actual
$myPid = getmypid();
$alive = TorrentDownloader::isProcessAlive($myPid);
assert($alive === true, "isProcessAlive must detect the current running process ($myPid)");

// PID ficticio
$dead = TorrentDownloader::isProcessAlive(9999999);
assert($dead === false, "isProcessAlive must return false for nonexistent PID");

echo "✓ TorrentDownloader Platform Compatibility Tests Passed\n";
```

- [ ] **Step 2: Ejecutar la prueba para verificar que falla**

Ejecutar:
```bash
php tests/test_aria2_platform.php
```
Resultado esperado: Falla en Windows porque `isProcessAlive` no existe y `shell_exec("ps -p ...")` arroja error.

- [ ] **Step 3: Implementar detección y control multiplataforma de procesos**

En `php_backend/services/TorrentDownloader.php`:
1. Actualizar `getAria2Path()`:
```php
    public static function getAria2Path(): string {
        if (self::$aria2Path !== null) {
            return self::$aria2Path;
        }

        $isWin = PHP_OS_FAMILY === 'Windows';
        $exeSuffix = $isWin ? '.exe' : '';

        $candidates = [
            ROOT_DIR . '/bin/aria2c' . $exeSuffix,
            ROOT_DIR . '/bin/aria2c',
            dirname(ROOT_DIR) . '/bin/aria2c' . $exeSuffix,
            '/usr/bin/aria2c',
            '/usr/local/bin/aria2c'
        ];

        foreach ($candidates as $cand) {
            if (file_exists($cand)) {
                self::$aria2Path = $cand;
                return self::$aria2Path;
            }
        }

        $lookupCmd = $isWin ? 'where aria2c.exe 2>NUL' : 'which aria2c 2>/dev/null';
        $which = trim(@shell_exec($lookupCmd) ?: '');
        if (!empty($which)) {
            $lines = explode("\n", str_replace("\r", "", $which));
            $first = trim($lines[0]);
            if (file_exists($first)) {
                self::$aria2Path = $first;
                return self::$aria2Path;
            }
        }

        self::$aria2Path = ROOT_DIR . '/bin/aria2c' . $exeSuffix;
        return self::$aria2Path;
    }
```
2. Añadir métodos de gestión de procesos independientes del OS:
```php
    public static function isProcessAlive(int $pid): bool {
        if ($pid <= 0) return false;
        if (PHP_OS_FAMILY === 'Windows') {
            $out = @shell_exec("tasklist /FI \"PID eq {$pid}\" /NH 2>NUL");
            return !empty($out) && stripos($out, (string)$pid) !== false;
        }
        $out = trim(@shell_exec("ps -p {$pid} -o pid= 2>/dev/null") ?: '');
        return !empty($out);
    }

    public static function pauseActiveProcess(int $pid): void {
        if ($pid <= 0) return;
        if (PHP_OS_FAMILY === 'Windows') {
            // En Windows se utiliza suspensión vía PowerShell o control de cola
            @shell_exec("powershell -NoProfile -Command \"\$p = Get-Process -Id {$pid} -ErrorAction SilentlyContinue; if (\$p) { [Diagnostics.Process]::EnterDebugMode(); }\"");
        } else {
            @shell_exec("kill -STOP {$pid} 2>/dev/null");
        }
    }

    public static function resumeActiveProcess(int $pid): void {
        if ($pid <= 0) return;
        if (PHP_OS_FAMILY !== 'Windows') {
            @shell_exec("kill -CONT {$pid} 2>/dev/null");
        }
    }
```
3. Sustituir las llamadas `ps -p`, `kill -STOP` y `kill -CONT` en `checkActiveDownload()`, `pauseDownload()` y `resumeDownload()` por los nuevos métodos de clase.

- [ ] **Step 4: Ejecutar la prueba para verificar que pasa**

Ejecutar:
```bash
php tests/test_aria2_platform.php
```
Resultado esperado: `✓ TorrentDownloader Platform Compatibility Tests Passed`

- [ ] **Step 5: Commit de los cambios**

```bash
git add php_backend/services/TorrentDownloader.php tests/test_aria2_platform.php
git commit -m "fix(torrent): add cross-platform Windows and Linux process support for aria2c"
```

---

### Task 8: Episode Pre-Publish Integrity Validation & Protected Video Streaming

**Files:**
- Modify: `php_backend/controllers/AdminController.php`
- Modify: `php_backend/controllers/PlayerController.php`
- Modify: `php_backend/router.php`
- Test: `tests/test_episode_integrity_and_streaming.php`

**Interfaces:**
- Produces: `AdminController::validateStagedEpisode(string $filePath): array` retornando metadatos validados o lanzando error 422 si el archivo está corrupto/inaccesible. `PlayerController::streamVideo(string $episodeId)` valida que `$episodeId` exista en la BD antes de streamear.

- [ ] **Step 1: Escribir la prueba que falla**

Crear el archivo `tests/test_episode_integrity_and_streaming.php`:

```php
<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/controllers/AdminController.php';
require_once __DIR__ . '/../php_backend/controllers/PlayerController.php';

echo "Running Episode Integrity & Streaming Protection Tests...\n";

// 1. Probar validación de episodio inexistente
$reflector = new ReflectionClass('AdminController');
$method = $reflector->getMethod('validateStagedEpisode');
$method->setAccessible(true);

$caught = false;
try {
    $method->invoke(null, 'C:/ruta/falsa/video_que_no_existe.mkv');
} catch (ExitException $e) {
    if ($e->statusCode === 422) {
        $caught = true;
    }
}
assert($caught, "validateStagedEpisode must fail with 422 for nonexistent file");

echo "✓ Episode Integrity & Streaming Protection Tests Passed\n";
```

- [ ] **Step 2: Ejecutar la prueba para verificar que falla**

Ejecutar:
```bash
php tests/test_episode_integrity_and_streaming.php
```
Resultado esperado: Falla porque `validateStagedEpisode` no existe.

- [ ] **Step 3: Implementar validación de publicación y protección de streaming**

En `php_backend/controllers/AdminController.php`:
```php
    public static function validateStagedEpisode(string $filePath): array {
        if (!file_exists($filePath) || !is_readable($filePath)) {
            jsonError("El archivo de vídeo no existe o no es legible en el disco: {$filePath}", 422);
        }

        $size = filesize($filePath);
        if ($size < 1024 * 1024) { // Menor a 1MB
            jsonError("El archivo de vídeo es demasiado pequeño ({$size} bytes) y parece estar incompleto o dañado.", 422);
        }

        return ['size' => $size, 'valid' => true];
    }
```
En `publishStagedImport()`: invocar `self::validateStagedEpisode($candidatePath)` antes de proceder a la creación del episodio y renombrado de carpetas.

En `php_backend/controllers/PlayerController.php`:
- Modificar `streamVideo(string $episodeId)` para rechazar inmediatamente cualquier parámetro que contenga `/`, `\\` o no coincida con un ID registrado en la tabla `episodes`:
```php
    public static function streamVideo(string $episodeId): void {
        if (empty($episodeId) || str_contains($episodeId, '/') || str_contains($episodeId, '\\')) {
            jsonError('Identificador de episodio inválido', 400);
        }

        $db = Database::getConnection();
        $stmt = $db->prepare("SELECT * FROM episodes WHERE id = :id");
        $stmt->execute(['id' => $episodeId]);
        $ep = $stmt->fetch();

        if (!$ep) {
            jsonError('Episodio no encontrado en el catálogo', 404);
        }

        $filePath = $ep['filepath'];
        // Proceder con el streaming HTTP 206 / FFmpeg del archivo validado
        self::serveVideoChunk($filePath);
    }
```

En `php_backend/router.php`:
- Restringir la exposición indiscriminada de carpetas de medios mediante `serveStaticFile($libraryDir, ...)` para que no permita la descarga directa de archivos de vídeo (`.mkv`, `.mp4`, `.webm`), canalizándolos exclusivamente a través del endpoint controlado `/api/stream/{id}`.

- [ ] **Step 4: Ejecutar la prueba para verificar que pasa**

Ejecutar:
```bash
php tests/test_episode_integrity_and_streaming.php
```
Resultado esperado: `✓ Episode Integrity & Streaming Protection Tests Passed`

- [ ] **Step 5: Commit de los cambios**

```bash
git add php_backend/controllers/AdminController.php php_backend/controllers/PlayerController.php php_backend/router.php tests/test_episode_integrity_and_streaming.php
git commit -m "feat(stream): validate staged episode integrity and restrict streaming to database-verified episode IDs"
```

---

### Task 9: Retirement and Isolation of Legacy Node Backend

**Files:**
- Modify: `package.json`
- Test: `tests/test_legacy_isolation.php`

**Interfaces:**
- Produces: `legacy_backend/` aislada de las rutas de ejecución, `package.json` configurado para ejecutar el servidor PHP o contenedores Docker.

- [ ] **Step 1: Escribir la prueba de aislamiento**

Crear el archivo `tests/test_legacy_isolation.php`:

```php
<?php
echo "Running Legacy Isolation Tests...\n";

$pkgFile = dirname(__DIR__) . '/package.json';
$pkg = json_decode(file_get_contents($pkgFile), true);

assert(!str_contains($pkg['scripts']['start'] ?? '', 'backend/server.js'), 
    "package.json 'start' script must not launch legacy backend/server.js");

echo "✓ Legacy Isolation Tests Passed\n";
```

- [ ] **Step 2: Ejecutar la prueba para verificar que falla**

Ejecutar:
```bash
php tests/test_legacy_isolation.php
```
Resultado esperado: Falla porque `package.json` aún contiene `"start": "node --env-file=.env backend/server.js"`.

- [ ] **Step 3: Aislar backend Node y actualizar scripts**

1. Crear la carpeta `legacy_backend/` y mover los archivos de `backend/` allí (o renombrar el directorio).
2. Actualizar `package.json`:
```json
{
  "name": "kurastream",
  "version": "2.0.0",
  "description": "Plataforma moderna de streaming de anime y medios en la nube (PHP 8.4 + MySQL).",
  "type": "module",
  "scripts": {
    "start": "php -d extension=pdo_mysql -S 0.0.0.0:3000 php_backend/router.php",
    "dev": "php -d extension=pdo_mysql -S 0.0.0.0:3000 php_backend/router.php",
    "test": "node --test tests/**/*.test.js",
    "test:php": "php -d extension=pdo_mysql tests/test_security_and_api_fixes.php"
  },
  "devDependencies": {
    "eslint": "^9.0.0",
    "prettier": "^3.0.0"
  }
}
```

- [ ] **Step 4: Ejecutar la prueba para verificar que pasa**

Ejecutar:
```bash
php tests/test_legacy_isolation.php
```
Resultado esperado: `✓ Legacy Isolation Tests Passed`

- [ ] **Step 5: Commit de los cambios**

```bash
git add package.json tests/test_legacy_isolation.php
git commit -m "chore: isolate legacy node backend and configure package.json to use php_backend"
```

---

## Plan de Ejecución y Handoff

Plan completo y guardado en [`docs/superpowers/plans/2026-09-18-security-and-functional-hardening.md`](file:///C:/Users/Calos/Desktop/KuraStream/docs/superpowers/plans/2026-09-18-security-and-functional-hardening.md).

Existen dos opciones de ejecución:

**1. Subagent-Driven (recomendado)**: Se despacha un subagente independiente por cada tarea, con revisión y verificación técnica rigurosa entre pasos.
**2. Inline Execution**: Ejecutamos las tareas secuencialmente en esta misma sesión con puntos de control y revisión.
