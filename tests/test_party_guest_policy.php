<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/../php_backend/controllers/PartyController.php';
require_once __DIR__ . '/../php_backend/controllers/PlayerController.php';

echo "Running Watch Party guest policy tests...\n";

$_SERVER['REMOTE_ADDR'] = '203.0.113.77';
foreach (['party_create', 'party_join', 'party_sync', 'party_msg', 'party_ticket'] as $bucket) {
    RateLimiter::clear("{$bucket}_203.0.113.77");
}

function pg_call(string $method, array $input = [], ?string $bearer = null): array {
    $GLOBALS['_MOCKED_JSON_INPUT'] = $input;
    if ($bearer !== null) $_SERVER['HTTP_AUTHORIZATION'] = "Bearer {$bearer}"; else unset($_SERVER['HTTP_AUTHORIZATION']);
    unset($_COOKIE['kurastream_token'], $_COOKIE['kurastream_party_session'], $_COOKIE['kurastream_guest_name']);
    $status = null; $data = null;
    ob_start();
    try { PartyController::$method(); } catch (ExitException $e) { $status = $e->statusCode; $data = $e->data; }
    ob_end_clean();
    return [$status, $data];
}

$db = Database::getConnection();
$suffix = bin2hex(random_bytes(3));
$hostName = "pg_host_$suffix";
$viewerName = "pg_viewer_$suffix";
$showId = "pg_show_$suffix";
$epId = "pg_ep_$suffix";
$roomIds = [];

