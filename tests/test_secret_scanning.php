<?php
// Test for detecting hardcoded credentials, passwords, and API keys

echo "Running Secret Scanning Verification Tests...\n";

$repoDir = dirname(__DIR__);
$patterns = [
    'hardcoded_ssh_pw' => '/child\.sendline\([\'"]\d{4,}[\'"]\)/i',
    'strict_host_key_disabled' => '/StrictHostKeyChecking=no/i',
    'tmdb_fallback_hardcoded_key' => '/15d2ea6d0dc1d476efbca3eba2b9bbfb/i',
];

$failedFindings = [];

$scanDirs = [
    $repoDir . '/php_backend',
    $repoDir . '/frontend',
    $repoDir . '/tests',
    $repoDir . '/deploy_remote.py',
    $repoDir . '/legacy_backend/scripts'
];

function scanPath(string $path, array $patterns, array &$failedFindings) {
    if (is_file($path)) {
        if (realpath($path) === realpath(__FILE__)) return;
        $content = @file_get_contents($path);
        if ($content === false) return;
        foreach ($patterns as $name => $pattern) {
            if (preg_match($pattern, $content)) {
                $failedFindings[] = "Pattern '{$name}' found in {$path}";
            }
        }
        return;
    }

    if (is_dir($path)) {
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path, RecursiveDirectoryIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if ($file->isFile()) {
                if (realpath($file->getPathname()) === realpath(__FILE__)) continue;
                $ext = strtolower($file->getExtension());
                if (in_array($ext, ['php', 'js', 'py', 'sh', 'json', 'yml', 'yaml', 'env'])) {
                    $content = @file_get_contents($file->getPathname());
                    if ($content === false) continue;
                    foreach ($patterns as $name => $pattern) {
                        if (preg_match($pattern, $content)) {
                            $failedFindings[] = "Pattern '{$name}' found in " . $file->getPathname();
                        }
                    }
                }
            }
        }
    }
}

foreach ($scanDirs as $target) {
    if (file_exists($target)) {
        scanPath($target, $patterns, $failedFindings);
    }
}

if (!empty($failedFindings)) {
    echo "FAIL: Hardcoded secrets or insecure SSH flags detected:\n";
    foreach ($failedFindings as $f) {
        echo "  - {$f}\n";
    }
    exit(1);
}

echo "✓ No hardcoded secrets or insecure SSH flags detected.\n";
exit(0);
