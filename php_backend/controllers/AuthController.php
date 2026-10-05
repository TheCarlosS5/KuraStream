<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../middleware/AuthMiddleware.php';
require_once __DIR__ . '/../middleware/RateLimiter.php';
require_once __DIR__ . '/../middleware/Input.php';

class AuthController {
    public static function hashPassword(string $password): string {
        return hash_hmac('sha256', $password, PASSWORD_SALT);
    }

    public static function login(?array $inputData = null): void {
        $data = $inputData !== null ? $inputData : Input::json();

        $username = Input::string($data, 'username', 255);
        $password = Input::string($data, 'password', 1024, false);

        if (empty($username) || empty($password)) {
            jsonError('Usuario y contraseña requeridos', 400);
        }

        // Optional Environment admin credentials check
        $adminUser = getenv('ADMIN_USER');
        $adminPass = getenv('ADMIN_PASS');
        $adminPassHash = getenv('ADMIN_PASS_HASH');

        if (!empty($adminUser) && strcasecmp($username, $adminUser) === 0) {
            $isPassValid = false;
            if (!empty($adminPassHash)) {
                $isPassValid = password_verify($password, $adminPassHash);
            } elseif (!empty($adminPass)) {
                if (kuraAdminPasswordIsPlaceholder($adminPass)) {
                    // Fail closed: a default such as "change_me" must never grant administrator access.
                    error_log('[KuraStream] ADMIN_PASS is a placeholder value; environment admin login is disabled. Set a strong ADMIN_PASS or ADMIN_PASS_HASH.');
                } else {
                    $isPassValid = hash_equals($adminPass, (string)$password);
                }
            }

            if ($isPassValid) {
                $tokenPayload = [
                    'username' => $username,
                    'role' => 'admin',
                    'exp' => time() + (30 * 24 * 3600)
                ];
                $token = AuthMiddleware::createToken($tokenPayload);
                self::setSessionCookie($token);

                jsonResponse([
                    'success' => true,
                    'token' => $token,
                    'role' => 'admin',
                    'username' => $username,
                    'user' => [
                        'username' => $username,
                        'role' => 'admin'
                    ]
                ]);
            }

            jsonError('Credenciales incorrectas', 401);
        }

        // DB user credentials check
        $user = null;
        try {
            $user = DbHelper::getUser($username);
        } catch (Throwable $e) {
            $user = null;
        }
        if ($user) {
            $storedHash = $user['password_hash'] ?? '';
            $isPassValid = false;

            if (password_verify($password, $storedHash)) {
                $isPassValid = true;
            } elseif ($storedHash !== '' && (hash_equals($storedHash, hash_hmac('sha256', $password, PASSWORD_SALT)) || hash_equals($storedHash, hash('sha256', $password)))) {
                $isPassValid = true;
                // Rehash to secure bcrypt
                $newHash = password_hash($password, PASSWORD_BCRYPT);
                $db = Database::getConnection();
                $up = $db->prepare("UPDATE users SET password_hash = :p WHERE LOWER(username) = LOWER(:u)");
                $up->execute(['p' => $newHash, 'u' => $username]);
            }

            if ($isPassValid) {
                $actualUsername = $user['username'] ?? $username;
                // Ensure default profile is created for the user in DB
                DbHelper::getUserProfiles($actualUsername);

                $tokenPayload = [
                    'username' => $actualUsername,
                    'role' => $user['role'] ?? 'user',
                    'ver' => (int)($user['token_version'] ?? 0),
                    'exp' => time() + (30 * 24 * 3600)
                ];
                $token = AuthMiddleware::createToken($tokenPayload);
                self::setSessionCookie($token);

                $role = $user['role'] ?? 'user';
                jsonResponse([
                    'success' => true,
                    'token' => $token,
                    'role' => $role,
                    'username' => $actualUsername,
                    'user' => [
                        'username' => $actualUsername,
                        'role' => $role
                    ]
                ]);
            }
        }

        jsonError('Credenciales incorrectas', 401);
    }

