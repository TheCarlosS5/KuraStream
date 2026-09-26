<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../middleware/AuthMiddleware.php';
require_once __DIR__ . '/../middleware/RateLimiter.php';

class PartyController {

    private static function resolveUser(array $body = []): string {
        $token = AuthMiddleware::getBearerToken();
        $payload = AuthMiddleware::verifyToken($token);
        if ($payload && !empty($payload['username'])) {
            return $payload['username'];
        }
        $guestName = !empty($body['username']) ? trim((string)$body['username']) : (!empty($_GET['username']) ? trim((string)$_GET['username']) : '');
        if (empty($guestName) && !empty($_COOKIE['kurastream_guest_name'])) {
            $guestName = trim((string)$_COOKIE['kurastream_guest_name']);
        }
        if (empty($guestName)) {
            $guestName = 'Invitado_' . substr(bin2hex(random_bytes(4)), -4);
        }
        $guestName = strip_tags($guestName);
        $cleanName = mb_substr($guestName, 0, 64);
        if (empty($_COOKIE['kurastream_guest_name']) || $_COOKIE['kurastream_guest_name'] !== $cleanName) {
            $isSecure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
                || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https');
            @setcookie('kurastream_guest_name', $cleanName, [
                'expires' => time() + (24 * 3600),
                'path' => '/',
                'httponly' => true,
                'samesite' => 'Lax',
                'secure' => $isSecure
            ]);
            $_COOKIE['kurastream_guest_name'] = $cleanName;
        }
        return $cleanName;
    }

    private static function requireAuthenticatedUser(): string {
        $payload = AuthMiddleware::requireAuth();
        return $payload['username'];
    }

    private static function resolvePartyParticipant(array $data, array $room): array {
        $userToken = AuthMiddleware::getBearerToken();
        if (!empty($userToken)) {
            $payload = AuthMiddleware::verifyToken($userToken);
            if ($payload && !empty($payload['username'])) {
                $username = $payload['username'];
                $isHost = ($room['host_user'] === $username);
                return [
                    'username' => $username,
                    'is_host' => $isHost,
                    'authenticated' => true,
                    'member_id' => null
                ];
            }
        }

        $memberId = trim((string)($data['member_id'] ?? ($_GET['member_id'] ?? '')));
        $memberToken = trim((string)($data['member_token'] ?? ($_GET['member_token'] ?? '')));

        if (!empty($memberId) && !empty($memberToken)) {
            $member = DbHelper::validatePartyMemberToken($room['id'], $memberId, $memberToken);
            if ($member) {
                $isHost = ($member['role'] === 'host' || $room['host_user'] === $member['username']);
                return [
                    'username' => $member['username'],
                    'is_host' => $isHost,
                    'authenticated' => false,
                    'member_id' => $member['member_id']
                ];
            }
        }

        $user = self::resolveUser($data);
        return [
            'username' => $user,
            'is_host' => false,
            'authenticated' => false,
            'member_id' => null
        ];
    }

    public static function createRoom(): void {
        RateLimiter::enforce('party_create', 10, 60);
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $user = self::requireAuthenticatedUser();
        $name = !empty($data['name']) ? trim($data['name']) : ("Sala de " . $user);
        $episodeId = $data['episode_id'] ?? '';
        $isPublic = !empty($data['is_public']) ? 1 : 0;
        $allowGuestControls = !empty($data['allow_guest_controls']) ? 1 : 0;

        // 96 bits of randomness makes private room links unguessable in practice.
        $roomId = 'KURA-' . strtoupper(bin2hex(random_bytes(12)));

        DbHelper::createPartyRoom([
            'id' => $roomId,
            'name' => $name,
            'host_user' => $user,
            'episode_id' => $episodeId,
            'is_public' => $isPublic,
            'allow_guest_controls' => $allowGuestControls,
            'is_playing' => 0,
            'current_time' => 0.0
        ]);

        $memberId = 'mem_' . bin2hex(random_bytes(16));
        $memberToken = 'mptk_' . bin2hex(random_bytes(32));
        $tokenHash = hash('sha256', $memberToken);

        DbHelper::recordPartyMember($roomId, $user, $memberId, $tokenHash, 'host');

        // Welcome system message
        DbHelper::addPartyMessage($roomId, 'Sistema', "¡Sala de Watch Party creada por {$user}! 🎉", 'system');

        $room = DbHelper::getPartyRoom($roomId);
        $capabilityToken = AuthMiddleware::createToken([
            'type' => 'watch_party_stream',
            'room_id' => $roomId,
            'member_id' => $memberId,
            'episode_id' => $episodeId,
            'exp' => time() + 86400
        ]);

        jsonResponse([
            'success' => true,
            'room_id' => $roomId,
            'room' => $room,
            'member_id' => $memberId,
            'member_token' => $memberToken,
            'stream_capability_token' => $capabilityToken,
            'is_host' => true
        ]);
    }

