<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/../php_backend/controllers/PartyController.php';
require_once __DIR__ . '/helpers/http_server.php';

echo "Running Watch Party SSE efficiency & consistency tests...\n";

$db = Database::getConnection();
$suffix = bin2hex(random_bytes(3));
$roomId = "KURA-SSE-$suffix";
$otherRoom = "KURA-SSE2-$suffix";
$server = null;

function sse_questions(PDO $db): int { return (int)$db->query("SHOW GLOBAL STATUS LIKE 'Questions'")->fetch()['Value']; }

/** Reads SSE events from a raw socket for up to $seconds; each call returns events seen so far. */
function sse_read($sock, float $seconds, array &$buffer, int $stopAfterEvents = PHP_INT_MAX): array {
    $events = [];
    $end = microtime(true) + $seconds;
    while (microtime(true) < $end && count($events) < $stopAfterEvents) {
        $r = [$sock]; $w = $e = null;
        if (stream_select($r, $w, $e, 0, 200000) > 0) {
            $chunk = fread($sock, 65536);
            if ($chunk === '' || $chunk === false) break;
            $buffer['raw'] = ($buffer['raw'] ?? '') . $chunk;
        }
        if (empty($buffer['body']) && ($h = strpos($buffer['raw'] ?? '', "\r\n\r\n")) !== false) {   // drop the HTTP response head once
            $buffer['raw'] = substr($buffer['raw'], $h + 4);
            $buffer['body'] = true;
        }
        if (empty($buffer['body'])) continue;
        while (($pos = strpos($buffer['raw'] ?? '', "\n\n")) !== false) {
            $block = substr($buffer['raw'], 0, $pos);
            $buffer['raw'] = substr($buffer['raw'], $pos + 2);
            if (preg_match('/^event: (\S+)\ndata: (.*)$/s', $block, $m)) $events[] = [$m[1], json_decode($m[2], true)];
        }
    }
    return $events;
}

