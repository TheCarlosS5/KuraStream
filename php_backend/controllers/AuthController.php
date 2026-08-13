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

        // Environment admin credentials
        $adminUser = getenv('ADMIN_USER') ?: 'admin';
        $adminPass = getenv('ADMIN_PASS') ?: 'Carlos2009';

        if (($username === $adminUser || $username === 'TheCarlosS5' || $username === 'admin') && 
            ($password === $adminPass || password_verify($password, password_hash($adminPass, PASSWORD_BCRYPT)))) {
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

        // DB user credentials check
        $user = DbHelper::getUser($username);
        if ($user && password_verify($password, $user['password_hash'])) {
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