    public static function joinRoom(): void {
        RateLimiter::enforce('party_join', 30, 60);
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $roomId = strtoupper(trim($data['room_id'] ?? ($_GET['room_id'] ?? '')));
        $user = self::resolveUser($data);

        if (empty($roomId)) {
            jsonError('room_id requerido', 400);
        }

        $room = DbHelper::getPartyRoom($roomId);
        if (!$room) {
            jsonError('La sala de Watch Party no existe o ha expirado', 404);
        }

        $memberId = 'mem_' . bin2hex(random_bytes(16));
        $memberToken = 'mptk_' . bin2hex(random_bytes(32));
        $tokenHash = hash('sha256', $memberToken);

        $authPayload = AuthMiddleware::verifyToken(AuthMiddleware::getBearerToken());
        $isHost = ($authPayload !== null && !empty($authPayload['username']) && $room['host_user'] === $authPayload['username']);
        $role = $isHost ? 'host' : 'guest';

        DbHelper::recordPartyMember($roomId, $user, $memberId, $tokenHash, $role);
        $memberCount = DbHelper::getPartyMembersCount($roomId);

        // Add system message if not host joining initial room
        if ($room['host_user'] !== $user) {
            DbHelper::addPartyMessage($roomId, 'Sistema', "{$user} se unió al Watch Party 👋", 'system');
            DbHelper::updatePartyPlayback($roomId, (bool)$room['is_playing'], (float)$room['current_time'], null, $memberCount);
            $room = DbHelper::getPartyRoom($roomId);
        }

        $recentMessages = DbHelper::getPartyMessages($roomId, 0, 40);
        $activeMembers = DbHelper::getActivePartyMembers($roomId);

        $capabilityToken = AuthMiddleware::createToken([
            'type' => 'watch_party_stream',
            'room_id' => $roomId,
            'member_id' => $memberId,
            'episode_id' => $room['episode_id'],
            'exp' => time() + 86400
        ]);

        jsonResponse([
            'success' => true,
            'room' => $room,
            'messages' => $recentMessages,
            'members' => $activeMembers,
            'user' => $user,
            'member_id' => $memberId,
            'member_token' => $memberToken,
            'stream_capability_token' => $capabilityToken,
            'is_host' => $isHost
        ]);
    }

    public static function leaveRoom(): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $roomId = strtoupper(trim($data['room_id'] ?? ($_GET['room_id'] ?? '')));
        $user = self::resolveUser($data);

        if (!empty($roomId)) {
            $room = DbHelper::getPartyRoom($roomId);
            if ($room) {
                DbHelper::removePartyMember($roomId, $user);
                $newCount = DbHelper::getPartyMembersCount($roomId);
                DbHelper::addPartyMessage($roomId, 'Sistema', "{$user} salió de la sala", 'system');
                DbHelper::updatePartyPlayback($roomId, (bool)$room['is_playing'], (float)$room['current_time'], null, $newCount);
            }
        }

