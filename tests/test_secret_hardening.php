<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/AuthController.php';

echo "Running JWT secret & default credential hardening tests...\n";

// 1. kuraJwtSecretProblem(): weak values are rejected, strong ones accepted
$weak = [
    '' => 'empty',
    'change_me' => 'the .env.example placeholder',
    'short_secret' => 'shorter than 32 characters',
    str_repeat('a', 40) => 'one repeated character',
    'prefix_change_me_prefix_0123456789abcdef' => 'long value that still embeds change_me',
    'YOUR_SECRET_goes_here_0123456789abcdefgh' => 'long value that embeds your_secret',
];
foreach ($weak as $value => $why) {
    assert(kuraJwtSecretProblem((string)$value) !== null, "Secret must be rejected ($why)");
}
assert(kuraJwtSecretProblem(bin2hex(random_bytes(32))) === null, "A random 64 hex secret must be accepted");
assert(kuraJwtSecretProblem('ephemeral_e2e_jwt_secret_32bytes_min_length!') === null, "The documented e2e secret must be accepted");
echo "✓ kuraJwtSecretProblem accepts strong and rejects weak secrets OK\n";

// 2. kuraAdminPasswordIsPlaceholder()
foreach (['change_me', 'CHANGE_ME', ' changeme ', 'admin', 'password', '12345678'] as $p) {
    assert(kuraAdminPasswordIsPlaceholder($p) === true, "'$p' must be treated as a placeholder admin password");
}
foreach (['plaintext_pass', 'ephemeral_pass_' . bin2hex(random_bytes(4)), 'Xk3-9vQ!pLm2'] as $p) {
    assert(kuraAdminPasswordIsPlaceholder($p) === false, "'$p' must not be treated as a placeholder");
}
echo "✓ kuraAdminPasswordIsPlaceholder OK\n";

// 3. The real bootstrap refuses to start with a weak secret (separate process: config.php define()s constants)
function runBootstrap(string $secret): array {
    $configPath = realpath(__DIR__ . '/../php_backend/config.php');
    $cmd = [PHP_BINARY, '-r', 'require ' . var_export($configPath, true) . '; echo "BOOTED";'];
    $env = ['JWT_SECRET' => $secret, 'PATH' => getenv('PATH') ?: '/usr/bin:/bin'];
    $proc = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $env);
    $out = stream_get_contents($pipes[1]);
    $err = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    return [proc_close($proc), $out, $err];
}
[$code, $out, $err] = runBootstrap('change_me');
assert($code !== 0 && !str_contains($out, 'BOOTED'), "Bootstrap must refuse JWT_SECRET=change_me (exit=$code)");
assert(str_contains($err, 'JWT_SECRET'), "Bootstrap must explain the JWT_SECRET problem on stderr");
[$code, $out, $err] = runBootstrap(bin2hex(random_bytes(32)));
assert($code === 0 && str_contains($out, 'BOOTED'), "Bootstrap must start with a strong secret (exit=$code, err=$err)");
echo "✓ config.php refuses to boot with a weak JWT_SECRET OK\n";

// 4. Environment admin with a placeholder password can never log in
$origUser = getenv('ADMIN_USER');
$origPass = getenv('ADMIN_PASS');
$origHash = getenv('ADMIN_PASS_HASH');
$restore = function () use ($origUser, $origPass, $origHash) {
    foreach (['ADMIN_USER' => $origUser, 'ADMIN_PASS' => $origPass, 'ADMIN_PASS_HASH' => $origHash] as $k => $v) {
        if ($v !== false) putenv("$k=$v"); else putenv($k);
    }
};
try {
    putenv('ADMIN_USER=placeholder_admin');
    putenv('ADMIN_PASS=change_me');
    putenv('ADMIN_PASS_HASH');
    $status = null;
    try {
        AuthController::login(['username' => 'placeholder_admin', 'password' => 'change_me']);
    } catch (ExitException $e) {
        $status = $e->statusCode;
    }
    assert($status === 401, "Admin login with the change_me placeholder must be refused (got " . var_export($status, true) . ")");
    echo "✓ ADMIN_PASS=change_me never authenticates OK\n";
} finally {
    $restore();
}

// 5. Legacy unsalted SHA-256 accounts still log in (constant-time compare) and are upgraded to bcrypt
$legacyUser = 'legacy_' . bin2hex(random_bytes(4));
$legacyPass = 'legacy_pass_' . bin2hex(random_bytes(4));
$db = Database::getConnection();
DbHelper::registerUser($legacyUser, $legacyPass, 'user');
$db->prepare("UPDATE users SET password_hash = :h WHERE username = :u")
   ->execute(['h' => hash('sha256', $legacyPass), 'u' => $legacyUser]);

$ok = false;
try {
    AuthController::login(['username' => $legacyUser, 'password' => $legacyPass]);
} catch (ExitException $e) {
    $ok = ($e->statusCode === 200);
}
assert($ok, "Legacy SHA-256 account must still be able to log in");
$stmt = $db->prepare("SELECT password_hash FROM users WHERE username = :u");
$stmt->execute(['u' => $legacyUser]);
assert(password_verify($legacyPass, (string)$stmt->fetchColumn()), "Legacy hash must be upgraded to bcrypt after login");

$bad = null;
try {
    AuthController::login(['username' => $legacyUser, 'password' => 'wrong_' . $legacyPass]);
} catch (ExitException $e) {
    $bad = $e->statusCode;
}
assert($bad === 401, "Wrong password must be refused after the upgrade");
$db->prepare("DELETE FROM users WHERE username = :u")->execute(['u' => $legacyUser]);
echo "✓ Legacy SHA-256 login + bcrypt upgrade OK\n";

echo "All secret hardening tests passed.\n";
