<?php
// KuraStream Admin Setup Utility
// Usage: php setup_admin.php [username] [password]

require_once __DIR__ . '/php_backend/config.php';
require_once __DIR__ . '/php_backend/db.php';

echo "=============================================\n";
echo "       KURASTREAM - ADMIN USER SETUP         \n";
echo "=============================================\n\n";

// Check if running from CLI
if (php_sapi_name() !== 'cli') {
    die("This script can only be run from the command line (CLI).\n");
}

$username = $argv[1] ?? '';
$password = $argv[2] ?? '';

// Interactive prompt if arguments not provided
if (empty($username)) {
    echo "Introduce el nombre de usuario administrador [admin]: ";
    $inputUser = trim(fgets(STDIN));
    $username = !empty($inputUser) ? $inputUser : 'admin';
}

if (empty($password)) {
    echo "Introduce la nueva contraseña para '{$username}': ";
    // Read password
    $password = trim(fgets(STDIN));
}

if (empty($password) || strlen($password) < 4) {
    echo "\n❌ Error: La contraseña debe tener al menos 4 caracteres.\n";
    exit(1);
}

try {
    $db = Database::getConnection();

    // Check if user already exists
    $stmt = $db->prepare("SELECT * FROM users WHERE username = :u");
    $stmt->execute(['u' => $username]);
    $existing = $stmt->fetch();

    $hash = password_hash($password, PASSWORD_BCRYPT);

    if ($existing) {
        $upd = $db->prepare("UPDATE users SET password_hash = :p, role = 'admin' WHERE username = :u");
        $upd->execute(['u' => $username, 'p' => $hash]);
        echo "\n✅ Contraseña y permisos de administrador actualizados para '{$username}'.\n";
    } else {
        $ins = $db->prepare("INSERT INTO users (username, password_hash, role) VALUES (:u, :p, 'admin')");
        $ins->execute(['u' => $username, 'p' => $hash]);

        // Create initial profile
        DbHelper::saveUserProfile($username, [
            'id' => 'profile_' . uniqid(),
            'name' => 'Principal',
            'avatar' => '',
            'color' => '#a855f7'
        ]);
        echo "\n✅ Usuario administrador '{$username}' creado exitosamente.\n";
    }

    echo "\n🎉 ¡Listo! Ya puedes iniciar sesión con tu cuenta de administrador en KuraStream.\n";
    echo "=============================================\n";
} catch (Exception $e) {
    echo "\n❌ Error conectando a la base de datos: " . $e->getMessage() . "\n";
    exit(1);
}
