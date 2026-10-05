<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/../php_backend/controllers/AuthController.php';
require_once __DIR__ . '/helpers/http_server.php';

echo "Running session token type, revocation and account-state tests...\n";

function sr_status(callable $fn): ?int {
    ob_start();
    try { $fn(); } catch (ExitException $e) { ob_end_clean(); return $e->statusCode; }
    ob_end_clean();
    return null;
}
function sr_session(string $username, array $extra = []): string {
    return AuthMiddleware::createToken(array_merge(['username' => $username, 'role' => 'user', 'exp' => time() + 3600], $extra));
}
function sr_withBearer(string $token, callable $fn) {
    $_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$token}";
    try { return $fn(); } finally { unset($_SERVER['HTTP_AUTHORIZATION']); }
}

$db = Database::getConnection();
$suffix = bin2hex(random_bytes(3));
$user = "sr_user_$suffix";
$parent = "sr_parent_$suffix";
$createdUsers = [$user, $parent];
$origAdmin = getenv('ADMIN_USER');
$restoreAdmin = function () use ($origAdmin) { if ($origAdmin !== false) putenv("ADMIN_USER=$origAdmin"); else putenv('ADMIN_USER'); };
$server = null;

try {
    DbHelper::registerUser($user, 'a_long_password_1', 'user');
    DbHelper::registerUser($parent, 'a_long_password_2', 'user');

    // 1. Party tickets share the signing key but are never a session
    foreach (['watch_party_stream', 'party_sse'] as $type) {
        $ticket = AuthMiddleware::createToken(['type' => $type, 'room_id' => 'ROOM1', 'member_id' => 'mem_1', 'username' => $user, 'role' => 'admin', 'exp' => time() + 60]);
        assert(AuthMiddleware::sessionPayload($ticket) === null, "A $type ticket must not be a session");
        assert(sr_status(fn() => sr_withBearer($ticket, fn() => AuthMiddleware::requireAuth())) === 401, "requireAuth must refuse a $type ticket");
        assert(sr_status(fn() => sr_withBearer($ticket, fn() => AuthMiddleware::requireAdmin())) === 401, "requireAdmin must refuse a $type ticket even with role=admin");
    }
    assert(AuthMiddleware::sessionPayload(sr_session($user)) !== null, 'A token issued before this change (no type, no ver) keeps working');
    assert(AuthMiddleware::sessionPayload(sr_session($user, ['type' => 'session'])) !== null, 'type=session is accepted');
    echo "✓ Watch Party tickets are never accepted as a session OK\n";

    // 2. Account must exist (strict mode is on in production, opt-in here)
    $ghost = sr_session("sr_ghost_$suffix");
    AuthMiddleware::$strictAccounts = false;
    assert(AuthMiddleware::sessionPayload($ghost) !== null, 'Test mode keeps accepting tokens for accounts that were never created');
    AuthMiddleware::$strictAccounts = true;
    assert(AuthMiddleware::sessionPayload($ghost) === null, 'Strict mode refuses a token whose account does not exist');
    assert(sr_status(fn() => sr_withBearer($ghost, fn() => AuthMiddleware::requireAuth())) === 401, 'requireAuth answers 401 for a deleted/unknown account');

    $forgedAdmin = sr_session("sr_nobody_$suffix", ['role' => 'admin']);
    assert(sr_status(fn() => sr_withBearer($forgedAdmin, fn() => AuthMiddleware::requireAdmin())) === 401, 'A signed admin token for an unknown account is refused');
    echo "✓ Deleted / unknown accounts are refused in strict mode OK\n";

    // 3. Role comes from the database, not from the token
    $claimsAdmin = sr_session($user, ['role' => 'admin']);
    assert(sr_status(fn() => sr_withBearer($claimsAdmin, fn() => AuthMiddleware::requireAdmin())) === 403, 'role=admin in the token must not make a database "user" an admin');
    $db->prepare("UPDATE users SET role = 'admin' WHERE username = :u")->execute(['u' => $user]);
    assert(sr_status(fn() => sr_withBearer(sr_session($user), fn() => AuthMiddleware::requireAdmin())) === null, 'Promoting the account takes effect immediately');
    $db->prepare("UPDATE users SET role = 'user' WHERE username = :u")->execute(['u' => $user]);
    assert(sr_status(fn() => sr_withBearer(sr_session($user, ['role' => 'admin']), fn() => AuthMiddleware::requireAdmin())) === 403, 'Demoting the account takes effect immediately');

    putenv("ADMIN_USER=sr_envadmin_$suffix");
    $envAdmin = sr_session("sr_envadmin_$suffix", ['role' => 'admin']);
    assert(sr_status(fn() => sr_withBearer($envAdmin, fn() => AuthMiddleware::requireAdmin())) === null, 'The environment administrator needs no database row');
    putenv('ADMIN_USER');
    assert(sr_status(fn() => sr_withBearer($envAdmin, fn() => AuthMiddleware::requireAdmin())) === 401, 'Without ADMIN_USER configured that token is just an unknown account');
    $restoreAdmin();
    echo "✓ Role is read from the database; env admin still works OK\n";

    // 4. token_version revokes older sessions
    $legacy = sr_session($user);
    assert(AuthMiddleware::sessionPayload($legacy) !== null, 'Version 0 account accepts a token without ver');
    $v1 = DbHelper::bumpTokenVersion($user);
    assert($v1 === 1, 'bumpTokenVersion returns the new version');
    assert(AuthMiddleware::sessionPayload($legacy) === null, 'A token issued before the bump is revoked');
    assert(AuthMiddleware::sessionPayload(sr_session($user, ['ver' => 0])) === null, 'An explicit older version is revoked');
    assert(AuthMiddleware::sessionPayload(sr_session($user, ['ver' => 1])) !== null, 'A token carrying the new version is accepted');
    assert(AuthMiddleware::sessionPayload(sr_session($user, ['ver' => 2])) === null, 'A token claiming a FUTURE version is refused too');
    echo "✓ token_version revokes older sessions OK\n";

    // 5. Profile name / kids flag are re-read on every request
    $profile = DbHelper::saveUserProfile($parent, ['name' => 'Hijo']);
    $kidToken = sr_session($parent, ['profile_id' => $profile['id'], 'profile_name' => 'Hijo', 'is_kids' => false]);
    $payload = AuthMiddleware::sessionPayload($kidToken);
    assert($payload['is_kids'] === false, 'Starts as an adult profile');
    $db->prepare("UPDATE user_profiles SET is_kids = 1 WHERE id = :id")->execute(['id' => $profile['id']]);
    $payload = AuthMiddleware::sessionPayload($kidToken);
    assert($payload['is_kids'] === true, 'Enabling kids mode applies to sessions that already exist (other devices)');
    $db->prepare("UPDATE user_profiles SET name = 'Hijo Renombrado' WHERE id = :id")->execute(['id' => $profile['id']]);
    assert(AuthMiddleware::sessionPayload($kidToken)['profile_name'] === 'Hijo Renombrado', 'A renamed profile is seen under its current name');
    $db->prepare("DELETE FROM user_profiles WHERE id = :id")->execute(['id' => $profile['id']]);
    $payload = AuthMiddleware::sessionPayload($kidToken);
    assert($payload !== null && empty($payload['profile_id']) && empty($payload['profile_name']) && !isset($payload['is_kids']),
        'A deleted profile leaves the session without an active profile');
    assert(sr_status(fn() => sr_withBearer($kidToken, fn() => AuthMiddleware::requireProfile())) === 403, 'requireProfile then asks for a profile (403 PROFILE_REQUIRED)');
    AuthMiddleware::$strictAccounts = null;
    echo "✓ Profile name and kids flag are refreshed from the database OK\n";

    // 6. Endpoints through the real router
    RateLimiter::clear('auth_127.0.0.1');
    $envAdminName = "sr_envadmin2_$suffix";
    [$server, $port] = kura_start_server(['ADMIN_USER' => $envAdminName, 'ADMIN_PASS_HASH' => password_hash('env_admin_pass_9', PASSWORD_BCRYPT), 'ADMIN_PASS' => '']);
    $web = "sr_web_$suffix";
    $createdUsers[] = $web;

    [$code, , $json] = kura_http($port, 'POST', '/api/register', ['username' => $web, 'password' => 'first_password_1']);
    assert($code === 200 && !empty($json['token']), "register must work (got $code)");
    $t1 = $json['token'];
    [$code, , $json] = kura_http($port, 'POST', '/api/login', ['username' => $web, 'password' => 'first_password_1']);
    assert($code === 200, "second device login must work (got $code)");
    $t2 = $json['token'];
    assert(kura_http($port, 'GET', '/api/profiles', null, $t2)[0] === 200, 'Both sessions work before the change');

    $ticket = AuthMiddleware::createToken(['type' => 'watch_party_stream', 'room_id' => 'ROOM1', 'member_id' => 'mem_x', 'username' => $web, 'exp' => time() + 60]);
    assert(kura_http($port, 'GET', '/api/profiles', null, $ticket)[0] === 401, 'A Watch Party ticket must not open /api/profiles');

    [$code] = kura_http($port, 'POST', '/api/account/password', ['current_password' => 'wrong_password_1', 'new_password' => 'second_password_2'], $t1);
    assert($code === 403, "Wrong current password -> 403 (got $code)");
    [$code] = kura_http($port, 'POST', '/api/account/password', ['current_password' => 'first_password_1', 'new_password' => 'short'], $t1);
    assert($code === 400, "Too short new password -> 400 (got $code)");
    [$code] = kura_http($port, 'POST', '/api/account/password', ['current_password' => 'first_password_1', 'new_password' => str_repeat('x', 73)], $t1);
    assert($code === 400, "New password over 72 bytes -> 400 (got $code)");
    [$code] = kura_http($port, 'POST', '/api/account/password', ['current_password' => 'first_password_1', 'new_password' => 'first_password_1'], $t1);
    assert($code === 400, "Same password -> 400 (got $code)");
    [$code] = kura_http($port, 'POST', '/api/account/password', ['current_password' => ['x'], 'new_password' => 'second_password_2'], $t1);
    assert($code === 400, "Non-string password -> 400 (got $code)");
    assert(kura_http($port, 'POST', '/api/account/password', ['current_password' => 'first_password_1', 'new_password' => 'second_password_2'])[0] === 401, 'Changing the password needs a session');

    [$code, , $json] = kura_http($port, 'POST', '/api/account/password', ['current_password' => 'first_password_1', 'new_password' => 'second_password_2'], $t1);
    assert($code === 200 && !empty($json['token']), "Password change must succeed (got $code)");
    $t3 = $json['token'];
    assert(kura_http($port, 'GET', '/api/profiles', null, $t1)[0] === 401, 'The session that changed the password is replaced by a new token');
    assert(kura_http($port, 'GET', '/api/profiles', null, $t2)[0] === 401, 'Other devices are signed out after a password change');
    assert(kura_http($port, 'GET', '/api/profiles', null, $t3)[0] === 200, 'The new token works');
    assert(kura_http($port, 'POST', '/api/login', ['username' => $web, 'password' => 'first_password_1'])[0] === 401, 'The old password no longer logs in');
    [$code, , $json] = kura_http($port, 'POST', '/api/login', ['username' => $web, 'password' => 'second_password_2']);
    assert($code === 200, "The new password logs in (got $code)");
    $t4 = $json['token'];

    [$code, , $json] = kura_http($port, 'POST', '/api/account/logout-all', [], $t3);
    assert($code === 200 && !empty($json['token']), "logout-all must succeed (got $code)");
    $t5 = $json['token'];
    assert(kura_http($port, 'GET', '/api/profiles', null, $t3)[0] === 401 && kura_http($port, 'GET', '/api/profiles', null, $t4)[0] === 401, 'logout-all signs out every other token (and the one used)');
    assert(kura_http($port, 'GET', '/api/profiles', null, $t5)[0] === 200, 'logout-all keeps the calling device signed in via its fresh token');
    echo "✓ HTTP: password change and logout-all revoke other sessions OK\n";

    // brute-forcing the current password through a stolen session is limited
    RateLimiter::clear('pwchange_' . strtolower($web));
    for ($i = 1; $i <= 5; $i++) {
        [$code] = kura_http($port, 'POST', '/api/account/password', ['current_password' => "guess_number_$i", 'new_password' => 'third_password_3'], $t5);
        assert($code === 403, "Wrong guess #$i -> 403 (got $code)");
    }
    [$code] = kura_http($port, 'POST', '/api/account/password', ['current_password' => 'second_password_2', 'new_password' => 'third_password_3'], $t5);
    assert($code === 429, "6th attempt is locked out even with the right password (got $code)");
    RateLimiter::clear('pwchange_' . strtolower($web));
    echo "✓ HTTP: current-password guessing is rate limited OK\n";

    // kids sessions cannot change the password
    [$code, , $json] = kura_http($port, 'POST', '/api/profiles', ['name' => 'Peque', 'is_kids' => true], $t5);
    assert($code === 200, "kids profile creation (got $code)");
    [$code, , $json] = kura_http($port, 'POST', '/api/profiles/select', ['profile_id' => $json['profile']['id']], $t5);
    assert($code === 200 && !empty($json['token']), 'selecting the kids profile');
    [$code] = kura_http($port, 'POST', '/api/account/password', ['current_password' => 'second_password_2', 'new_password' => 'third_password_3'], $json['token']);
    assert($code === 403, "A kids session cannot change the password (got $code)");
    echo "✓ HTTP: kids sessions cannot change the password OK\n";

    // environment administrator has no database account
    [$code, , $json] = kura_http($port, 'POST', '/api/login', ['username' => $envAdminName, 'password' => 'env_admin_pass_9']);
    assert($code === 200 && ($json['role'] ?? '') === 'admin', "env admin login (got $code)");
    $adminToken = $json['token'];
    assert(kura_http($port, 'GET', '/api/admin/stats', null, $adminToken)[0] === 200, 'env admin token passes the strict check');
    assert(kura_http($port, 'POST', '/api/account/password', ['current_password' => 'env_admin_pass_9', 'new_password' => 'another_pass_77'], $adminToken)[0] === 400, 'env admin cannot change its password here');
    assert(kura_http($port, 'POST', '/api/account/logout-all', [], $adminToken)[0] === 400, 'env admin cannot use logout-all');
    echo "✓ HTTP: environment administrator behaviour OK\n";
} finally {
    AuthMiddleware::$strictAccounts = null;
    kura_stop_server($server);
    $restoreAdmin();
    foreach ($createdUsers as $u) {
        $db->prepare("DELETE FROM user_profiles WHERE username = :u")->execute(['u' => $u]);
        $db->prepare("DELETE FROM users WHERE username = :u")->execute(['u' => $u]);
    }
    RateLimiter::clear('auth_127.0.0.1');
}

echo "All session revocation tests passed.\n";
