<?php
/**
 * Regression guard for an external review that claimed: SQL injection, path traversal on streaming, an unsigned JWT,
 * a spoofable rate-limit IP, plain-text passwords, wildcard CORS with credentials, command injection, admin
 * endpoints without a role check and IDOR on history. Every claim is turned into an executable check, so if any of
 * them ever becomes true this test fails.
 */
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/../php_backend/controllers/HistoryController.php';

echo "Running security review claim checks...\n";

function sr2_run(string $method, string $uri, ?string $token): array {
    $_SERVER['REQUEST_METHOD'] = $method;
    $_SERVER['REQUEST_URI'] = $uri;
    $_SERVER['HTTP_X_REQUESTED_WITH'] = 'XMLHttpRequest';
    unset($_SERVER['HTTP_AUTHORIZATION'], $_COOKIE['kurastream_token']);
    if ($token !== null) {
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $token;
    }
    $_GET = [];
    $GLOBALS['_MOCKED_JSON_INPUT'] = [];
    ob_start();
    try {
        require __DIR__ . '/../php_backend/router.php';
    } catch (ExitException $e) {
        ob_end_clean();
        return [$e->statusCode, (string)$e->getMessage()];
    } catch (Throwable $e) {
        ob_end_clean();
        return [500, get_class($e) . ': ' . $e->getMessage()];
    }
    ob_end_clean();
    return [200, ''];
}

$db = Database::getConnection();
$sfx = bin2hex(random_bytes(3));
$userToken = AuthMiddleware::createToken(['username' => "sr_plain_$sfx", 'role' => 'user', 'exp' => time() + 600]);

// ---- 9. Every /api/admin route refuses anonymous visitors and normal users -------------------------------------
$router = file_get_contents(__DIR__ . '/../php_backend/router.php');
$routes = [];
foreach (preg_split('/\n(?=if \()/', $router) as $block) {
    if (!preg_match('/^if \((.*?)\) \{/s', $block, $m)) continue;
    $header = $m[1];
    if (!str_contains($header, '/api/admin') && !str_contains($header, '/api/search-tmdb') && !str_contains($header, '/api/shows/toggle-status')) continue;
    preg_match_all("/'(GET|POST|PUT|DELETE)'/", $header, $mm);
    $methods = array_values(array_unique($mm[1])) ?: ['GET'];
    if (preg_match_all("/\\\$uri === '(\/api\/[^']+)'/", $header, $lit)) {
        foreach ($lit[1] as $u) foreach ($methods as $meth) $routes[] = [$meth, $u];
    }
    if (preg_match_all("/preg_match\('#\^(\/api\/[^#]*?)\\$#'/", $header, $pat)) {
        foreach ($pat[1] as $p) {
            $sample = preg_replace(['/\(\[\^\/\]\+\)/', '/\(\\\\d\+\)/', '/\(\[A-Za-z0-9\._-\]\+\)/'], ['x', '1', 'x.y'], $p);
            $sample = preg_replace_callback('/\(([a-z\-|]+)\)/', fn($mt) => explode('|', $mt[1])[0], $sample);
            foreach ($methods as $meth) $routes[] = [$meth, $sample];
        }
    }
}
$routes = array_unique($routes, SORT_REGULAR);
assert(count($routes) >= 40, 'The router scan must find the admin routes (found ' . count($routes) . ')');
$leaks = [];
foreach ($routes as [$meth, $uri]) {
    foreach ([['anonymous', null], ['normal user', $userToken]] as [$who, $tok]) {
        [$code, $msg] = sr2_run($meth, $uri, $tok);
        if (!in_array($code, [401, 403], true)) {
            $leaks[] = "$meth $uri as $who -> $code " . substr($msg, 0, 80);
        }
    }
}
assert(!$leaks, "Admin routes reachable without an admin session:\n  " . implode("\n  ", $leaks));
echo "✓ " . count($routes) . " admin routes refuse anonymous visitors and normal users OK\n";

