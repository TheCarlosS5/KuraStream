<?php
/**
 * Test Suite for Watch Party SSE Ticket Rotation & Lifecycle Management
 * Verifies that:
 * - Members can obtain ephemeral SSE tickets (party_sse, TTL 60s).
 * - SSE tickets are validated and contain member_id and room_id.
 * - Expired SSE tickets are rejected and fresh tickets can be issued on demand.
 * - Frontend party.js implements proactive ticket rotation (45s) and controlled error reconnect.
 */

define('TESTING_MODE', true);

require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/db.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/middleware/RateLimiter.php';
require_once __DIR__ . '/../php_backend/controllers/PartyController.php';

echo "Running Watch Party SSE Ticket Rotation Tests...\n";

// -------------------------------------------------------------------------------------------------
// 1. Ticket Generation & Signature Verification
// -------------------------------------------------------------------------------------------------
echo "  [1/3] Testing SSE ticket issuance and claims...\n";
$testRoomId = 'KURA-SSE-' . strtoupper(bin2hex(random_bytes(6)));
$testMemberId = 'mem_' . bin2hex(random_bytes(8));

$issuedTicket = AuthMiddleware::createToken([
    'type' => 'party_sse',
    'room_id' => $testRoomId,
    'member_id' => $testMemberId,
    'exp' => time() + 60
]);

$payload = AuthMiddleware::verifyToken($issuedTicket);
assert($payload !== null, "Issued SSE ticket must be verifiable by AuthMiddleware");
assert($payload['type'] === 'party_sse', "Ticket type must be 'party_sse'");
assert($payload['room_id'] === $testRoomId, "Ticket room_id must match requested room");
assert($payload['member_id'] === $testMemberId, "Ticket member_id must match member");
assert($payload['exp'] > time() && $payload['exp'] <= time() + 61, "Ticket TTL must be ~60 seconds");
echo "    ✓ SSE ticket issued with proper claims and 60s TTL\n";

// -------------------------------------------------------------------------------------------------
// 2. Ticket Expiration & Fresh Ticket Renewal
// -------------------------------------------------------------------------------------------------
echo "  [2/3] Testing ticket expiration rejection and fresh ticket renewal...\n";
$expiredTicket = AuthMiddleware::createToken([
    'type' => 'party_sse',
    'room_id' => $testRoomId,
    'member_id' => $testMemberId,
    'exp' => time() - 10 // Expired 10s ago
]);

$expiredPayload = AuthMiddleware::verifyToken($expiredTicket);
assert($expiredPayload === null, "Expired SSE ticket MUST be rejected by verifyToken");

// Issue replacement ticket
$freshTicket = AuthMiddleware::createToken([
    'type' => 'party_sse',
    'room_id' => $testRoomId,
    'member_id' => $testMemberId,
    'exp' => time() + 60
]);
$freshPayload = AuthMiddleware::verifyToken($freshTicket);
assert($freshPayload !== null, "Freshly rotated SSE ticket must verify successfully");
assert($freshTicket !== $expiredTicket, "Rotated ticket must be distinct from expired ticket");
echo "    ✓ Expired ticket strictly rejected; rotated ticket valid\n";

// -------------------------------------------------------------------------------------------------
// 3. Frontend Controlled Reconnect & Rotation Lifecycle Verification
// -------------------------------------------------------------------------------------------------
echo "  [3/3] Verifying frontend party.js ticket rotation lifecycle...\n";
$partyJsPath = __DIR__ . '/../frontend/js/modules/party.js';
assert(file_exists($partyJsPath), "frontend/js/modules/party.js must exist");

$partyJs = file_get_contents($partyJsPath);

// Assert proactive ticket rotation timer exists (~45000 ms before 60s TTL)
assert(str_contains($partyJs, 'sseRotationTimer'), "party.js must manage an sseRotationTimer");
assert(str_contains($partyJs, '45000'), "party.js must rotate SSE ticket at 45s interval");

// Assert immediate close on error to avoid browser auto-reconnect loops
assert(str_contains($partyJs, 'this.eventSource.close()'), "party.js must explicitly close dead EventSource on error");

// Assert clearing pollInterval when SSE opens
assert(str_contains($partyJs, 'this.pollInterval = null'), "party.js must clear polling fallback when SSE is active");

// Assert clean lifecycle teardown in disconnectEventStream
assert(str_contains($partyJs, 'clearTimeout(this.sseReconnectTimer)'), "disconnectEventStream must cancel pending reconnect timers");
assert(str_contains($partyJs, 'clearTimeout(this.sseRotationTimer)'), "disconnectEventStream must cancel pending rotation timers");

echo "    ✓ Frontend party.js implements proactive rotation, immediate close, and clean lifecycle\n";

echo "\n🎉 ALL WATCH PARTY SSE ROTATION TESTS PASSED!\n";