    public static function register(?array $inputData = null): void {
        // REGISTRATION_MODE: unset/"open" keeps sign-up public; any other value closes it (a typo must not
        // silently leave the door open on a server meant to be private).
        $registrationMode = strtolower(trim((string)getenv('REGISTRATION_MODE')));
        if ($registrationMode !== '' && $registrationMode !== 'open') {
            jsonError('El registro de cuentas está deshabilitado en este servidor. Pide al administrador que cree tu cuenta.', 403);
        }

        $data = $inputData !== null ? $inputData : Input::json();

        $username = Input::string($data, 'username', 255);
        $password = Input::string($data, 'password', 1024, false);

        if (empty($username) || empty($password)) {
            jsonError('Usuario y contraseña requeridos', 400);
        }

        // Plain, unambiguous names: no spaces, control characters or look-alike Unicode in anything that is
        // later shown next to comments and in watch-party chat.
        if (!preg_match('/^[A-Za-z0-9_.-]{3,32}$/', $username)) {
            jsonError('El nombre de usuario debe tener entre 3 y 32 caracteres: letras, números, punto, guion y guion bajo', 400);
        }

        // bcrypt only uses the first 72 bytes; accepting more would give a false sense of strength.
        if (strlen($password) < 8 || strlen($password) > 72) {
            jsonError('La contraseña debe tener entre 8 y 72 caracteres', 400);
        }

        // The environment administrator's name is reserved (its login is checked before any database account).
        $reservedAdmin = (string)getenv('ADMIN_USER');
        if ($reservedAdmin !== '' && strcasecmp($username, $reservedAdmin) === 0) {
            jsonError('El nombre de usuario ya está registrado', 409);
        }

        $user = DbHelper::registerUser($username, $password, 'user');
        if (!$user) {
            jsonError('El nombre de usuario ya está registrado', 409);
        }

        // Ensure default profile is created for the user in DB
        DbHelper::getUserProfiles($username);

        $tokenPayload = [
            'username' => $username,
            'role' => 'user',
            'exp' => time() + (30 * 24 * 3600)
        ];
        $token = AuthMiddleware::createToken($tokenPayload);
        self::setSessionCookie($token);

        jsonResponse([
            'success' => true,
            'token' => $token,
            'role' => 'user',
            'username' => $username,
            'user' => [
                'username' => $username,
                'role' => 'user'
            ]
        ]);
    }

