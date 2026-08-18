<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../middleware/AuthMiddleware.php';

class PartyController {

    private static function resolveUser(array $body = []): string {
        $token = AuthMiddleware::getBearerToken();
        $payload = AuthMiddleware::verifyToken($token);
        if ($payload && !empty($payload['username'])) {
            return $payload['username'];
        }
        return !empty($body['username']) ? trim($body['username']) : (!empty($_GET['username']) ? trim($_GET['username']) : 'Invitado_' . substr(uniqid(), -4));
    }

    public static function createRoom(): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $user = self::resolveUser($data);
        $name = !empty($data['name']) ? trim($data['name']) : ("Sala de " . $user);
        $episodeId = $data['episode_id'] ?? '';
        $isPublic = !empty($data['is_public']) ? 1 : 0;
        $allowGuestControls = !empty($data['allow_guest_controls']) ? 1 : 0;

        $roomId = 'KURA-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 6));

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

        // Welcome system message
        DbHelper::addPartyMessage($roomId, 'Sistema', "¡Sala de Watch Party creada por {$user}! 🎉", 'system');

        $room = DbHelper::getPartyRoom($roomId);

        jsonResponse([
            'success' => true,
            'room_id' => $roomId,
            'room' => $room
        ]);
    }

    public static function joinRoom(): void {
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

        // Add system message if not host joining initial room
        if ($room['host_user'] !== $user) {
            DbHelper::addPartyMessage($roomId, 'Sistema', "{$user} se unió al Watch Party 👋", 'system');
            DbHelper::updatePartyPlayback($roomId, (bool)$room['is_playing'], (float)$room['current_time'], null, (int)$room['participants_count'] + 1);
            $room = DbHelper::getPartyRoom($roomId);
        }

        $recentMessages = DbHelper::getPartyMessages($roomId, 0, 40);

        jsonResponse([
            'success' => true,
            'room' => $room,
            'messages' => $recentMessages,
            'user' => $user,
            'is_host' => ($room['host_user'] === $user)
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
                DbHelper::addPartyMessage($roomId, 'Sistema', "{$user} salió de la sala", 'system');
                $newCount = max(1, (int)$room['participants_count'] - 1);
                DbHelper::updatePartyPlayback($roomId, (bool)$room['is_playing'], (float)$room['current_time'], null, $newCount);
            }
        }

        jsonResponse(['success' => true]);
    }

    public static function syncPlayback(): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $roomId = strtoupper(trim($data['room_id'] ?? ''));
        $user = self::resolveUser($data);

        if (empty($roomId)) {
            jsonError('room_id requerido', 400);
        }

        $room = DbHelper::getPartyRoom($roomId);
        if (!$room) {
            jsonError('Sala no encontrada', 404);
        }

        $isHost = ($room['host_user'] === $user);
        $allowGuests = (bool)$room['allow_guest_controls'];

        if (!$isHost && !$allowGuests) {
            jsonError('Solo el anfitrión puede controlar la reproducción', 403);
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
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: [];

        $roomId = strtoupper(trim($data['room_id'] ?? ''));
        $user = self::resolveUser($data);
        $message = trim($data['message'] ?? '');
        $type = in_array($data['type'] ?? '', ['chat', 'reaction', 'system']) ? $data['type'] : 'chat';

        if (empty($roomId) || empty($message)) {
            jsonError('room_id y message requeridos', 400);
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
        $user = self::resolveUser($data);

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

        echo "event: init\n";
        echo "data: " . json_encode(['room' => $room, 'messages' => $initialMessages]) . "\n\n";
        flush();

        $lastSyncTime = $room['last_sync_timestamp'];
        $lastEpisode = $room['episode_id'];
        $lastPlaying = $room['is_playing'];
        $lastCurrentTime = $room['current_time'];

        $startTime = time();
        $maxDuration = 25; // Reconnect every 25 seconds for reliable proxy / keepalive compatibility

        while (time() - $startTime < $maxDuration) {
            if (connection_aborted()) {
                break;
            }

            usleep(400000); // 400ms check interval

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

        exit();
    }
}
