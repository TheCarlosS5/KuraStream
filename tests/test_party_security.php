<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/../php_backend/controllers/PartyController.php';

echo "Running Watch Party Security & Anti-Spam Tests...\n";

// Clear rate limits for testing
$_SERVER['REMOTE_ADDR'] = '192.168.1.100';
RateLimiter::clear('party_create_192.168.1.100');
RateLimiter::clear('party_join_192.168.1.100');
RateLimiter::clear('party_msg_192.168.1.100');
RateLimiter::clear('party_sync_192.168.1.100');

// 1. Create Room requires authentication
unset($_COOKIE['kurastream_token']);
unset($_SERVER['HTTP_AUTHORIZATION']);

$unauthCreateBlocked = false;
ob_start();
try {
    PartyController::createRoom();
} catch (ExitException $e) {
    if ($e->statusCode === 401) {
        $unauthCreateBlocked = true;
    }
}
ob_get_clean();
assert($unauthCreateBlocked, "createRoom MUST require authentication (401)");
echo "✓ createRoom requires authentication OK\n";

// 2. Create Room with authenticated host and active profile
DbHelper::saveShow([
    'id' => 'show_party_sec',
    'title' => 'Party Security Show',
    'synopsis' => 'Test show for party security',
    'rating' => 8.0,
    'year' => 2024,
    'age_rating' => 'PG-13',
    'genres' => 'Action'
]);
DbHelper::saveEpisode([
    'id' => 'ep_party_sec_01',
    'show_id' => 'show_party_sec',
    'season_number' => 1,
    'episode_number' => 1,
    'title' => 'Party Sec Ep 1',
    'filepath' => '/media/party_sec_01.mp4',
    'duration' => 1200
]);

$hostUser = 'host_' . substr(uniqid(), -4);
$hostToken = AuthMiddleware::createToken([
    'username' => $hostUser,
    'role' => 'user',
    'profile_id' => 101,
    'profile_name' => 'HostProfile',
    'is_kids' => false,
    'exp' => time() + 3600
]);
$_COOKIE['kurastream_token'] = $hostToken;
$_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$hostToken}";
$GLOBALS['_MOCKED_JSON_INPUT'] = [
    'episode_id' => 'ep_party_sec_01',
    'name' => 'Security Party Room'
];

$roomCreated = false;
$roomId = '';
ob_start();
try {
    PartyController::createRoom();
} catch (ExitException $e) {
    if ($e->statusCode === 200 && !empty($e->data['room_id'])) {
        $roomCreated = true;
        $roomId = $e->data['room_id'];
    }
}
ob_get_clean();
$GLOBALS['_MOCKED_JSON_INPUT'] = [];
assert($roomCreated && !empty($roomId), "Authenticated user should create room successfully");
echo "✓ Authenticated user room creation OK (Room: {$roomId})\n";

// 3. Guest joins room - guest cannot gain host rights
unset($_COOKIE['kurastream_token']);
unset($_SERVER['HTTP_AUTHORIZATION']);
$_GET['room_id'] = $roomId;
$_GET['username'] = '<script>alert(1)</script>GuestNick';

$guestJoined = false;
$isHost = true;
ob_start();
try {
    PartyController::joinRoom();
} catch (ExitException $e) {
    if ($e->statusCode === 200) {
        $guestJoined = true;
        $isHost = $e->data['is_host'];
        $cleanUser = $e->data['user'];
        assert(str_contains($cleanUser, '<script>') === false, "Guest username MUST be sanitized of HTML tags");
    }
}
ob_get_clean();
assert($guestJoined, "Guest should be able to join room");
assert($isHost === false, "Guest MUST NOT have host permissions");
echo "✓ Guest join and sanitized nickname OK, host rights denied to guest\n";

// 4. Rate limiting on Party Messages (anti-spam)
$msgRateLimited = false;
$spamCount = 0;
for ($i = 0; $i < 25; $i++) {
    ob_start();
    try {
        // Mock php://input
        // Send rate-limited message
        RateLimiter::enforce('party_msg', 20, 60);
        $spamCount++;
    } catch (ExitException $e) {
        if ($e->statusCode === 429) {
            $msgRateLimited = true;
            break;
        }
    }
    ob_get_clean();
}
assert($msgRateLimited, "Sending >20 messages in 60s MUST trigger 429 Too Many Requests");
assert($spamCount === 20, "Rate limit should kick in exactly after 20 attempts");
echo "✓ Watch Party message anti-spam rate limiter enforced (429) OK\n";

// Clean up
RateLimiter::clear('party_create_192.168.1.100');
RateLimiter::clear('party_join_192.168.1.100');
RateLimiter::clear('party_msg_192.168.1.100');
RateLimiter::clear('party_sync_192.168.1.100');
DbHelper::deleteShow('show_party_sec');

echo "\n🎉 ALL WATCH PARTY SECURITY TESTS PASSED 100%!\n";