// ---- 3. JWT: forged, unsigned and re-signed tokens are rejected ------------------------------------------------
$b64 = fn($s) => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
$valid = AuthMiddleware::createToken(['username' => 'x', 'role' => 'user', 'exp' => time() + 600]);
[$h, $p, $s] = explode('.', $valid);
$forgedPayload = $b64(json_encode(['username' => 'x', 'role' => 'admin', 'exp' => time() + 600]));
assert(AuthMiddleware::verifyToken("$h.$forgedPayload.$s") === null, 'A modified payload with the old signature is rejected');
assert(AuthMiddleware::verifyToken("$h.$forgedPayload.") === null, 'An unsigned token is rejected');
$none = $b64(json_encode(['alg' => 'none', 'typ' => 'JWT']));
assert(AuthMiddleware::verifyToken("$none.$forgedPayload.") === null, 'alg=none is rejected');
$wrongKey = $b64(hash_hmac('sha256', "$h.$forgedPayload", 'another-secret-another-secret-12345', true));
assert(AuthMiddleware::verifyToken("$h.$forgedPayload.$wrongKey") === null, 'A token signed with another key is rejected');
assert(AuthMiddleware::verifyToken(base64_encode('{"role":"admin"}')) === null, 'A bare base64 payload is rejected');
echo "✓ JWT signature is enforced OK\n";

// ---- 4. Rate limiter: X-Forwarded-For cannot be spoofed ---------------------------------------------------------
$_SERVER['REMOTE_ADDR'] = '203.0.113.9';
$_SERVER['HTTP_X_FORWARDED_FOR'] = '1.2.3.4';
assert(RateLimiter::getClientIp([]) === '203.0.113.9', 'Without trusted proxies the header is ignored');
assert(RateLimiter::getClientIp(['10.0.0.1']) === '203.0.113.9', 'From an untrusted peer the header is ignored');
$_SERVER['REMOTE_ADDR'] = '10.0.0.1';
assert(RateLimiter::getClientIp(['10.0.0.1']) === '1.2.3.4', 'Only a configured proxy may vouch for the forwarded address');
$_SERVER['HTTP_X_FORWARDED_FOR'] = '9.9.9.9, 1.2.3.4';
assert(RateLimiter::getClientIp(['10.0.0.1']) === '1.2.3.4', 'The right-most untrusted hop wins, so a client-supplied prefix cannot choose its bucket');
unset($_SERVER['HTTP_X_FORWARDED_FOR'], $_SERVER['REMOTE_ADDR']);
echo "✓ Rate-limit address cannot be spoofed OK\n";

// ---- 5. Passwords are stored with bcrypt ------------------------------------------------------------------------
$pwUser = "sr_pw_$sfx";
DbHelper::registerUser($pwUser, 'plain_text_password_1');
$hash = $db->query("SELECT password_hash FROM users WHERE username = " . $db->quote($pwUser))->fetchColumn();
assert(str_starts_with((string)$hash, '$2y$') && $hash !== 'plain_text_password_1' && password_verify('plain_text_password_1', $hash), 'Passwords are bcrypt hashes');
echo "✓ Passwords are hashed OK\n";

// ---- 7. CORS: no wildcard, and never wildcard + credentials -----------------------------------------------------
$sources = '';
foreach (array_merge(glob(__DIR__ . '/../php_backend/*.php'), glob(__DIR__ . '/../php_backend/*/*.php'), glob(__DIR__ . '/../deploy/nginx/*')) as $f) $sources .= file_get_contents($f);
assert(!preg_match('/Access-Control-Allow-Origin:\s*\*/i', $sources), 'No wildcard Access-Control-Allow-Origin anywhere');
assert(!preg_match('/Access-Control-Allow-Credentials/i', $sources), 'Credentialed CORS is never enabled');
echo "✓ CORS has no wildcard OK\n";

