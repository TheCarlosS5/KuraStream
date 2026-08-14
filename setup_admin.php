<?php
// KuraStream Admin Setup Utility
// Usage: php setup_admin.php

require_once __DIR__ . '/php_backend/config.php';
require_once __DIR__ . '/php_backend/db.php';

echo "=============================================\n";
echo "       KURASTREAM - ADMIN USER SETUP         \n";
echo "=============================================\n\n";

// Check if running from CLI
if (php_sapi_name() !== 'cli') {
    die("This script can only be run from the command line (CLI).\n");
}

function promptHiddenInput(string $prompt): string {
    echo $prompt;
    $isTty = posix_isatty(STDIN);
    if ($isTty && strtoupper(substr(PHP_OS, 0, 3)) !== 'WIN') {
        shell_exec('stty -echo');
        $input = trim(fgets(STDIN));
        shell_exec('stty echo');
        echo "\n";
        return $input;
    }
    return trim(fgets(STDIN));
}

echo "Introduce el nombre de usuario administrador [admin]: ";
$inputUser = trim(fgets(STDIN));
$username = !empty($inputUser) ? $inputUser : 'admin';

$password = promptHiddenInput("Introduce la nueva contraseña para '{$username}' (mínimo 8 caracteres): ");

if (strlen($password) < 8) {
    echo "\n❌ Error de seguridad: La contraseña debe tener al menos 8 caracteres.\n";
    exit(1);
}

$confirm = promptHiddenInput("Confirma la nueva contraseña: ");

if ($password !== $confirm) {
    echo "\n❌ Error: Las contraseñas no coinciden.\n";
    exit(1);
}

try {
    $db = Database::getConnection();
    Database::initializeSchema($db);

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
        echo "\n✅ Usuario administrador '{$username}' creado exitosamente con rol 'admin'.\n";
    }

    echo "\n🎉 ¡Listo! Ya puedes iniciar sesión con tu cuenta de administrador en KuraStream.\n";
    echo "=============================================\n";
} catch (Exception $e) {
    echo "\n❌ Error conectando a la base de datos: " . $e->getMessage() . "\n";
    exit(1);
}
