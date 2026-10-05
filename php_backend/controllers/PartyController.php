<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../middleware/AuthMiddleware.php';
require_once __DIR__ . '/../middleware/Input.php';
require_once __DIR__ . '/../middleware/RateLimiter.php';
require_once __DIR__ . '/ShowController.php';

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

    public static function validatePartyMemberProfileContext(?array $member): ?array {
        if (!$member || empty($member['account_username'])) {
            // Anonymous guest: no account/profile binding enforced
            return null;
        }

        // 1. Mandatory valid Web JWT for account-bound memberships
        $token = AuthMiddleware::getBearerToken();
        if (empty($token)) {
            jsonError(
                'La sesión de usuario ya no está activa. Vuelve a entrar a la sala.',
                403,
                ['code' => 'PARTY_AUTH_REQUIRED']
            );
        }

        $jwt = AuthMiddleware::verifyToken($token);
        if (!$jwt || empty($jwt['username'])) {
            jsonError(
                'La sesión de usuario ya no está activa. Vuelve a entrar a la sala.',
                403,
                ['code' => 'PARTY_AUTH_REQUIRED']
            );
        }

        if (
            $jwt['username'] !== $member['account_username']
            || (string)($jwt['profile_id'] ?? '') !== (string)$member['profile_id']
        ) {
            jsonError(
                'El perfil activo cambió. Vuelve a entrar a la sala.',
                403,
                ['code' => 'PARTY_PROFILE_CHANGED']
            );
        }

        // 2. Fetch live profile state from database to ensure it still exists and obtain real-time is_kids
        try {
            $profile = DbHelper::getUserProfileById($member['account_username'], (string)$member['profile_id']);
            if ($profile) {
                return $profile;
            }
            // If user exists in DB but profile is missing (deleted): reject with 403
            if (DbHelper::getUser($member['account_username']) !== null) {
                jsonError('El perfil activo cambió. Vuelve a entrar a la sala.', 403, ['code' => 'PARTY_PROFILE_CHANGED']);
            }
        } catch (PDOException $e) {
            // Offline test fallback
        }

        return null;
    }

    private static function resolvePartyParticipant(array $data, array $room, bool $enforceProfileContext = true): ?array {
        // 1. Check ephemeral SSE ticket if provided
        $sseTicket = trim((string)($data['sse_ticket'] ?? ($_SERVER['HTTP_X_SSE_TICKET'] ?? ($_GET['sse_ticket'] ?? ''))));
        if (!empty($sseTicket)) {
            $ticketPayload = AuthMiddleware::verifyToken($sseTicket);
            if ($ticketPayload && ($ticketPayload['type'] ?? '') === 'party_sse'
                && ($ticketPayload['room_id'] ?? '') === $room['id']
                && !empty($ticketPayload['member_id'])
            ) {
                $member = DbHelper::getPartyMemberById($room['id'], $ticketPayload['member_id']);
                if ($member) {
                    if ($enforceProfileContext) {
                        self::validatePartyMemberProfileContext($member);
                    }
                    $isHost = ($member['role'] === 'host');
                    return [
                        'username' => $member['username'],
                        'is_host' => $isHost,
                        'authenticated' => $isHost,
                        'member_id' => $member['member_id'],
                        'role' => $member['role'],
                        'member' => $member
                    ];
                }
            }
        }

        // 2. Check headers or explicit body/get params
        $memberId = trim((string)($data['member_id'] ?? ($_SERVER['HTTP_X_PARTY_MEMBER_ID'] ?? ($_GET['member_id'] ?? ''))));
        $memberToken = trim((string)($data['member_token'] ?? ($_SERVER['HTTP_X_PARTY_MEMBER_TOKEN'] ?? ($_GET['member_token'] ?? ''))));

        // 3. Check HttpOnly cookie for party session
        if ((empty($memberId) || empty($memberToken)) && !empty($_COOKIE['kurastream_party_session'])) {
            $cookieData = json_decode($_COOKIE['kurastream_party_session'], true);
            if ($cookieData && ($cookieData['room_id'] ?? '') === $room['id']) {
                $memberId = $cookieData['member_id'] ?? $memberId;
                $memberToken = $cookieData['member_token'] ?? $memberToken;
            }
        }

        if (!empty($memberId) && !empty($memberToken)) {
            $member = DbHelper::validatePartyMemberToken($room['id'], $memberId, $memberToken);
            if ($member) {
                if ($enforceProfileContext) {
                    self::validatePartyMemberProfileContext($member);
                }
                $isHost = ($member['role'] === 'host');
                return [
                    'username' => $member['username'],
                    'is_host' => $isHost,
                    'authenticated' => $isHost,
                    'member_id' => $member['member_id'],
                    'role' => $member['role'],
                    'member' => $member
                ];
            }
        }

        // 4. Authenticated Host session fallback
        $userToken = AuthMiddleware::getBearerToken();
        if (!empty($userToken)) {
            $payload = AuthMiddleware::verifyToken($userToken);
            if ($payload && !empty($payload['username']) && $room['host_user'] === $payload['username']) {
                $hostMember = DbHelper::getPartyHostMember($room['id']);
                if ($enforceProfileContext && $hostMember) {
                    self::validatePartyMemberProfileContext($hostMember);
                }
                return [
                    'username' => $payload['username'],
                    'is_host' => true,
                    'authenticated' => true,
                    'member_id' => $hostMember['member_id'] ?? null,
                    'role' => 'host',
                    'member' => $hostMember
                ];
            }
        }

        return null;
    }

    private static function setPartySessionCookie(string $roomId, string $memberId, string $memberToken): void {
        $isSecure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https');
        $payload = json_encode([
            'room_id' => $roomId,
            'member_id' => $memberId,
            'member_token' => $memberToken
        ]);
        @setcookie('kurastream_party_session', $payload, [
            'expires' => time() + (24 * 3600),
            'path' => '/api/party',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => $isSecure
        ]);
    }

    public static function createRoom(): void {
        RateLimiter::enforce('party_create', 10, 60);
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: ($GLOBALS['_MOCKED_JSON_INPUT'] ?? []);

        $profilePayload = AuthMiddleware::requireProfile();
        $user = $profilePayload['username'];
        $isKids = !empty($profilePayload['is_kids']);
        $profileId = $profilePayload['profile_id'] ?? null;

        $name = Input::string($data, 'name', 100);
        if ($name === '') {
            $name = "Sala de " . $user;
        }
        $episodeId = Input::string($data, 'episode_id', 255);
        if (empty($episodeId)) {
            jsonError('episode_id requerido para crear una sala', 400);
        }

        $ep = DbHelper::getEpisode($episodeId);
        if (!$ep) {
            jsonError('Episodio no encontrado', 404);
        }

        $show = DbHelper::getShow($ep['show_id']);
        if (!$show) {
            jsonError('Show no encontrado', 404);
        }

        if ($isKids && ShowController::isAdultOrMaturityRestricted($show)) {
            jsonError('Contenido restringido por el perfil infantil activo', 403);
        }

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

        DbHelper::recordPartyMember($roomId, $user, $memberId, $tokenHash, 'host', $isKids, $user, $profileId);
        self::setPartySessionCookie($roomId, $memberId, $memberToken);

        // Welcome system message (semantic, zero hardcoded icon emojis)
        DbHelper::addPartyMessage($roomId, 'Sistema', "¡Sala de Watch Party creada por {$user}!", 'system');

        $room = DbHelper::getPartyRoom($roomId);
        $capabilityToken = AuthMiddleware::createToken([
            'type' => 'watch_party_stream',
            'room_id' => $roomId,
            'member_id' => $memberId,
            'exp' => time() + 900
        ]);

        $sseTicket = AuthMiddleware::createToken([
            'type' => 'party_sse',
            'room_id' => $roomId,
            'member_id' => $memberId,
            'exp' => time() + 60
        ]);

        jsonResponse([
            'success' => true,
            'room_id' => $roomId,
            'room' => $room,
            'member_id' => $memberId,
            'member_token' => $memberToken,
            'stream_capability_token' => $capabilityToken,
            'sse_ticket' => $sseTicket,
            'is_host' => true
        ]);
    }

    public static function joinRoom(): void {
        RateLimiter::enforce('party_join', 30, 60);
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: ($GLOBALS['_MOCKED_JSON_INPUT'] ?? []);

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

        $isKids = false;
        $accountUsername = null;
        $profileId = null;
        if ($authPayload !== null) {
            $isKids = !empty($authPayload['is_kids']);
            $accountUsername = $authPayload['username'] ?? null;
            $profileId = $authPayload['profile_id'] ?? null;
        }

        if ($isKids && !empty($room['episode_id'])) {
            $ep = DbHelper::getEpisode($room['episode_id']);
            if ($ep && !empty($ep['show_id'])) {
                $show = DbHelper::getShow($ep['show_id']);
                if ($show && ShowController::isAdultOrMaturityRestricted($show)) {
                    jsonError('Contenido restringido por el perfil infantil activo', 403);
                }
            }
        }

        DbHelper::recordPartyMember($roomId, $user, $memberId, $tokenHash, $role, $isKids, $accountUsername, $profileId);
        $memberCount = DbHelper::getPartyMembersCount($roomId);

        // Add system message if not host joining initial room
        if (!$isHost) {
            DbHelper::addPartyMessage($roomId, 'Sistema', "{$user} se unió al Watch Party", 'system');
            DbHelper::updatePartyPlayback($roomId, (bool)$room['is_playing'], (float)$room['current_time'], null, $memberCount);
            $room = DbHelper::getPartyRoom($roomId);
        }

        self::setPartySessionCookie($roomId, $memberId, $memberToken);

        $recentMessages = DbHelper::getPartyMessages($roomId, 0, 40);
        $activeMembers = DbHelper::getActivePartyMembers($roomId);

        $capabilityToken = AuthMiddleware::createToken([
            'type' => 'watch_party_stream',
            'room_id' => $roomId,
            'member_id' => $memberId,
            'exp' => time() + 900
        ]);

        $sseTicket = AuthMiddleware::createToken([
            'type' => 'party_sse',
            'room_id' => $roomId,
            'member_id' => $memberId,
            'exp' => time() + 60
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
            'sse_ticket' => $sseTicket,
            'is_host' => $isHost
        ]);
    }

    public static function leaveRoom(): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: ($GLOBALS['_MOCKED_JSON_INPUT'] ?? []);

        $roomId = strtoupper(trim($data['room_id'] ?? ($_GET['room_id'] ?? '')));
        if (empty($roomId)) {
            jsonError('room_id requerido', 400);
        }

        $room = DbHelper::getPartyRoom($roomId);
        if (!$room) {
            jsonResponse(['success' => true]);
            return;
        }

        $participant = self::resolvePartyParticipant($data, $room, false);
        if (!$participant) {
            jsonError('Credenciales de miembro inválidas', 401);
            return;
        }

        $user = $participant['username'];
        $memberId = $participant['member_id'];

        if ($memberId) {
            DbHelper::removePartyMemberById($roomId, $memberId);
        } else {
            $hostMember = DbHelper::getPartyHostMember($roomId);
            if ($hostMember && !empty($hostMember['member_id'])) {
                DbHelper::removePartyMemberById($roomId, $hostMember['member_id']);
            }
        }

        $newCount = DbHelper::getPartyMembersCount($roomId);
        DbHelper::addPartyMessage($roomId, 'Sistema', "{$user} salió de la sala", 'system');
        DbHelper::updatePartyPlayback($roomId, (bool)$room['is_playing'], (float)$room['current_time'], null, $newCount);

        $isSecure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https');
        @setcookie('kurastream_party_session', '', [
            'expires' => time() - 3600,
            'path' => '/api/party',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => $isSecure
        ]);
        unset($_COOKIE['kurastream_party_session']);

        jsonResponse(['success' => true]);
    }

    public static function syncPlayback(): void {
        RateLimiter::enforce('party_sync', 120, 60);
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: ($GLOBALS['_MOCKED_JSON_INPUT'] ?? []);

        $roomId = strtoupper(trim($data['room_id'] ?? ''));
        if (empty($roomId)) {
            jsonError('room_id requerido', 400);
        }

        $room = DbHelper::getPartyRoom($roomId);
        if (!$room) {
            jsonError('Sala no encontrada', 404);
        }

        $participant = self::resolvePartyParticipant($data, $room);
        if (!$participant) {
            jsonError('Credenciales de miembro requeridas', 401);
        }

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

        $requestedEpisodeId = !empty($data['episode_id']) ? trim($data['episode_id']) : $room['episode_id'];
        $action = $data['action'] ?? null;

        if ($action === 'episode_change' && !$isHost) {
            jsonError('Solo el anfitrión puede cambiar el episodio de la sala', 403);
        }

        if ($requestedEpisodeId !== $room['episode_id']) {
            if (!$isHost) {
                jsonError('Solo el anfitrión puede cambiar el episodio de la sala', 403);
            }
            $targetEp = DbHelper::getEpisode($requestedEpisodeId);
            if (!$targetEp) {
                jsonError('Episodio no encontrado', 404);
            }
            $targetShow = DbHelper::getShow($targetEp['show_id']);
            if (!$targetShow) {
                jsonError('Show no encontrado', 404);
            }
            $isKidsHost = ShowController::isKidsProfileActive();
            if ($isKidsHost && ShowController::isAdultOrMaturityRestricted($targetShow)) {
                jsonError('Contenido restringido por el perfil infantil activo', 403);
            }
            $episodeId = $requestedEpisodeId;
        } else {
            $episodeId = $room['episode_id'];
        }

        $isPlaying = isset($data['is_playing']) ? (bool)$data['is_playing'] : (bool)$room['is_playing'];
        $currentTime = isset($data['current_time']) ? (float)$data['current_time'] : (float)$room['current_time'];

        DbHelper::updatePartyPlayback($roomId, $isPlaying, $currentTime, $episodeId);

        // Optional system notice for major events (seek / episode switch)
        if ($action === 'seek') {
            $min = floor($currentTime / 60);
            $sec = str_pad((int)($currentTime % 60), 2, '0', STR_PAD_LEFT);
            DbHelper::addPartyMessage($roomId, 'Sistema', "{$user} saltó a {$min}:{$sec}", 'system');
        } elseif ($action !== 'heartbeat' && ($action === 'episode_change' || $requestedEpisodeId !== $room['episode_id'])) {
            DbHelper::addPartyMessage($roomId, 'Sistema', "{$user} cambió de episodio", 'system');
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
        $data = json_decode($raw, true) ?: ($GLOBALS['_MOCKED_JSON_INPUT'] ?? []);

        $roomId = strtoupper(trim($data['room_id'] ?? ''));
        if (empty($roomId)) {
            jsonError('room_id y message requeridos', 400);
        }

        $room = DbHelper::getPartyRoom($roomId);
        if (!$room) {
            jsonError('Sala no encontrada', 404);
        }

        $participant = self::resolvePartyParticipant($data, $room);
        if (!$participant) {
            jsonError('Credenciales de miembro requeridas', 401);
        }

        $user = $participant['username'];
        $message = Input::string($data, 'message', 10000);
        $message = strip_tags($message);
        $type = in_array($data['type'] ?? '', ['chat', 'reaction']) ? $data['type'] : 'chat';

        if (empty($message)) {
            jsonError('room_id y message requeridos', 400);
        }
        if (mb_strlen($message) > 500) {
            jsonError('El mensaje no puede superar 500 caracteres', 400);
        }

        $role = $participant['role'] ?? 'guest';
        $memberId = $participant['member_id'] ?? null;
        $storedType = ($role === 'host') ? ($type . ':host') : $type;
        $msgId = DbHelper::addPartyMessage($roomId, $user, $message, $storedType);

        jsonResponse([
            'success' => true,
            'message_id' => $msgId,
            'message' => [
                'id' => $msgId,
                'room_id' => $roomId,
                'username' => $user,
                'message' => $message,
                'type' => $type,
                'role' => $role,
                'member_id' => $memberId,
                'created_at' => date('Y-m-d H:i:s')
            ]
        ]);
    }

    public static function updateSettings(): void {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: ($GLOBALS['_MOCKED_JSON_INPUT'] ?? []);

        $roomId = strtoupper(trim($data['room_id'] ?? ''));
        $room = DbHelper::getPartyRoom($roomId);
        if (!$room) {
            jsonError('Sala no encontrada', 404);
        }

        $participant = self::resolvePartyParticipant($data, $room);
        if ($participant) {
            if (!$participant['is_host']) {
                jsonError('Solo el anfitrión puede modificar los ajustes de la sala', 403);
            }
        } else {
            $user = self::requireAuthenticatedUser();
            if ($room['host_user'] !== $user) {
                jsonError('Solo el anfitrión puede modificar los ajustes de la sala', 403);
            }
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

        $participant = self::resolvePartyParticipant($_GET, $room);
        if (!$participant) {
            jsonError('Credenciales de miembro requeridas', 401);
        }

        if (!empty($participant['member_id'])) {
            DbHelper::updatePartyMemberPing($roomId, $participant['member_id']);
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

        $participant = self::resolvePartyParticipant($_GET, $room);
        if (!$participant) {
            @http_response_code(401);
            echo "event: error\ndata: " . json_encode(['error' => 'Credenciales de miembro requeridas']) . "\n\n";
            exit();
        }

        $user = $participant['username'];
        $memberId = $participant['member_id'];
        if ($memberId) {
            DbHelper::updatePartyMemberPing($roomId, $memberId);
        }

        // Setup SSE response headers
        @header('Content-Type: text/event-stream; charset=utf-8');
        @header('Cache-Control: no-cache, no-transform');
        @header('Connection: keep-alive');
        @header('X-Accel-Buffering: no');
        setCorsHeaders();

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
                if ($memberId) {
                    DbHelper::updatePartyMemberPing($roomId, $memberId);
                }
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
            if ($memberId) {
                DbHelper::removePartyMemberById($roomId, $memberId);
            } else {
                $hostMember = DbHelper::getPartyHostMember($roomId);
                if ($hostMember && !empty($hostMember['member_id'])) {
                    DbHelper::removePartyMemberById($roomId, $hostMember['member_id']);
                }
            }
            $roomNow = DbHelper::getPartyRoom($roomId);
            if ($roomNow) {
                $newCount = DbHelper::getPartyMembersCount($roomId);
                DbHelper::updatePartyPlayback($roomId, (bool)$roomNow['is_playing'], (float)$roomNow['current_time'], null, $newCount);
            }
        }

        exit();
    }

    public static function refreshStreamTicket(): void {
        RateLimiter::enforce('party_ticket', 60, 60);
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: ($GLOBALS['_MOCKED_JSON_INPUT'] ?? []);

        $roomId = strtoupper(trim($data['room_id'] ?? ($_GET['room_id'] ?? '')));
        if (empty($roomId)) {
            jsonError('room_id requerido', 400);
        }

        $room = DbHelper::getPartyRoom($roomId);
        if (!$room) {
            jsonError('Sala no encontrada', 404);
        }

        $participant = self::resolvePartyParticipant($data, $room);
        if (!$participant) {
            jsonError('Credenciales de miembro inválidas o expiradas', 401);
        }

        $memberId = $participant['member_id'];
        if ($memberId) {
            DbHelper::updatePartyMemberPing($roomId, $memberId);
        }

        $newToken = AuthMiddleware::createToken([
            'type' => 'watch_party_stream',
            'room_id' => $roomId,
            'member_id' => $memberId,
            'exp' => time() + 900
        ]);

        jsonResponse([
            'success' => true,
            'stream_capability_token' => $newToken
        ]);
    }

    public static function getSseTicket(): void {
        RateLimiter::enforce('party_ticket', 60, 60);
        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true) ?: ($GLOBALS['_MOCKED_JSON_INPUT'] ?? []);

        $roomId = strtoupper(trim($data['room_id'] ?? ($_GET['room_id'] ?? '')));
        if (empty($roomId)) {
            jsonError('room_id requerido', 400);
        }

        $room = DbHelper::getPartyRoom($roomId);
        if (!$room) {
            jsonError('Sala no encontrada', 404);
        }

        $participant = self::resolvePartyParticipant($data, $room);
        if (!$participant) {
            jsonError('Credenciales de miembro inválidas o expiradas', 401);
        }

        $memberId = $participant['member_id'];
        if ($memberId) {
            DbHelper::updatePartyMemberPing($roomId, $memberId);
        }

        $sseTicket = AuthMiddleware::createToken([
            'type' => 'party_sse',
            'room_id' => $roomId,
            'member_id' => $memberId,
            'exp' => time() + 60
        ]);

        jsonResponse([
            'success' => true,
            'sse_ticket' => $sseTicket
        ]);
    }
}
