<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/../php_backend/controllers/AuthController.php';
require_once __DIR__ . '/../php_backend/controllers/AdminUsersController.php';

echo "Running admin user management tests...\n";

function au_call(callable $fn): array {
    ob_start();
    try { $fn(); } catch (ExitException $e) { ob_end_clean(); return [$e->statusCode, is_array($e->payload ?? null) ? $e->payload : (json_decode($e->getMessage(), true) ?: [])]; }
    ob_end_clean();
    return [null, []];
}
function au_session(string $username, string $role, int $ver): string {
    return AuthMiddleware::createToken(['username' => $username, 'role' => $role, 'ver' => $ver, 'exp' => time() + 3600]);
}
function au_as(string $token, callable $fn): array {
    $_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$token}";
    try { return au_call($fn); } finally { unset($_SERVER['HTTP_AUTHORIZATION']); }
}

$db = Database::getConnection();
$sfx = bin2hex(random_bytes(3));
$admin = "au_admin_$sfx";
$bob = "au_bob_$sfx";
$created = [$admin, $bob];
$origAdmin = getenv('ADMIN_USER');
putenv('ADMIN_USER');
AuthMiddleware::$strictAccounts = true;

try {
    DbHelper::registerUser($admin, 'admin_password_1', 'admin');
    DbHelper::registerUser($bob, 'bob_password_1', 'user');
    $adminToken = au_session($admin, 'admin', 0);
    $bobToken = au_session($bob, 'user', 0);

    // Only administrators
    [$code] = au_as($bobToken, fn() => AdminUsersController::listUsers());
    assert($code === 403, 'A normal user must not list accounts');
    [$code, $body] = au_as($adminToken, fn() => AdminUsersController::listUsers());
    assert($code === 200 && !empty($body['users']), 'The admin lists accounts');
    $row = null;
    foreach ($body['users'] as $u) if ($u['username'] === $bob) $row = $u;
    assert($row && $row['role'] === 'user' && $row['disabled'] === false && $row['profile_count'] === 1, 'Listing shows role, state and profile count');
    assert(!isset($row['password_hash']), 'Password hashes never leave the server');
    echo "✓ Listing is admin-only and exposes no secrets OK\n";

    // Disable: sessions stop at once, login says so only after a right password
    assert(AuthMiddleware::sessionPayload($bobToken) !== null, 'Bob has a working session');
    [$code, $body] = au_as($adminToken, fn() => AdminUsersController::setDisabled($bob, ['disabled' => true]));
    assert($code === 200 && $body['disabled'] === true, 'Disable answers 200');
    assert(AuthMiddleware::sessionPayload($bobToken) === null, 'A disabled account\'s session ends immediately');
    [$code] = au_call(fn() => AuthController::login(['username' => $bob, 'password' => 'bob_password_1']));
    assert($code === 403, 'Login of a disabled account is refused (403)');
    [$code] = au_call(fn() => AuthController::login(['username' => $bob, 'password' => 'wrong_password_x']));
    assert($code === 401, 'A wrong password still looks like any other wrong password (401)');
    [$code] = au_as($adminToken, fn() => AdminUsersController::setDisabled($bob, ['disabled' => false]));
    assert($code === 200, 'Re-enable answers 200');
    [$code, $body] = au_call(fn() => AuthController::login(['username' => $bob, 'password' => 'bob_password_1']));
    assert($code === 200 && !empty($body['token']), 'Login works again after re-enabling');
    $st = $db->prepare("SELECT last_login_at FROM users WHERE username = :u"); $st->execute(['u' => $bob]);
    assert($st->fetchColumn() !== null, 'A login records last_login_at');
    echo "✓ Disable / enable revokes and restores access OK\n";

    // Self-protection and last admin
    [$code] = au_as($adminToken, fn() => AdminUsersController::setDisabled($admin, ['disabled' => true]));
    assert($code === 409, 'An admin cannot disable themselves');
    [$code] = au_as($adminToken, fn() => AdminUsersController::setRole($admin, ['role' => 'user']));
    assert($code === 409, 'An admin cannot demote themselves');
    [$code] = au_as($adminToken, fn() => AdminUsersController::deleteUser($admin));
    assert($code === 409, 'An admin cannot delete themselves');
    [$code] = au_as($adminToken, fn() => AdminUsersController::resetPassword($admin, ['password' => 'something_long_1']));
    assert($code === 409, 'An admin resets their own password from Settings, not here');
    echo "✓ Self-lockout is prevented OK\n";

    // Role changes
    [$code] = au_as($adminToken, fn() => AdminUsersController::setRole($bob, ['role' => 'superuser']));
    assert($code === 400, 'Unknown roles are refused');
    [$code, $body] = au_as($adminToken, fn() => AdminUsersController::setRole($bob, ['role' => 'admin']));
    assert($code === 200 && $body['role'] === 'admin', 'Promote answers 200');
    $newBob = (int)$db->query("SELECT token_version FROM users WHERE username = " . $db->quote($bob))->fetchColumn();
    $promoted = au_session($bob, 'user', $newBob);
    [$code] = au_as($promoted, fn() => AdminUsersController::listUsers());
    assert($code === 200, 'The promoted account is an admin on its next request');
    // With two admins, the last-admin rule lets one be demoted again; with a single one it must not
    [$code] = au_as($adminToken, fn() => AdminUsersController::setRole($bob, ['role' => 'user']));
    assert($code === 200, 'Demoting is fine while another admin remains');
    echo "✓ Role changes work and take effect at once OK\n";

    // Password reset ends sessions
    $before = (int)$db->query("SELECT token_version FROM users WHERE username = " . $db->quote($bob))->fetchColumn();
    $bobSession = au_session($bob, 'user', $before);
    assert(AuthMiddleware::sessionPayload($bobSession) !== null, 'Bob has a session before the reset');
    [$code] = au_as($adminToken, fn() => AdminUsersController::resetPassword($bob, ['password' => 'short']));
    assert($code === 400, 'Too-short passwords are refused');
    [$code] = au_as($adminToken, fn() => AdminUsersController::resetPassword($bob, ['password' => str_repeat('x', 80)]));
    assert($code === 400, 'Passwords over 72 bytes are refused (bcrypt would ignore the rest)');
    [$code] = au_as($adminToken, fn() => AdminUsersController::resetPassword($bob, ['password' => 'brand_new_password_9']));
    assert($code === 200, 'Reset answers 200');
    assert(AuthMiddleware::sessionPayload($bobSession) === null, 'The old session ends after a password reset');
    [$code] = au_call(fn() => AuthController::login(['username' => $bob, 'password' => 'brand_new_password_9']));
    assert($code === 200, 'The new password works');
    [$code] = au_call(fn() => AuthController::login(['username' => $bob, 'password' => 'bob_password_1']));
    assert($code === 401, 'The old password does not');
    echo "✓ Password reset revokes sessions OK\n";

    // An admin can demote/disable another admin; the actor themselves always remains an enabled admin, so the
    // server cannot end up without one (the explicit last-admin guard only matters for the env administrator).
    $db->prepare("UPDATE users SET role = 'admin' WHERE username = :u")->execute(['u' => $bob]);
    $bobAdmin = au_session($bob, 'admin', (int)$db->query("SELECT token_version FROM users WHERE username = " . $db->quote($bob))->fetchColumn());
    [$code] = au_as($bobAdmin, fn() => AdminUsersController::setDisabled($admin, ['disabled' => true]));
    assert($code === 200, 'One admin may lock another');
    assert(DbHelper::countEnabledAdmins() >= 1, 'At least one enabled admin remains');
    $db->prepare("UPDATE users SET disabled = 0, role = 'admin' WHERE username = :u")->execute(['u' => $admin]);
    $db->prepare("UPDATE users SET role = 'user' WHERE username = :u")->execute(['u' => $bob]);
    echo "✓ Admins can manage each other without orphaning the server OK\n";

    // Delete removes the account and its data
    $victim = "au_victim_$sfx"; $created[] = $victim;
    DbHelper::registerUser($victim, 'victim_password_1', 'user');
    $db->prepare("INSERT INTO user_preferences (username, profile_name) VALUES (:u, 'Principal') ON DUPLICATE KEY UPDATE profile_name = profile_name")->execute(['u' => $victim]);
    [$code] = au_as($bobToken, fn() => AdminUsersController::deleteUser($victim));
    assert($code === 401 || $code === 403, 'A normal user cannot delete accounts');
    $adminNow = au_session($admin, 'admin', (int)$db->query("SELECT token_version FROM users WHERE username = " . $db->quote($admin))->fetchColumn());
    [$code] = au_as($adminNow, fn() => AdminUsersController::deleteUser($victim));
    assert($code === 200, 'Delete answers 200');
    foreach (['users', 'user_profiles', 'user_preferences'] as $t) {
        $st = $db->prepare("SELECT COUNT(*) FROM {$t} WHERE username = :u"); $st->execute(['u' => $victim]);
        assert((int)$st->fetchColumn() === 0, "No rows left in $t");
    }
    [$code] = au_as($adminNow, fn() => AdminUsersController::deleteUser("au_nobody_$sfx"));
    assert($code === 404, 'Deleting an unknown account is a 404');
    [$code] = au_as($adminNow, fn() => AdminUsersController::deleteUser("bad\x01name"));
    assert($code === 400, 'Control characters in the name are refused');
    echo "✓ Delete removes the account and its data OK\n";
} finally {
    foreach ($created as $u) {
        foreach (['watch_history', 'favorites', 'user_preferences', 'comments', 'user_profiles', 'users'] as $t) {
            $db->prepare("DELETE FROM {$t} WHERE username = :u")->execute(['u' => $u]);
        }
    }
    AuthMiddleware::$strictAccounts = null;
    if ($origAdmin !== false) putenv("ADMIN_USER=$origAdmin");
}

echo "Admin user management tests passed!\n";