try {
    $db->prepare("DELETE FROM party_rooms WHERE id IN (:a,:b)")->execute(['a' => $roomId, 'b' => $otherRoom]);

    // 1. version counter: bumped by every change that clients must hear about
    DbHelper::createPartyRoom(['id' => $roomId, 'name' => 'SSE', 'host_user' => 'sse_host', 'episode_id' => 'ep_x', 'allow_guest_controls' => 1]);
    $v0 = DbHelper::getPartyRoom($roomId)['version'];
    DbHelper::updatePartyPlayback($roomId, true, 10.0);
    $v1 = DbHelper::getPartyRoom($roomId)['version'];
    DbHelper::updatePartySettings($roomId, ['allow_guest_controls' => false]);
    $v2 = DbHelper::getPartyRoom($roomId)['version'];
    assert($v1 === $v0 + 1 && $v2 === $v1 + 1, "version must increase on playback and settings changes ($v0,$v1,$v2)");
    $pulse = DbHelper::getPartyRoomPulse($roomId);
    assert($pulse['version'] === $v2 && $pulse['last_message_id'] === 0, 'pulse reports version and newest message id');
    DbHelper::addPartyMessage($roomId, 'sse_host', 'hola', 'chat');
    assert(DbHelper::getPartyRoomPulse($roomId)['last_message_id'] > 0, 'pulse sees new messages');
    assert(DbHelper::getPartyRoomPulse('KURA-NOPE') === null, 'pulse of a missing room is null');
    echo "✓ Room version and pulse OK\n";

    // 2. presence cleanup is per room; housekeeping handles the rest
    DbHelper::createPartyRoom(['id' => $otherRoom, 'name' => 'Other', 'host_user' => 'h2', 'episode_id' => 'ep_x']);
    DbHelper::recordPartyMember($roomId, 'stale_here', 'mem_here_' . $suffix, 'h', 'guest');
    DbHelper::recordPartyMember($otherRoom, 'stale_there', 'mem_there_' . $suffix, 'h', 'guest');
    $db->exec("UPDATE party_members SET last_ping = DATE_SUB(NOW(), INTERVAL 15 MINUTE) WHERE member_id IN ('mem_here_$suffix','mem_there_$suffix')");
    DbHelper::getActivePartyMembers($roomId);
    $gone = fn(string $room, string $id) => DbHelper::getPartyMemberById($room, $id) === null;
    assert($gone($roomId, 'mem_here_' . $suffix), 'the room being read drops its stale members');
    assert(!$gone($otherRoom, 'mem_there_' . $suffix), 'reading one room must not scan or clean other rooms');
    $result = DbHelper::runPartyHousekeeping();
    assert($result['members'] >= 1 && $gone($otherRoom, 'mem_there_' . $suffix), 'housekeeping removes long-silent members everywhere');
    echo "✓ Presence cleanup is per room, housekeeping covers the rest OK\n";

    // 3. a heartbeat that predates someone else's change is ignored (when the client reports base_version)
    $hostUser = "sse_hostacct_$suffix";
    DbHelper::registerUser($hostUser, 'a_long_password_1', 'user');
    $profile = DbHelper::getUserProfiles($hostUser)[0];
    $hostToken = AuthMiddleware::createToken(['username' => $hostUser, 'role' => 'user', 'profile_id' => $profile['id'], 'profile_name' => $profile['name'], 'is_kids' => false, 'exp' => time() + 3600]);
    $_SERVER['HTTP_AUTHORIZATION'] = "Bearer $hostToken";
    $_SERVER['REMOTE_ADDR'] = '203.0.113.99';
    RateLimiter::clear('party_sync_203.0.113.99');
    DbHelper::createPartyRoom(['id' => $otherRoom, 'name' => 'HB', 'host_user' => $hostUser, 'episode_id' => 'ep_x', 'allow_guest_controls' => 1]);
    $hb = function (array $extra) use ($otherRoom) {
        $GLOBALS['_MOCKED_JSON_INPUT'] = array_merge(['room_id' => $otherRoom, 'is_playing' => 1, 'current_time' => 100.0, 'action' => 'heartbeat'], $extra);
        $st = null; $data = null;
        ob_start();
        try { PartyController::syncPlayback(); } catch (ExitException $e) { $st = $e->statusCode; $data = $e->data; }
        ob_end_clean();
        return [$st, $data];
    };
    DbHelper::updatePartyPlayback($otherRoom, true, 500.0);                 // a seek by someone else, just now
    $room = DbHelper::getPartyRoom($otherRoom);
    [$st, $data] = $hb(['base_version' => $room['version'] - 1]);
    assert($st === 200 && ($data['ignored'] ?? false) === true, 'A heartbeat built before the change is ignored');
    assert(DbHelper::getPartyRoom($otherRoom)['current_time'] === 500.0, 'and does not overwrite the new position');
    [$st, $data] = $hb(['base_version' => $room['version']]);
    assert($st === 200 && empty($data['ignored']) && DbHelper::getPartyRoom($otherRoom)['current_time'] === 100.0, 'A heartbeat from the current version applies');
    DbHelper::updatePartyPlayback($otherRoom, true, 700.0);
    [$st] = $hb([]);                                                          // old clients: no base_version
    assert($st === 200 && DbHelper::getPartyRoom($otherRoom)['current_time'] === 100.0, 'Clients without base_version behave as before');
    unset($_SERVER['HTTP_AUTHORIZATION']);
    echo "✓ Stale heartbeat guard OK\n";

    // 4. A live SSE stream through the real router
    $memberId = 'mem_live_' . $suffix; $memberToken = 'mptk_' . bin2hex(random_bytes(16));
    // The member is bound to an account and profile, so (like a browser's EventSource) the stream also sends the session cookie.
    DbHelper::recordPartyMember($roomId, $hostUser, $memberId, hash('sha256', $memberToken), 'host', false, $hostUser, $profile['id']);
    [$server, $port] = kura_start_server();
    $sock = stream_socket_client("tcp://127.0.0.1:$port", $en, $es, 5);
    stream_set_blocking($sock, false);
    $path = "/api/party/stream?room_id=$roomId&member_id=$memberId&member_token=$memberToken";
    fwrite($sock, "GET $path HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: text/event-stream\r\nCookie: kurastream_token=$hostToken\r\nConnection: keep-alive\r\n\r\n");
    $buf = [];
    $events = sse_read($sock, 3, $buf, 1);
    assert(($events[0][0] ?? '') === 'init', 'the stream opens with an init event; received: ' . substr(json_encode($buf), 0, 600));

    $q0 = sse_questions($db); $t0 = microtime(true);
    $events = sse_read($sock, 4, $buf);                                         // idle for 4 s
    $perSecond = (sse_questions($db) - $q0 - 2) / (microtime(true) - $t0);
    $kinds = array_column($events, 0);
    assert(in_array('ping', $kinds, true), 'an idle stream still sends keep-alive pings (got ' . implode(',', $kinds) . ')');
    assert(count(array_keys($kinds, 'ping')) <= 3, 'pings are not sent on every tick (' . count(array_keys($kinds, 'ping')) . ' in 4 s)');
    assert($perSecond < 4.0, sprintf('an idle SSE connection must stay below 4 queries/s, measured %.1f/s', $perSecond));
    echo sprintf("  (idle stream: %.1f queries/s)\n", $perSecond);

    DbHelper::updatePartyPlayback($roomId, false, 42.0);
    $events = sse_read($sock, 2.5, $buf);
    $sync = array_values(array_filter($events, fn($e) => $e[0] === 'sync'))[0][1] ?? null;
    assert($sync !== null && (float)$sync['current_time'] === 42.0 && $sync['version'] > $v2, 'a state change reaches the stream as a sync event');

    DbHelper::addPartyMessage($roomId, 'sse_host', 'nuevo mensaje', 'chat');
    $events = sse_read($sock, 2.5, $buf);
    $msgs = array_values(array_filter($events, fn($e) => $e[0] === 'messages'));
    assert(!empty($msgs) && $msgs[0][1][0]['message'] === 'nuevo mensaje', 'a new chat message reaches the stream');

    DbHelper::updatePartySettings($roomId, ['allow_guest_controls' => true]);
    $events = sse_read($sock, 2.5, $buf);
    assert(in_array('sync', array_column($events, 0), true), 'a settings change is pushed too (it used to wait for the next heartbeat)');
    echo "✓ Live SSE stream: sync, messages, settings, keep-alive and low query rate OK\n";

    // 5. Dropping the connection does not remove the member
    fclose($sock);
    sleep(2);
    assert(DbHelper::getPartyMemberById($roomId, $memberId) !== null, 'a dropped connection must not delete the member (reconnects are common)');
    echo "✓ A dropped connection keeps the member OK\n";
} finally {
    kura_stop_server($server);
    unset($_SERVER['HTTP_AUTHORIZATION']);
    foreach ([$roomId, $otherRoom] as $r) {
        $db->prepare("DELETE FROM party_messages WHERE room_id = :r")->execute(['r' => $r]);
        $db->prepare("DELETE FROM party_members WHERE room_id = :r")->execute(['r' => $r]);
        $db->prepare("DELETE FROM party_rooms WHERE id = :r")->execute(['r' => $r]);
    }
    if (isset($hostUser)) {
        $db->prepare("DELETE FROM user_profiles WHERE username = :u")->execute(['u' => $hostUser]);
        $db->prepare("DELETE FROM users WHERE username = :u")->execute(['u' => $hostUser]);
    }
}

echo "All Watch Party SSE efficiency tests passed.\n";