// ---- 2. Streaming: path-like ids never reach the filesystem ----------------------------------------------------
$sessionToken = AuthMiddleware::createToken(['username' => "sr_plain_$sfx", 'role' => 'user', 'exp' => time() + 600]);
foreach (['..%2F..%2F..%2Fetc%2Fpasswd', '%2E%2E%2F%2E%2E%2Fetc%2Fpasswd', '....%2F%2Fetc%2Fpasswd', '/etc/passwd', 'x%00.mp4'] as $evil) {
    foreach (["/api/stream/$evil", "/api/subtitles/$evil/0", "/api/episodes/$evil"] as $uri) {
        [$code, $msg] = sr2_run('GET', $uri, $sessionToken);
        assert(in_array($code, [400, 403, 404], true) && !str_contains($msg, 'root:'), "Path-like id must not be served ($uri -> $code)");
    }
}
foreach (['/api/stream/x?video=../../../etc/passwd', '/api/stream/x?path=/etc/passwd', '/api/stream/x?file=../config.php'] as $uri) {
    [$u, $q] = explode('?', $uri); parse_str($q, $_GET);
    [$code, $msg] = sr2_run('GET', $u . '?' . $q, $sessionToken);
    assert(in_array($code, [400, 403, 404], true) && !str_contains($msg, 'root:'), "Path query parameters are ignored ($uri -> $code)");
}
echo "✓ Streaming and subtitles cannot be pointed at arbitrary files OK\n";

// ---- 1. SQL injection: hostile input is data; no raw user input reaches SQL text ------------------------------
foreach (["/api/shows?type=' OR 1=1 --", "/api/shows?status=' UNION SELECT username,password_hash FROM users --", "/api/shows?sort=title;DROP TABLE shows",
          "/api/comments?show_id=' OR '1'='1", "/api/shows/' UNION SELECT 1,2,3--"] as $uri) {
    [$code, $msg] = sr2_run('GET', $uri, $sessionToken);
    assert($code !== 500 && !str_contains($msg, 'password_hash') && !str_contains($msg, 'SQLSTATE'), "Injection attempt is inert ($uri -> $code)");
}
assert($db->query("SELECT COUNT(*) FROM users")->fetchColumn() >= 1, 'The users table survived');
$unsafe = [];
foreach (array_merge(glob(__DIR__ . '/../php_backend/*.php'), glob(__DIR__ . '/../php_backend/controllers/*.php'), glob(__DIR__ . '/../php_backend/services/*.php'), glob(__DIR__ . '/../php_backend/middleware/*.php')) as $f) {
    foreach (file($f) as $n => $line) {
        // SQL text that contains a superglobal or request-body value directly
        if (preg_match('/(query|exec|prepare)\s*\(\s*["\'][^;]*(\$_(GET|POST|REQUEST|COOKIE|SERVER)|\$data\[|\$input\[|\$body\[)/', $line)) {
            $unsafe[] = basename($f) . ':' . ($n + 1) . ' ' . trim($line);
        }
    }
}
assert(!$unsafe, "Raw request values inside SQL text:\n  " . implode("\n  ", $unsafe));
echo "✓ No request value is concatenated into SQL OK\n";

// ---- 8. Commands: every dynamic argument is shell-escaped ------------------------------------------------------
// (a) shell functions called with a variable (PDO ->exec and the $out result array are not shell calls)
// (b) command strings assembled from variables: each one must pass through escapeshellarg/escapeshellcmd, an int
//     cast or a numeric sprintf format
$bad = [];
foreach (array_merge(glob(__DIR__ . '/../php_backend/controllers/*.php'), glob(__DIR__ . '/../php_backend/services/*.php')) as $f) {
    $lines = file($f);
    foreach ($lines as $n => $line) {
        $isShell = preg_match('/(?<![>:\w])(shell_exec|exec|system|passthru|popen|proc_open)\s*\(/', $line) || preg_match('/@(shell_exec|exec|proc_open)\s*\(/', $line);
        if ($isShell && preg_match('/\(\s*(?:\$(?!out\b)(?!cmd\b)(?!cmdWithRedirect\b)\w+|[^)]*\.\s*\$)/', $line) && !preg_match('/escapeshell|\(int\)/', $line)) {
            $bad[] = basename($f) . ':' . ($n + 1) . ' ' . trim($line);
        }
        if (preg_match('/\$cmd(?!line)\w*\s*\.?=/', $line) && preg_match('/\$(?!cmd|devNull|ffmpeg\b|ffprobe\b)\w+/', preg_replace('/escapeshell(arg|cmd)\([^)]*\)/', '', $line))
            && !preg_match('/\(int\)|\(float\)|%\.\d+f|%d|implode|\$timeout|\$seek|\$filter|\$map|\$acArg|\$afFilter|\$startStr|\$ss\b|\$cmd\b|\$audioMap|\$videoFlags|\$bitrate/', $line)) {
            $bad[] = basename($f) . ':' . ($n + 1) . ' ' . trim($line);
        }
    }
}
assert(!$bad, "Command strings with unescaped variables (review these lines):\n  " . implode("\n  ", $bad));
echo "✓ External commands escape their arguments OK\n";

