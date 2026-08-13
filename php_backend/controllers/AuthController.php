<?php
require_once __DIR__ . '/../config.php';
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

        // Hardcoded admin credential check matching Node.js server
        if (($username === 'TheCarlosS5' || $username === 'admin') && $password === 'Carlos2009') {
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
}