        jsonResponse(['success' => true]);
    }

    public static function syncPlayback(): void {
        RateLimiter::enforce('party_sync', 120, 60);
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $roomId = strtoupper(trim($data['room_id'] ?? ''));
        if (empty($roomId)) {
            jsonError('room_id requerido', 400);
        }

        $room = DbHelper::getPartyRoom($roomId);
        if (!$room) {
            jsonError('Sala no encontrada', 404);
        }

        $participant = self::resolvePartyParticipant($data, $room);
        $user = $participant['username'];
        $isHost = $participant['is_host'];
        $allowGuests = (bool)$room['allow_guest_controls'];

        if (!$isHost) {
            if (!$allowGuests) {
                jsonError('Solo el anfitrión puede controlar la reproducción', 403);
            }
            if (!$participant['authenticated'] && empty($participant['member_id'])) {
                jsonError('Token de miembro requerido para controles de invitado', 403);
            }
        }

        $isPlaying = isset($data['is_playing']) ? (bool)$data['is_playing'] : (bool)$room['is_playing'];
        $currentTime = isset($data['current_time']) ? (float)$data['current_time'] : (float)$room['current_time'];
        $episodeId = !empty($data['episode_id']) ? trim($data['episode_id']) : $room['episode_id'];
        $action = $data['action'] ?? null;

        DbHelper::updatePartyPlayback($roomId, $isPlaying, $currentTime, $episodeId);

        // Optional system notice for major events (seek / episode switch)
        if ($action === 'seek') {
            $min = floor($currentTime / 60);
            $sec = str_pad((int)($currentTime % 60), 2, '0', STR_PAD_LEFT);
            DbHelper::addPartyMessage($roomId, 'Sistema', "{$user} saltó a {$min}:{$sec} ⏱️", 'system');
        } elseif ($action === 'episode_change') {
            DbHelper::addPartyMessage($roomId, 'Sistema', "{$user} cambió de episodio 📺", 'system');
        }

        $updatedRoom = DbHelper::getPartyRoom($roomId);

        jsonResponse([
            'success' => true,
            'room' => $updatedRoom
        ]);
    }

    public static function sendMessage(): void {
        RateLimiter::enforce('party_msg', 20, 60);
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $roomId = strtoupper(trim($data['room_id'] ?? ''));
        if (empty($roomId)) {
            jsonError('room_id y message requeridos', 400);
        }

        $room = DbHelper::getPartyRoom($roomId);
        if (!$room) {
            jsonError('Sala no encontrada', 404);
        }

        $participant = self::resolvePartyParticipant($data, $room);
        $user = $participant['username'];
        $message = trim($data['message'] ?? '');
        $message = strip_tags($message);
        $type = in_array($data['type'] ?? '', ['chat', 'reaction']) ? $data['type'] : 'chat';

        if (empty($message)) {
            jsonError('room_id y message requeridos', 400);
        }
        if (mb_strlen($message) > 500) {
            jsonError('El mensaje no puede superar 500 caracteres', 400);
        }

        $msgId = DbHelper::addPartyMessage($roomId, $user, $message, $type);

        jsonResponse([
            'success' => true,
            'message_id' => $msgId,
            'message' => [
                'id' => $msgId,
                'room_id' => $roomId,
                'username' => $user,
                'message' => $message,
                'type' => $type,
                'created_at' => date('Y-m-d H:i:s')
            ]
        ]);
    }

    public static function updateSettings(): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $roomId = strtoupper(trim($data['room_id'] ?? ''));
        $user = self::requireAuthenticatedUser();

        $room = DbHelper::getPartyRoom($roomId);
        if (!$room) {
            jsonError('Sala no encontrada', 404);
        }

        if ($room['host_user'] !== $user) {
            jsonError('Solo el anfitrión puede modificar los ajustes de la sala', 403);
        }

        DbHelper::updatePartySettings($roomId, $data);
        $updatedRoom = DbHelper::getPartyRoom($roomId);

        jsonResponse([
            'success' => true,
            'room' => $updatedRoom
        ]);
    }

    public static function getPublicRooms(): void {
        $rooms = DbHelper::getPublicPartyRooms();
        jsonResponse([
            'success' => true,
            'rooms' => $rooms
        ]);
    }

    public static function pollEvents(): void {
        $roomId = strtoupper(trim($_GET['room_id'] ?? ''));
        $lastMsgId = (int)($_GET['last_msg_id'] ?? ($_GET['last_id'] ?? 0));

        if (empty($roomId)) {
            jsonError('room_id requerido', 400);
        }

        $room = DbHelper::getPartyRoom($roomId);
        if (!$room) {
            jsonError('Sala no encontrada', 404);
        }

        $messages = DbHelper::getPartyMessages($roomId, $lastMsgId, 30);

        jsonResponse([
            'success' => true,
            'room' => $room,
            'messages' => $messages
        ]);
    }

    public static function streamEvents(): void {
        $roomId = strtoupper(trim($_GET['room_id'] ?? ''));
        $lastMsgId = (int)($_GET['last_msg_id'] ?? ($_GET['last_id'] ?? 0));

        if (empty($roomId)) {
            @http_response_code(400);
            echo "event: error\ndata: " . json_encode(['error' => 'room_id requerido']) . "\n\n";
            exit();
        }

        $room = DbHelper::getPartyRoom($roomId);
        if (!$room) {
            @http_response_code(404);
            echo "event: error\ndata: " . json_encode(['error' => 'Sala no encontrada']) . "\n\n";
            exit();
        }

        $user = self::resolveUser();
        DbHelper::recordPartyMember($roomId, $user);

        // Setup SSE response headers
        @header('Content-Type: text/event-stream; charset=utf-8');
        @header('Cache-Control: no-cache, no-transform');
        @header('Connection: keep-alive');
        @header('X-Accel-Buffering: no');
        @header('Access-Control-Allow-Origin: *');

        while (ob_get_level()) {
            ob_end_clean();
        }

        // Send initial connection ACK and current state
        $initialMessages = DbHelper::getPartyMessages($roomId, $lastMsgId, 25);
        if (!empty($initialMessages)) {
            $lastMsgId = end($initialMessages)['id'];
        }

        $activeMembers = DbHelper::getActivePartyMembers($roomId);

        echo "event: init\n";
        echo "data: " . json_encode(['room' => $room, 'messages' => $initialMessages, 'members' => $activeMembers]) . "\n\n";
        flush();

        $lastSyncTime = $room['last_sync_timestamp'];
        $lastEpisode = $room['episode_id'];
        $lastPlaying = $room['is_playing'];
        $lastCurrentTime = $room['current_time'];
        $lastMemberPing = time();

        $startTime = time();
        $maxDuration = 25; // Reconnect every 25 seconds for reliable proxy / keepalive compatibility

        while (time() - $startTime < $maxDuration) {
            if (connection_aborted()) {
                break;
            }

            usleep(400000); // 400ms check interval

            // Periodic presence heartbeat every 5s
            if (time() - $lastMemberPing >= 5) {
                DbHelper::recordPartyMember($roomId, $user);
                $lastMemberPing = time();
            }

            // Fetch room updates
            $currentRoom = DbHelper::getPartyRoom($roomId);
            if (!$currentRoom) {
                echo "event: room_closed\ndata: " . json_encode(['message' => 'La sala ha sido cerrada']) . "\n\n";
                flush();
                break;
            }

            // Detect playback state change
            $stateChanged = ($currentRoom['last_sync_timestamp'] !== $lastSyncTime ||
                             $currentRoom['episode_id'] !== $lastEpisode ||
                             $currentRoom['is_playing'] !== $lastPlaying ||
                             abs($currentRoom['current_time'] - $lastCurrentTime) > 1.5);

            if ($stateChanged) {
                $lastSyncTime = $currentRoom['last_sync_timestamp'];
                $lastEpisode = $currentRoom['episode_id'];
                $lastPlaying = $currentRoom['is_playing'];
                $lastCurrentTime = $currentRoom['current_time'];

                echo "event: sync\n";
                echo "data: " . json_encode($currentRoom) . "\n\n";
                flush();
            }

            // Fetch new messages & reactions
            $newMessages = DbHelper::getPartyMessages($roomId, $lastMsgId, 20);
            if (!empty($newMessages)) {
                $lastMsgId = end($newMessages)['id'];
                echo "event: messages\n";
                echo "data: " . json_encode($newMessages) . "\n\n";
                flush();
            }

            // Ping heartbeat
            echo "event: ping\ndata: {}\n\n";
            flush();
        }

        if (connection_aborted()) {
            DbHelper::removePartyMember($roomId, $user);
            $roomNow = DbHelper::getPartyRoom($roomId);
            if ($roomNow) {
                $newCount = DbHelper::getPartyMembersCount($roomId);
                DbHelper::updatePartyPlayback($roomId, (bool)$roomNow['is_playing'], (float)$roomNow['current_time'], null, $newCount);
            }
        }

        exit();
    }
}