    public static function logout(): void {
        $isSecure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https')
            || (isset($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443);

        @setcookie('kurastream_token', '', [
            'expires' => time() - 3600,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => $isSecure
        ]);
        unset($_COOKIE['kurastream_token']);

        @setcookie('kurastream_party_session', '', [
            'expires' => time() - 3600,
            'path' => '/api/party',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => $isSecure
        ]);
        unset($_COOKIE['kurastream_party_session']);

        jsonResponse(['success' => true, 'message' => 'Sesión cerrada']);
    }

    /**
     * Set HttpOnly session cookie for web streaming elements and browser navigation.
     * 
     * Note on Web JWT Dual Storage (Known Architecture Limitation):
     * The token is returned in JSON payloads (persisted in client localStorage for Authorization: Bearer headers)
     * AND simultaneously written to an HttpOnly cookie 'kurastream_token' (for native <video> streaming elements).
     * A planned future refactor will decouple these or move fully to HttpOnly session tokens with CSRF protections.
     */
    private static function setSessionCookie(string $token): void {
        $isSecure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https')
            || (isset($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443);

        @setcookie('kurastream_token', $token, [
            'expires' => time() + (30 * 24 * 3600),
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => $isSecure
        ]);
        $_COOKIE['kurastream_token'] = $token;
    }

    public static function getProfiles(): void {
        $authUser = AuthMiddleware::requireAuth();
        $username = $authUser['username'];
        $profiles = DbHelper::getUserProfiles($username);
        jsonResponse(['success' => true, 'profiles' => $profiles]);
    }

    /** A kids session must not manage profiles, or it could simply turn its own kids mode off. */
    private static function denyKidsSession(array $authUser): void {
        if (!empty($authUser['is_kids'])) {
            jsonError('Los perfiles infantiles no pueden administrar perfiles', 403);
        }
    }

    private static function issueProfileToken(array $authUser, array $profile): string {
        $token = AuthMiddleware::createToken([
            'username' => $authUser['username'],
            'role' => $authUser['role'] ?? 'user',
            'profile_id' => $profile['id'],
            'profile_name' => $profile['name'],
            'is_kids' => (bool)$profile['is_kids'],
            'ver' => (int)($authUser['ver'] ?? 0),
            'exp' => time() + (30 * 24 * 3600)
        ]);
        self::setSessionCookie($token);
        return $token;
    }

    /**
     * Fresh session token for the current device after its account's token_version changed, keeping the
     * active profile. Every other token issued before the change stops working.
     */
    private static function reissueAfterRevocation(array $authUser, string $canonicalUsername, int $newVersion): string {
        $payload = [
            'username' => $canonicalUsername,
            'role' => $authUser['role'] ?? 'user',
            'ver' => $newVersion,
            'exp' => time() + (30 * 24 * 3600)
        ];
        foreach (['profile_id', 'profile_name', 'is_kids'] as $claim) {
            if (isset($authUser[$claim])) {
                $payload[$claim] = $authUser[$claim];
            }
        }
        $token = AuthMiddleware::createToken($payload);
        self::setSessionCookie($token);
        return $token;
    }

    /** The database account behind a session; the environment administrator has none and cannot use these endpoints. */
    private static function requireDatabaseAccount(array $authUser): array {
        $account = DbHelper::getUser((string)($authUser['username'] ?? ''));
        if (!$account) {
            jsonError('Esta cuenta se administra en la configuración del servidor (ADMIN_USER / ADMIN_PASS_HASH).', 400);
        }
        return $account;
    }

    public static function changePassword(): void {
        $authUser = AuthMiddleware::requireAuth();
        self::denyKidsSession($authUser);
        $account = self::requireDatabaseAccount($authUser);

        $data = Input::json();
        $current = Input::string($data, 'current_password', 1024, false);
        $new = Input::string($data, 'new_password', 1024, false);
        if ($current === '' || $new === '') {
            jsonError('Contraseña actual y nueva requeridas', 400);
        }
        if (strlen($new) < 8 || strlen($new) > 72) {
            jsonError('La nueva contraseña debe tener entre 8 y 72 caracteres', 400);
        }
        if (hash_equals($current, $new)) {
            jsonError('La nueva contraseña debe ser distinta de la actual', 400);
        }

        // Guessing the current password through a stolen session must be as hard as guessing a login.
        $limiterKey = 'pwchange_' . strtolower($account['username']);
        RateLimiter::enforceKey($limiterKey, 5, 900, 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.');
        if (!password_verify($current, (string)$account['password_hash'])) {
            jsonError('La contraseña actual es incorrecta', 403);
        }
        RateLimiter::clear($limiterKey);

        $version = DbHelper::replacePasswordHash($account['username'], password_hash($new, PASSWORD_BCRYPT));
        $token = self::reissueAfterRevocation($authUser, $account['username'], $version);
        jsonResponse(['success' => true, 'token' => $token, 'message' => 'Contraseña actualizada. Se cerró la sesión en los demás dispositivos.']);
    }

    public static function logoutAll(): void {
        $authUser = AuthMiddleware::requireAuth();
        $account = self::requireDatabaseAccount($authUser);

        $version = DbHelper::bumpTokenVersion($account['username']);
        $token = self::reissueAfterRevocation($authUser, $account['username'], $version);
        jsonResponse(['success' => true, 'token' => $token, 'message' => 'Se cerró la sesión en los demás dispositivos.']);
    }

    public static function saveProfile(): void {
        $authUser = AuthMiddleware::requireAuth();
        self::denyKidsSession($authUser);
        $username = $authUser['username'];

        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $profile = DbHelper::saveUserProfile($username, $data);
        $response = ['success' => true, 'profile' => $profile];
        // Editing the active profile: the session token carries its name and kids flag, so reissue it.
        if (!empty($authUser['profile_id']) && $authUser['profile_id'] === $profile['id']) {
            $response['token'] = self::issueProfileToken($authUser, $profile);
        }
        jsonResponse($response);
    }

    public static function selectProfile(): void {
        $authUser = AuthMiddleware::requireAuth();
        $username = $authUser['username'];

        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $profileId = trim((string)($data['profile_id'] ?? ($data['id'] ?? '')));
        $profileName = trim((string)($data['profile_name'] ?? ''));
        $pin = trim((string)($data['pin'] ?? ''));

        if (empty($profileId) && empty($profileName)) {
            jsonError('profile_id o profile_name requerido', 400);
        }

        $db = Database::getConnection();
        if (!empty($profileId)) {
            $stmt = $db->prepare("SELECT * FROM user_profiles WHERE id = :id AND username = :u");
            $stmt->execute(['id' => $profileId, 'u' => $username]);
        } else {
            $stmt = $db->prepare("SELECT * FROM user_profiles WHERE name = :p AND username = :u");
            $stmt->execute(['p' => $profileName, 'u' => $username]);
        }
        $profile = $stmt->fetch();

        if (!$profile) {
            jsonError('Perfil no encontrado o no pertenece a este usuario', 404);
        }

        if (!empty($profile['pin'])) {
            // Every guess counts (a 4-digit PIN has only 10,000 values); a correct PIN resets the allowance.
            RateLimiter::consumePinAttempt($username, (string)$profile['id']);
            if (empty($pin) || !password_verify($pin, $profile['pin'])) {
                jsonError('PIN incorrecto', 403);
            }
            RateLimiter::clearPinAttempts($username, (string)$profile['id']);
        }

        $token = self::issueProfileToken($authUser, $profile);

        // Clear active party session on profile switch to avoid incompatible party session
        $isSecure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https');
        @setcookie('kurastream_party_session', '', [
            'expires' => time() - 3600,
            'path' => '/api/party',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => $isSecure
        ]);
        unset($_COOKIE['kurastream_party_session']);

        jsonResponse([
            'success' => true,
            'token' => $token,
            'profile' => DbHelper::sanitizeProfileForClient($profile)
        ]);
    }

    public static function deleteProfile(string $id, string $pin = ''): void {
        $authUser = AuthMiddleware::requireAuth();
        self::denyKidsSession($authUser);
        $username = $authUser['username'];

        $success = DbHelper::deleteUserProfile($username, $id, $pin);
        jsonResponse(['success' => $success]);
    }
}
