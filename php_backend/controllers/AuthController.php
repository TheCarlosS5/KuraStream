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

        if (!empty($adminUser) && $username === $adminUser) {
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
                $up = $db->prepare("UPDATE users SET password_hash = :p WHERE username = :u");
                $up->execute(['p' => $newHash, 'u' => $username]);
            }

            if ($isPassValid) {
                $tokenPayload = [
                    'username' => $username,
                    'role' => $user['role'] ?? 'user',
                    'exp' => time() + (30 * 24 * 3600)
                ];
                $token = AuthMiddleware::createToken($tokenPayload);

                jsonResponse([
                    'success' => true,
                    'token' => $token,
                    'role' => $user['role'] ?? 'user',
                    'username' => $username
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

        if (strlen($username) < 3) {
            jsonError('El nombre de usuario debe tener al menos 3 caracteres', 400);
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

        jsonResponse([
            'success' => true,
            'token' => $token,
            'role' => 'user',
            'username' => $username
        ]);
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

    public static function deleteProfile(string $id): void {
        $authUser = AuthMiddleware::requireAuth();
        $username = $authUser['username'];

        $success = DbHelper::deleteUserProfile($username, $id);
        jsonResponse(['success' => $success]);
    }
}
