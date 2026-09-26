<?php
/**
 * Test Admin Authentication Contract, Environment Credentials & Docker Compose Forwarding
 */

define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/AuthController.php';

echo "Running Admin Authentication Contract & Docker Integration Tests...\n";

// Save original environment to restore after tests
$origAdminUser = getenv('ADMIN_USER');
$origAdminPass = getenv('ADMIN_PASS');
$origAdminPassHash = getenv('ADMIN_PASS_HASH');

$cleanup = function() use ($origAdminUser, $origAdminPass, $origAdminPassHash) {
    if ($origAdminUser !== false) putenv("ADMIN_USER={$origAdminUser}"); else putenv("ADMIN_USER");
    if ($origAdminPass !== false) putenv("ADMIN_PASS={$origAdminPass}"); else putenv("ADMIN_PASS");
    if ($origAdminPassHash !== false) putenv("ADMIN_PASS_HASH={$origAdminPassHash}"); else putenv("ADMIN_PASS_HASH");
};

try {
    // -------------------------------------------------------------------------
    // 1. Test Plaintext ADMIN_USER and ADMIN_PASS Environment Authentication
    // -------------------------------------------------------------------------
    echo "  [1/6] Testing ADMIN_USER & ADMIN_PASS environment auth...\n";
    $testUser = 'ephemeral_admin_' . bin2hex(random_bytes(4));
    $testPass = 'ephemeral_pass_' . bin2hex(random_bytes(8));

    putenv("ADMIN_USER={$testUser}");
    putenv("ADMIN_PASS={$testPass}");
    putenv("ADMIN_PASS_HASH"); // unset hash

    // Correct credentials -> HTTP 200, role=admin, JWT contains role=admin
    $loginSuccess = false;
    $loginData = null;
    try {
        AuthController::login(['username' => $testUser, 'password' => $testPass]);
    } catch (ExitException $e) {
        if ($e->statusCode === 200) {
            $loginSuccess = true;
            $loginData = $e->data;
        }
    }

    assert($loginSuccess === true, "Admin login with valid environment credentials must succeed with HTTP 200");
    assert(($loginData['success'] ?? false) === true, "Response must contain success=true");
    assert(($loginData['role'] ?? '') === 'admin', "Response top-level role must be 'admin'");
    assert(isset($loginData['user']) && is_array($loginData['user']), "Response must contain 'user' object");
    assert(($loginData['user']['role'] ?? '') === 'admin', "Response user.role must be 'admin'");
    assert(strcasecmp($loginData['user']['username'] ?? '', $testUser) === 0, "Response user.username must match admin username");

    // Verify JWT payload
    $token = $loginData['token'] ?? '';
    assert(!empty($token), "Login response must contain a non-empty JWT token");
    $verifiedPayload = AuthMiddleware::verifyToken($token);
    assert($verifiedPayload !== null, "JWT token must be cryptographically verifiable with JWT_SECRET");
    assert(($verifiedPayload['role'] ?? '') === 'admin', "JWT payload must contain role='admin'");
    assert(strcasecmp($verifiedPayload['username'] ?? '', $testUser) === 0, "JWT payload username must match admin username");
    echo "    -> Valid ADMIN_USER/PASS verified (role=admin, JWT verified)\n";

    // -------------------------------------------------------------------------
    // 2. Test Incorrect Password -> 401
    // -------------------------------------------------------------------------
    echo "  [2/6] Testing invalid admin password handling...\n";
    $wrongPassCaught = false;
    try {
        AuthController::login(['username' => $testUser, 'password' => 'wrong_password_attempt']);
    } catch (ExitException $e) {
        if ($e->statusCode === 401) {
            $wrongPassCaught = true;
        }
    }
    assert($wrongPassCaught === true, "Incorrect admin password must return HTTP 401");
    echo "    -> Invalid password correctly rejected with 401\n";

    // -------------------------------------------------------------------------
    // 3. Test Different Username -> Must Not Receive Admin Role
    // -------------------------------------------------------------------------
    echo "  [3/6] Testing different username does not receive admin role...\n";
    $otherUserRejected = false;
    try {
        AuthController::login(['username' => 'regular_' . $testUser, 'password' => $testPass]);
    } catch (ExitException $e) {
        if ($e->statusCode === 401) {
            $otherUserRejected = true;
        }
    }
    assert($otherUserRejected === true, "Different username must not match environment admin credentials");
    echo "    -> Non-admin username rejected\n";

    // -------------------------------------------------------------------------
    // 4. Test ADMIN_PASS_HASH (bcrypt)
    // -------------------------------------------------------------------------
    echo "  [4/6] Testing ADMIN_PASS_HASH (bcrypt) environment auth...\n";
    $hashUser = 'hash_admin_' . bin2hex(random_bytes(4));
    $hashPass = 'secure_hash_pass_' . bin2hex(random_bytes(8));
    $bcryptHash = password_hash($hashPass, PASSWORD_BCRYPT);

    putenv("ADMIN_USER={$hashUser}");
    putenv("ADMIN_PASS"); // unset plaintext
    putenv("ADMIN_PASS_HASH={$bcryptHash}");

    $hashSuccess = false;
    $hashData = null;
    try {
        AuthController::login(['username' => $hashUser, 'password' => $hashPass]);
    } catch (ExitException $e) {
        if ($e->statusCode === 200) {
            $hashSuccess = true;
            $hashData = $e->data;
        }
    }
    assert($hashSuccess === true, "Admin login with valid ADMIN_PASS_HASH must succeed with HTTP 200");
    assert(($hashData['role'] ?? '') === 'admin', "Response role must be 'admin'");
    assert(($hashData['user']['role'] ?? '') === 'admin', "Response user.role must be 'admin'");

    $hashFailCaught = false;
    try {
        AuthController::login(['username' => $hashUser, 'password' => 'incorrect_' . $hashPass]);
    } catch (ExitException $e) {
        if ($e->statusCode === 401) {
            $hashFailCaught = true;
        }
    }
    assert($hashFailCaught === true, "Invalid password against ADMIN_PASS_HASH must return HTTP 401");
    echo "    -> ADMIN_PASS_HASH verified (bcrypt verify and rejection OK)\n";

    // -------------------------------------------------------------------------
    // 5. Test Precedence: ADMIN_PASS_HASH takes precedence over ADMIN_PASS
    // -------------------------------------------------------------------------
    echo "  [5/6] Testing ADMIN_PASS_HASH precedence over ADMIN_PASS...\n";
    $pass1 = 'plaintext_pass';
    $pass2 = 'hash_pass';
    putenv("ADMIN_USER={$hashUser}");
    putenv("ADMIN_PASS={$pass1}");
    putenv("ADMIN_PASS_HASH=" . password_hash($pass2, PASSWORD_BCRYPT));

    // pass2 (hash) should succeed
    $hashWon = false;
    try {
        AuthController::login(['username' => $hashUser, 'password' => $pass2]);
    } catch (ExitException $e) {
        if ($e->statusCode === 200) $hashWon = true;
    }
    assert($hashWon === true, "When both ADMIN_PASS_HASH and ADMIN_PASS exist, ADMIN_PASS_HASH must win");

    // pass1 (plaintext) should fail because hash takes precedence
    $plainLost = false;
    try {
        AuthController::login(['username' => $hashUser, 'password' => $pass1]);
    } catch (ExitException $e) {
        if ($e->statusCode === 401) $plainLost = true;
    }
    assert($plainLost === true, "Plaintext ADMIN_PASS must not authenticate when ADMIN_PASS_HASH is set");
    echo "    -> Precedence confirmed: ADMIN_PASS_HASH wins\n";

    // -------------------------------------------------------------------------
    // 6. Test Docker Compose Forwarding Configuration
    // -------------------------------------------------------------------------
    echo "  [6/6] Testing docker-compose.yml environment forwarding contract...\n";
    $composePath = __DIR__ . '/../docker-compose.yml';
    assert(file_exists($composePath), "docker-compose.yml must exist");
    $composeContent = file_get_contents($composePath);

    $requiredForwards = [
        'ADMIN_USER',
        'ADMIN_PASS',
        'ADMIN_PASS_HASH',
        'TMDB_API_KEY',
        'ALLOWED_ORIGINS',
        'TRUSTED_PROXIES'
    ];

    foreach ($requiredForwards as $envVar) {
        assert(
            preg_match("/-\s+{$envVar}=\\\$\{{$envVar}[:-]/", $composeContent) === 1,
            "docker-compose.yml must explicitly forward {$envVar} to kurastream container"
        );
    }
    // -------------------------------------------------------------------------
    // 7. Admin Security Matrix: Enforce Admin Role Boundary
    // -------------------------------------------------------------------------
    echo "  [7/7] Testing Admin Security Matrix (Unauth -> 401, User -> 403, Admin -> Allowed)...\n";
    // Unauth
    unset($_SERVER['HTTP_AUTHORIZATION'], $_SERVER['Authorization'], $_COOKIE['kurastream_token']);
    $unauthCaught = false;
    try {
        AuthMiddleware::requireAdmin();
    } catch (ExitException $e) {
        if ($e->statusCode === 401) $unauthCaught = true;
    }
    assert($unauthCaught === true, "Unauthenticated request to requireAdmin must return 401");

    // Regular user token -> 403
    $userToken = AuthMiddleware::createToken(['username' => 'regular_user', 'role' => 'user', 'exp' => time() + 3600]);
    $_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$userToken}";
    $userForbiddenCaught = false;
    try {
        AuthMiddleware::requireAdmin();
    } catch (ExitException $e) {
        if ($e->statusCode === 403) $userForbiddenCaught = true;
    }
    assert($userForbiddenCaught === true, "Regular user role calling requireAdmin must return 403 Forbidden");

    // Admin token -> Allowed
    $adminToken = AuthMiddleware::createToken(['username' => 'admin_user', 'role' => 'admin', 'exp' => time() + 3600]);
    $_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$adminToken}";
    $adminUser = AuthMiddleware::requireAdmin();
    assert($adminUser['username'] === 'admin_user', "requireAdmin must return authenticated admin user data");
    assert($adminUser['role'] === 'admin', "requireAdmin must return role='admin'");

    unset($_SERVER['HTTP_AUTHORIZATION']);
    echo "    -> Security Matrix verified (401 unauthenticated, 403 user, allowed admin)\n";

} finally {
    $cleanup();
}

echo "✓ Admin Authentication Contract & Docker Integration Tests Passed\n";
exit(0);
