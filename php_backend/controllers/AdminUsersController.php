<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../middleware/AuthMiddleware.php';
require_once __DIR__ . '/../middleware/Input.php';

/**
 * Account administration for the admin panel. With open registration the administrator needs to see who has an
 * account, lock out or remove an abuser, hand out a new password and promote a helper, all without touching SQL.
 */
class AdminUsersController {
    private static function actor(): array {
        return AuthMiddleware::requireAdmin();
    }

    private static function sameAccount(array $actor, string $target): bool {
        return strcasecmp((string)($actor['username'] ?? ''), $target) === 0;
    }

    private static function requireTarget(string $username): array {
        $username = trim($username);
        if ($username === '' || strlen($username) > 255 || preg_match('/[\x00-\x1F\x7F]/', $username)) {
            jsonError('Nombre de usuario no válido', 400);
        }
        $account = DbHelper::getUser($username);
        if (!$account) {
            jsonError('Usuario no encontrado', 404);
        }
        return $account;
    }

    /** The last administrator account must never be demoted, locked or deleted (nobody could undo it from the UI). */
    private static function protectLastAdmin(array $account): void {
        if (($account['role'] ?? '') !== 'admin') {
            return;
        }
        $envAdmin = (string)getenv('ADMIN_USER');
        if ($envAdmin !== '') {
            return;   // the environment administrator can always get back in
        }
        if (DbHelper::countEnabledAdmins() <= 1) {
            jsonError('No se puede dejar el servidor sin administradores', 409);
        }
    }

    public static function listUsers(): void {
        self::actor();
        jsonResponse(['success' => true, 'users' => DbHelper::listUsersForAdmin()]);
    }

    public static function setDisabled(string $username, ?array $input = null): void {
        $actor = self::actor();
        $account = self::requireTarget($username);
        $data = $input ?? Input::json();
        $disabled = Input::bool($data, 'disabled', true);

        if ($disabled) {
            if (self::sameAccount($actor, $account['username'])) {
                jsonError('No puedes desactivar tu propia cuenta', 409);
            }
            self::protectLastAdmin($account);
        }
        DbHelper::setUserDisabled($account['username'], $disabled);
        jsonResponse(['success' => true, 'username' => $account['username'], 'disabled' => $disabled]);
    }

    public static function setRole(string $username, ?array $input = null): void {
        $actor = self::actor();
        $account = self::requireTarget($username);
        $data = $input ?? Input::json();
        $role = Input::string($data, 'role', 16);
        if (!in_array($role, ['user', 'admin'], true)) {
            jsonError("El rol debe ser 'user' o 'admin'", 400);
        }
        if ($role !== $account['role']) {
            if (self::sameAccount($actor, $account['username'])) {
                jsonError('No puedes cambiar tu propio rol', 409);
            }
            if ($role !== 'admin') {
                self::protectLastAdmin($account);
            }
            DbHelper::setUserRole($account['username'], $role);
        }
        jsonResponse(['success' => true, 'username' => $account['username'], 'role' => $role]);
    }

    public static function resetPassword(string $username, ?array $input = null): void {
        $actor = self::actor();
        $account = self::requireTarget($username);
        if (self::sameAccount($actor, $account['username'])) {
            jsonError('Para cambiar tu propia contraseña usa Ajustes > Cuenta', 409);
        }
        $data = $input ?? Input::json();
        $password = Input::string($data, 'password', 1024, false);
        if (strlen($password) < 8 || strlen($password) > 72) {
            jsonError('La contraseña debe tener entre 8 y 72 caracteres', 400);
        }
        // Also ends every session the account has open (token_version)
        DbHelper::replacePasswordHash($account['username'], password_hash($password, PASSWORD_BCRYPT));
        jsonResponse(['success' => true, 'username' => $account['username'], 'message' => 'Contraseña restablecida. Se cerraron sus sesiones.']);
    }

    public static function logoutAll(string $username): void {
        self::actor();
        $account = self::requireTarget($username);
        DbHelper::bumpTokenVersion($account['username']);
        jsonResponse(['success' => true, 'username' => $account['username']]);
    }

    public static function deleteUser(string $username): void {
        $actor = self::actor();
        $account = self::requireTarget($username);
        if (self::sameAccount($actor, $account['username'])) {
            jsonError('No puedes eliminar tu propia cuenta', 409);
        }
        self::protectLastAdmin($account);
        DbHelper::deleteUserAccount($account['username']);
        jsonResponse(['success' => true, 'username' => $account['username']]);
    }
}
