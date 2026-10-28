<?php
/**
 * PIN brute-force limit, JWT iat (client clock skew), stale party tickets falling back to the session,
 * and join/leave presence updates that must not re-anchor the room clock.
 */
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/../php_backend/controllers/AuthController.php';
require_once __DIR__ . '/../php_backend/controllers/ShowController.php';
require_once __DIR__ . '/../php_backend/controllers/PartyController.php';
require_once __DIR__ . '/../php_backend/controllers/PlayerController.php';

echo "Running overnight hardening tests...\n";

/** Feeds a JSON body to controllers that read php://input directly. */
class MockPhpInputStream {
    public static string $body = '';
    private int $pos = 0;
    public $context;
    public function stream_open($path, $mode, $options, &$opened) { $this->pos = 0; return true; }
    public function stream_read($count) { $chunk = substr(self::$body, $this->pos, $count); $this->pos += strlen($chunk); return $chunk; }
    public function stream_eof() { return $this->pos >= strlen(self::$body); }
    public function stream_stat() { return []; }
}

function withJsonBody(array $body, callable $fn) {
    MockPhpInputStream::$body = json_encode($body);
    stream_wrapper_unregister('php');
    stream_wrapper_register('php', 'MockPhpInputStream');
    try {
        return $fn();
    } finally {
        stream_wrapper_restore('php');
    }
}

function statusOf(callable $fn): int {
    try {
        $fn();
    } catch (ExitException $e) {
        return $e->statusCode;
    }
    return 200;
}

// 1. Tokens carry iat so clients can measure their clock skew against this server.
$before = time();
$payload = AuthMiddleware::verifyToken(AuthMiddleware::createToken(['username' => 'u', 'exp' => time() + 60]));
assert(isset($payload['iat']) && $payload['iat'] >= $before && $payload['iat'] <= time(), 'createToken must stamp iat');
$explicit = AuthMiddleware::verifyToken(AuthMiddleware::createToken(['username' => 'u', 'iat' => 123, 'exp' => time() + 60]));
assert($explicit['iat'] === 123, 'an explicit iat is kept');

// 3. Five wrong PINs, then even the right PIN answers 429 until the window passes.
$username = 'pinuser_' . uniqid();
$profile = DbHelper::saveUserProfile($username, ['name' => 'Adulto', 'pin' => '4321']);
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . AuthMiddleware::createToken(['username' => $username, 'role' => 'user', 'exp' => time() + 3600]);
for ($i = 0; $i < 5; $i++) {
    $code = withJsonBody(['profile_id' => $profile['id'], 'pin' => '0000'], fn() => statusOf(fn() => AuthController::selectProfile()));
    assert($code === 403, "wrong PIN attempt {$i} must be 403, got {$code}");
}
$code = withJsonBody(['profile_id' => $profile['id'], 'pin' => '4321'], fn() => statusOf(fn() => AuthController::selectProfile()));
assert($code === 429, "after 5 misses the PIN is locked (429), got {$code}");

$other = DbHelper::saveUserProfile($username, ['name' => 'Otro', 'pin' => '1111']);
$code = withJsonBody(['profile_id' => $other['id'], 'pin' => '1111'], fn() => statusOf(fn() => AuthController::selectProfile()));
assert($code === 200, "the lock is per profile, got {$code}");
unset($_SERVER['HTTP_AUTHORIZATION'], $_COOKIE['kurastream_token']); // selectProfile sets the session cookie

// 4. Join/leave presence must not touch the playback anchor.
$roomId = DbHelper::createPartyRoom([
    'name' => 'Overnight', 'host_user' => 'host_' . uniqid(), 'episode_id' => 'ep_overnight',
    'is_playing' => 1, 'current_time' => 120.0,
]);
DbHelper::updatePartyPlayback($roomId, true, 128.0);
$anchored = DbHelper::getPartyRoom($roomId);
usleep(20000);
DbHelper::updatePartyParticipants($roomId, 3);
$after = DbHelper::getPartyRoom($roomId);
assert((float)$after['current_time'] === (float)$anchored['current_time'], 'presence update keeps current_time');
assert((int)$after['last_sync_timestamp'] === (int)$anchored['last_sync_timestamp'], 'presence update keeps last_sync_timestamp');
assert((int)$after['participants_count'] === 3, 'presence update stores the count');

// 4b. last_sync_member stored and returned on playback sync
$syncMember = 'mem_' . bin2hex(random_bytes(8));
DbHelper::updatePartyPlayback($roomId, true, 130.0, null, null, $syncMember);
$withMember = DbHelper::getPartyRoom($roomId);
assert($withMember['last_sync_member'] === $syncMember, 'updatePartyPlayback stores and getPartyRoom returns last_sync_member');

// 5. A stale party ticket falls back to a valid session; without one it is still rejected.
$_GET['ticket'] = AuthMiddleware::createToken(['type' => 'watch_party_stream', 'room_id' => 'NOPE', 'member_id' => 'gone', 'exp' => time() + 60]);
$code = statusOf(fn() => PlayerController::authorizeStreamAccess('ep_whatever'));
assert($code === 403, "stale ticket without a session must be 403, got {$code}");
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . AuthMiddleware::createToken(['username' => 'admin', 'role' => 'admin', 'exp' => time() + 3600]);
$code = statusOf(fn() => PlayerController::authorizeStreamAccess('ep_whatever'));
assert($code === 200, "stale ticket plus a valid session must pass, got {$code}");
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer not-a-token';
$code = statusOf(fn() => PlayerController::authorizeStreamAccess('ep_whatever'));
assert($code === 403, "stale ticket plus an invalid session stays 403, got {$code}");
unset($_GET['ticket'], $_SERVER['HTTP_AUTHORIZATION']);

echo "✓ Overnight hardening tests passed\n";
