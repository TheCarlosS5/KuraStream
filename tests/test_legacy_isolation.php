<?php
echo "Running Legacy Isolation Tests...\n";

$baseDir = dirname(__DIR__);
$pkgFile = $baseDir . '/package.json';
$pkg = json_decode(file_get_contents($pkgFile), true);

assert(!str_contains($pkg['scripts']['start'] ?? '', 'backend/server.js'), 
    "package.json 'start' script must not launch legacy backend/server.js");

assert(!str_contains($pkg['scripts']['dev'] ?? '', 'backend/server.js'),
    "package.json 'dev' script must not launch legacy backend/server.js");

assert(str_contains($pkg['scripts']['start'] ?? '', 'php_backend/router.php'),
    "package.json 'start' script must point to php_backend/router.php");

assert(str_contains($pkg['scripts']['dev'] ?? '', 'php_backend/router.php'),
    "package.json 'dev' script must point to php_backend/router.php");

assert(!is_dir($baseDir . '/backend'),
    "legacy backend directory must not exist");

assert(!is_dir($baseDir . '/legacy_backend'),
    "legacy_backend directory must be completely eliminated");

echo "✓ Legacy Isolation Tests Passed\n";