try {
    DbHelper::saveShow(['id' => $showId, 'title' => 'Guest Policy Show', 'rating' => 7.0, 'year' => 2024, 'age_rating' => 'PG-13', 'genres' => 'Action']);
    DbHelper::saveEpisode(['id' => $epId, 'show_id' => $showId, 'season_number' => 1, 'episode_number' => 1, 'title' => 'E1', 'filepath' => '/media/pg.mp4', 'duration' => 1200]);

    DbHelper::registerUser($hostName, 'a_long_password_1', 'user');
    DbHelper::registerUser($viewerName, 'a_long_password_2', 'user');
    $hostProfile = DbHelper::getUserProfiles($hostName)[0];
    $viewerProfile = DbHelper::getUserProfiles($viewerName)[0];
    $hostToken = AuthMiddleware::createToken(['username' => $hostName, 'role' => 'user', 'profile_id' => $hostProfile['id'], 'profile_name' => $hostProfile['name'], 'is_kids' => false, 'exp' => time() + 3600]);
    $viewerToken = AuthMiddleware::createToken(['username' => $viewerName, 'role' => 'user', 'profile_id' => $viewerProfile['id'], 'profile_name' => $viewerProfile['name'], 'is_kids' => false, 'exp' => time() + 3600]);
    $noProfileToken = AuthMiddleware::createToken(['username' => $viewerName, 'role' => 'user', 'exp' => time() + 3600]);

    // 1. Rooms refuse guests unless the host opts in; the flag is parsed strictly
    [$code, $closed] = pg_call('createRoom', ['episode_id' => $epId, 'name' => 'Closed'], $hostToken);
    assert($code === 200 && $closed['room']['allow_guests'] === false, 'allow_guests defaults to false');
    $closedId = $closed['room']['id']; $roomIds[] = $closedId;
    [$code, $viaString] = pg_call('createRoom', ['episode_id' => $epId, 'allow_guests' => 'false'], $hostToken);
    assert($code === 200 && $viaString['room']['allow_guests'] === false, 'The string "false" must not turn guests on');
    $roomIds[] = $viaString['room']['id'];
    [$code] = pg_call('createRoom', ['episode_id' => $epId, 'allow_guests' => 'maybe'], $hostToken);
    assert($code === 400, 'A non-boolean allow_guests is refused (got ' . var_export($code, true) . ')');
    [$code, $open] = pg_call('createRoom', ['episode_id' => $epId, 'name' => 'Open', 'allow_guests' => true], $hostToken);
    assert($code === 200 && $open['room']['allow_guests'] === true, 'The host can opt in to guests');
    $openId = $open['room']['id']; $roomIds[] = $openId;
    echo "✓ allow_guests defaults to off and is parsed strictly OK\n";

    // 2. Joining a closed room
    [$code, $data] = pg_call('joinRoom', ['room_id' => $closedId, 'username' => 'AnonFriend']);
    assert($code === 403 && ($data['code'] ?? '') === 'PARTY_ACCOUNT_REQUIRED', 'An anonymous guest cannot join a room that does not admit guests');
    [$code, $data] = pg_call('joinRoom', ['room_id' => $closedId], $noProfileToken);
    assert($code === 403 && ($data['code'] ?? '') === 'PROFILE_REQUIRED', 'A session without an active profile cannot join (no kids context)');
    [$code, $data] = pg_call('joinRoom', ['room_id' => $closedId], $viewerToken);
    assert($code === 200 && !empty($data['member_id']), 'An account with a profile joins normally (got ' . var_export($code, true) . ')');
    echo "✓ Closed room: guests refused, profile required, accounts admitted OK\n";

    // 3. Guest names in an open room
    foreach (['Sistema', 'sistema', 'SYSTEM'] as $reserved) {
        [$code] = pg_call('joinRoom', ['room_id' => $openId, 'username' => $reserved]);
        assert($code === 400, "Guest name '$reserved' is reserved (got " . var_export($code, true) . ')');
    }
    foreach ([$hostName, strtoupper($viewerName)] as $taken) {
        [$code, $data] = pg_call('joinRoom', ['room_id' => $openId, 'username' => $taken]);
        assert($code === 409 && ($data['code'] ?? '') === 'PARTY_GUEST_NAME_TAKEN', "Guest name '$taken' belongs to an account (got " . var_export($code, true) . ')');
    }
    [$code, $guest] = pg_call('joinRoom', ['room_id' => $openId, 'username' => 'NakamaGuest']);
    assert($code === 200 && !empty($guest['member_id']), 'A guest with a free name joins an open room');
    $guestRow = DbHelper::getPartyMemberById($openId, $guest['member_id']);
    assert($guestRow['account_username'] === null && DbHelper::isGuestMember($guestRow), 'The guest has no account');
    echo "✓ Open room: reserved and account names refused, free name admitted OK\n";

    // 4. Guests need the room to keep admitting them
    $guestCreds = ['room_id' => $openId, 'member_id' => $guest['member_id'], 'member_token' => $guest['member_token']];
    [$code] = pg_call('refreshStreamTicket', $guestCreds);
    assert($code === 200, 'A guest can renew its ticket while guests are admitted (got ' . var_export($code, true) . ')');

    // Host changes settings: whitelist only, never host_user
    [$code, $upd] = pg_call('updateSettings', ['room_id' => $openId, 'host_user' => $viewerName, 'name' => 'Renamed', 'allow_guest_controls' => true], $hostToken);
    assert($code === 200 && $upd['room']['host_user'] === $hostName, 'updateSettings must not let the host rewrite host_user (got ' . ($upd['room']['host_user'] ?? 'null') . ')');
    assert($upd['room']['name'] === 'Renamed' && $upd['room']['allow_guest_controls'] === true, 'Whitelisted settings still apply');
    [$code] = pg_call('updateSettings', ['room_id' => $openId, 'allow_guests' => 'sometimes'], $hostToken);
    assert($code === 400, 'A non-boolean setting is refused');
    [$code] = pg_call('updateSettings', ['room_id' => $openId, 'allow_guests' => false], $viewerToken);
    assert($code === 403, 'Only the host changes settings');

    // A guest capability token is also used for streaming
    $guestCap = AuthMiddleware::createToken(['type' => 'watch_party_stream', 'room_id' => $openId, 'member_id' => $guest['member_id'], 'exp' => time() + 900]);
    $_GET['ticket'] = $guestCap;
    unset($_SERVER['HTTP_AUTHORIZATION']);
    $streamOk = true;
    try { PlayerController::authorizeStreamAccess($epId); } catch (ExitException $e) { $streamOk = false; }
    assert($streamOk, 'A guest streams while the room admits guests');

    // Host closes the room to guests: they are removed and every credential stops working
    [$code, $upd] = pg_call('updateSettings', ['room_id' => $openId, 'allow_guests' => false], $hostToken);
    assert($code === 200 && $upd['room']['allow_guests'] === false, 'The host can stop admitting guests');
    assert(DbHelper::getPartyMemberById($openId, $guest['member_id']) === null, 'Guests are removed when the host closes the room to them');
    [$code] = pg_call('refreshStreamTicket', $guestCreds);
    assert($code === 401, 'A removed guest cannot renew its ticket (got ' . var_export($code, true) . ')');
    $streamStatus = null;
    try { PlayerController::authorizeStreamAccess($epId); } catch (ExitException $e) { $streamStatus = $e->statusCode; }
    assert($streamStatus === 403, 'A removed guest cannot stream (got ' . var_export($streamStatus, true) . ')');

    // A guest row that survives (stale) is still refused when the room does not admit guests
    $staleId = 'mem_' . bin2hex(random_bytes(16)); $staleToken = 'mptk_' . bin2hex(random_bytes(32));
    DbHelper::recordPartyMember($openId, 'StaleGuest', $staleId, hash('sha256', $staleToken), 'guest');
    [$code] = pg_call('refreshStreamTicket', ['room_id' => $openId, 'member_id' => $staleId, 'member_token' => $staleToken]);
    assert($code === 401, 'A guest row in a room that does not admit guests is not a valid participant');
    unset($_GET['ticket']);
    echo "✓ Settings whitelist, guest removal and credential invalidation OK\n";

    // 5. The public list needs a session
    [$code] = pg_call('getPublicRooms');
    assert($code === 401, 'public-rooms without a session -> 401 (got ' . var_export($code, true) . ')');
    [$code, $list] = pg_call('getPublicRooms', [], $viewerToken);
    assert($code === 200 && isset($list['rooms']), 'public-rooms with a session works');
    echo "✓ public-rooms requires a session OK\n";
} finally {
    unset($_GET['ticket'], $_SERVER['HTTP_AUTHORIZATION']);
    foreach ($roomIds as $r) {
        $db->prepare("DELETE FROM party_messages WHERE room_id = :r")->execute(['r' => $r]);
        $db->prepare("DELETE FROM party_members WHERE room_id = :r")->execute(['r' => $r]);
        $db->prepare("DELETE FROM party_rooms WHERE id = :r")->execute(['r' => $r]);
    }
    foreach ([$hostName, $viewerName] as $u) {
        $db->prepare("DELETE FROM user_profiles WHERE username = :u")->execute(['u' => $u]);
        $db->prepare("DELETE FROM users WHERE username = :u")->execute(['u' => $u]);
    }
    DbHelper::deleteShow($showId);
    $db->prepare("DELETE FROM episodes WHERE id = :e")->execute(['e' => $epId]);
}

echo "All Watch Party guest policy tests passed.\n";
