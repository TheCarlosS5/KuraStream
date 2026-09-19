<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/AuthController.php';

echo "Running Profile PIN Security Tests...\n";

// 1. Probar que el PIN se verifica y hashea con bcrypt
$username = 'testuser_' . uniqid();
$plainPin = '1234';

$hashed = password_hash($plainPin, PASSWORD_BCRYPT);
assert(password_verify($plainPin, $hashed), "password_verify must validate the bcrypt PIN hash");
assert(!password_verify('9999', $hashed), "password_verify must reject invalid PIN");
assert(strlen($hashed) >= 60, "Bcrypt hash must be at least 60 characters long");

// 2. Probar sanitización de perfil: sanitizeProfileForClient nunca debe exponer pin ni hash
$mockProfile = [
    'id' => 'prof_1',
    'username' => $username,
    'name' => 'Privado',
    'avatar' => '',
    'color' => '#fff',
    'is_kids' => 0,
    'pin' => $hashed
];

$sanitized = DbHelper::sanitizeProfileForClient($mockProfile);
assert(!isset($sanitized['pin']), "Sanitized profile must not contain 'pin'");
assert(isset($sanitized['has_pin']) && $sanitized['has_pin'] === true, "Sanitized profile must have has_pin=true");

$mockProfileNoPin = [
    'id' => 'prof_2',
    'username' => $username,
    'name' => 'Publico',
    'avatar' => '',
    'color' => '#fff',
    'is_kids' => 0,
    'pin' => ''
];
$sanitizedNoPin = DbHelper::sanitizeProfileForClient($mockProfileNoPin);
assert(!isset($sanitizedNoPin['pin']), "Sanitized profile must not contain 'pin'");
assert(isset($sanitizedNoPin['has_pin']) && $sanitizedNoPin['has_pin'] === false, "Sanitized profile with empty pin must have has_pin=false");

// 3. Probar que selectProfile requiere autenticación (401 si no hay token)
unset($_COOKIE['kurastream_token']);
unset($_SERVER['HTTP_AUTHORIZATION']);
$unauthCaught = false;
try {
    AuthController::selectProfile();
} catch (ExitException $e) {
    if ($e->statusCode === 401) {
        $unauthCaught = true;
    }
}
assert($unauthCaught, "selectProfile must reject unauthenticated requests with 401");

// 4. Probar que selectProfile requiere profile_name (400 si falta)
$token = AuthMiddleware::createToken(['username' => 'testuser', 'role' => 'user', 'exp' => time() + 3600]);
$_COOKIE['kurastream_token'] = $token;
$badRequestCaught = false;
try {
    AuthController::selectProfile();
} catch (ExitException $e) {
    if ($e->statusCode === 400) {
        $badRequestCaught = true;
    }
}
assert($badRequestCaught, "selectProfile must reject requests without profile_name with 400");

echo "✓ Profile PIN Security Tests Passed\n";
