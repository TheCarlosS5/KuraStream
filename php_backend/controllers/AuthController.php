<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../middleware/AuthMiddleware.php';

class AuthController {
    public static function hashPassword(string $password): string {
        return hash_hmac('sha256', $password, PASSWORD_SALT);
    }

    public static function login(): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $username = trim($data['username'] ?? '');
        $password = $data['password'] ?? '';

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
                $isPassValid = ($password === $adminPass);
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
                    'username' => $username
                ]);
            }
        }

        // DB user credentials check
        $user = DbHelper::getUser($username);
        if ($user) {
            $storedHash = $user['password_hash'] ?? '';
            $isPassValid = false;

            if (password_verify($password, $storedHash)) {
                $isPassValid = true;
            } elseif ($storedHash === hash_hmac('sha256', $password, PASSWORD_SALT) || $storedHash === hash('sha256', $password)) {
                $isPassValid = true;
                // Rehash to secure bcrypt
                $newHash = password_hash($password, PASSWORD_BCRYPT);
                $db = Database::getConnection();
                $up = $db->prepare("UPDATE users SET password_hash = :p WHERE LOWER(username) = LOWER(:u)");
                $up->execute(['p' => $newHash, 'u' => $username]);
            }

            if ($isPassValid) {
                $actualUsername = $user['username'] ?? $username;
                $tokenPayload = [
                    'username' => $actualUsername,
                    'role' => $user['role'] ?? 'user',
                    'exp' => time() + (30 * 24 * 3600)
                ];
                $token = AuthMiddleware::createToken($tokenPayload);
                self::setSessionCookie($token);

                jsonResponse([
                    'success' => true,
                    'token' => $token,
                    'role' => $user['role'] ?? 'user',
                    'username' => $actualUsername
                ]);
            }
        }

        jsonError('Credenciales incorrectas', 401);
    }

    public static function register(): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $username = trim($data['username'] ?? '');
        $password = $data['password'] ?? '';

        if (empty($username) || empty($password)) {
            jsonError('Usuario y contraseña requeridos', 400);
        }

        if (strlen($username) < 3 || strlen($username) > 64) {
            jsonError('El nombre de usuario debe tener entre 3 y 64 caracteres', 400);
        }

        if (strlen($password) < 8 || strlen($password) > 128) {
            jsonError('La contraseña debe tener entre 8 y 128 caracteres', 400);
        }

        $user = DbHelper::registerUser($username, $password, 'user');
        if (!$user) {
            jsonError('El nombre de usuario ya está registrado', 409);
        }

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
            'username' => $username
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

    public static function saveProfile(): void {
        $authUser = AuthMiddleware::requireAuth();
        $username = $authUser['username'];

        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $profile = DbHelper::saveUserProfile($username, $data);
        jsonResponse(['success' => true, 'profile' => $profile]);
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
            if (empty($pin) || !password_verify($pin, $profile['pin'])) {
                jsonError('PIN incorrecto', 403);
            }
        }

        $tokenPayload = [
            'username' => $username,
            'role' => $authUser['role'] ?? 'user',
            'profile_id' => $profile['id'],
            'profile_name' => $profile['name'],
            'is_kids' => (bool)$profile['is_kids'],
            'exp' => time() + (30 * 24 * 3600)
        ];
        $token = AuthMiddleware::createToken($tokenPayload);
        self::setSessionCookie($token);

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

    public static function deleteProfile(string $id): void {
        $authUser = AuthMiddleware::requireAuth();
        $username = $authUser['username'];

        $success = DbHelper::deleteUserProfile($username, $id);
        jsonResponse(['success' => $success]);
    }
}
