<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/controllers/AdminController.php';

echo "Running Upload Validation Tests...\n";

$reflector = new ReflectionClass('AdminController');
$method = $reflector->getMethod('validateUpload');
$method->setAccessible(true);

// 1. Probar que rechaza un archivo con extensión prohibida (.php)
$tmpFile1 = tempnam(sys_get_temp_dir(), 'test_upload_1_');
file_put_contents($tmpFile1, "<?php echo 'malicious code'; ?>");

$fakeUpload1 = [
    'name' => 'malicious.php',
    'type' => 'image/jpeg',
    'tmp_name' => $tmpFile1,
    'error' => UPLOAD_ERR_OK,
    'size' => filesize($tmpFile1)
];

$rejectedExt = false;
try {
    $method->invoke(null, $fakeUpload1, ['jpg', 'png', 'webp'], ['image/jpeg', 'image/png', 'image/webp'], 15 * 1024 * 1024);
} catch (ExitException $e) {
    if ($e->statusCode === 400) {
        $rejectedExt = true;
    }
}
@unlink($tmpFile1);

assert($rejectedExt, "validateUpload must reject file with extension .php");

// 2. Probar que rechaza un archivo con extensión permitida (.jpg) pero con MIME real no permitido (script de texto)
$tmpFile2 = tempnam(sys_get_temp_dir(), 'test_upload_2_');
file_put_contents($tmpFile2, "<?php echo 'spoofed image'; ?>");

$fakeUpload2 = [
    'name' => 'photo.jpg',
    'type' => 'image/jpeg',
    'tmp_name' => $tmpFile2,
    'error' => UPLOAD_ERR_OK,
    'size' => filesize($tmpFile2)
];

$rejectedMime = false;
try {
    $method->invoke(null, $fakeUpload2, ['jpg', 'jpeg', 'png', 'webp'], ['image/jpeg', 'image/png', 'image/webp'], 15 * 1024 * 1024);
} catch (ExitException $e) {
    if ($e->statusCode === 400) {
        $rejectedMime = true;
    }
}
@unlink($tmpFile2);

assert($rejectedMime, "validateUpload must reject file with spoofed MIME type");

// 3. Probar que rechaza un archivo que excede maxBytes
$tmpFile3 = tempnam(sys_get_temp_dir(), 'test_upload_3_');
file_put_contents($tmpFile3, "test data");

$fakeUpload3 = [
    'name' => 'image.png',
    'type' => 'image/png',
    'tmp_name' => $tmpFile3,
    'error' => UPLOAD_ERR_OK,
    'size' => 16 * 1024 * 1024 // 16MB
];

$rejectedSize = false;
try {
    $method->invoke(null, $fakeUpload3, ['png'], ['image/png'], 15 * 1024 * 1024);
} catch (ExitException $e) {
    if ($e->statusCode === 400) {
        $rejectedSize = true;
    }
}
@unlink($tmpFile3);

assert($rejectedSize, "validateUpload must reject file exceeding maxBytes");

// 4. Probar que rechaza archivo con error de subida
$fakeUpload4 = [
    'name' => 'image.png',
    'type' => 'image/png',
    'tmp_name' => '',
    'error' => UPLOAD_ERR_NO_FILE,
    'size' => 0
];

$rejectedError = false;
try {
    $method->invoke(null, $fakeUpload4, ['png'], ['image/png'], 15 * 1024 * 1024);
} catch (ExitException $e) {
    if ($e->statusCode === 400) {
        $rejectedError = true;
    }
}

assert($rejectedError, "validateUpload must reject file with UPLOAD_ERR_NO_FILE");

// 5. Probar que acepta archivo válido con MIME e integridad correctos
$tmpFile5 = tempnam(sys_get_temp_dir(), 'test_upload_5_');
$validPng = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
file_put_contents($tmpFile5, $validPng);

$validUpload = [
    'name' => 'valid_avatar.png',
    'type' => 'image/png',
    'tmp_name' => $tmpFile5,
    'error' => UPLOAD_ERR_OK,
    'size' => filesize($tmpFile5)
];

$accepted = false;
try {
    $method->invoke(null, $validUpload, ['jpg', 'jpeg', 'png', 'webp'], ['image/jpeg', 'image/png', 'image/webp'], 15 * 1024 * 1024);
    $accepted = true;
} catch (Exception $e) {
    $accepted = false;
}
@unlink($tmpFile5);

assert($accepted, "validateUpload must accept valid image upload");

echo "✓ Upload Validation Tests Passed\n";