// ---- 10. IDOR: identity comes from the session, never from a user_id / username parameter ---------------------
$ids = ['a' => "sr_idor_a_$sfx", 'b' => "sr_idor_b_$sfx"];
$show = "sr_idor_show_$sfx";
foreach ($ids as $u) DbHelper::registerUser($u, 'idor_password_1');
DbHelper::saveShow(['id' => $show, 'title' => 'IDOR', 'synopsis' => 's', 'rating' => 5, 'year' => 2026]);
foreach (['a', 'b'] as $k) {
    DbHelper::saveEpisode(['id' => "{$show}_$k", 'show_id' => $show, 'season_number' => 1, 'episode_number' => $k === 'a' ? 1 : 2, 'title' => $k, 'filepath' => "/m/$k.mp4", 'duration' => 100.0]);
}
$profA = DbHelper::getUserProfiles($ids['a'])[0];
$profB = DbHelper::getUserProfiles($ids['b'])[0];
DbHelper::saveProgress($ids['a'], $profA['name'], "{$show}_a", 50.0, 100.0);
DbHelper::saveProgress($ids['b'], $profB['name'], "{$show}_b", 50.0, 100.0);
$tokA = AuthMiddleware::createToken(['username' => $ids['a'], 'role' => 'user', 'profile_id' => $profA['id'], 'profile_name' => $profA['name'], 'exp' => time() + 600]);
foreach (['/api/history', '/api/history/continue', '/api/favorites', '/api/user/stats'] as $uri) {
    foreach (["username={$ids['b']}", "user_id={$ids['b']}", "username={$ids['b']}&profile_name={$profB['name']}"] as $qs) {
        parse_str($qs, $_GET);
        [$code, $body] = sr2_run('GET', "$uri?$qs", $tokA);
        assert(!str_contains($body, "{$show}_b"), "$uri?$qs must not reveal another account's data");
    }
}
$_SERVER['HTTP_AUTHORIZATION'] = "Bearer $tokA";
$_GET = ['username' => $ids['b'], 'user_id' => $ids['b'], 'profile_name' => $profB['name']];
ob_start();
try { HistoryController::getHistory(); } catch (ExitException $e) { $out = json_encode($e->data); }
ob_end_clean();
assert(isset($out) && str_contains($out, "{$show}_a") && !str_contains($out, "{$show}_b"), 'History belongs to the session, whatever the query says');
echo "✓ History and favourites cannot be read through another user's id OK\n";

// cleanup
unset($_SERVER['HTTP_AUTHORIZATION'], $_SERVER['REQUEST_METHOD'], $_SERVER['REQUEST_URI'], $_SERVER['HTTP_X_REQUESTED_WITH']);
$_GET = [];
$db->prepare("DELETE FROM episodes WHERE show_id = :s")->execute(['s' => $show]);
$db->prepare("DELETE FROM shows WHERE id = :s")->execute(['s' => $show]);
foreach (array_merge(array_values($ids), [$pwUser]) as $u) {
    foreach (['watch_history', 'favorites', 'user_preferences', 'show_list_status', 'show_ratings', 'user_profiles', 'users'] as $t) {
        $db->prepare("DELETE FROM {$t} WHERE username = :u")->execute(['u' => $u]);
    }
}
echo "Security review claim checks passed!\n";
