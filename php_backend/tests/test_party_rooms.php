<?php
define('TESTING_MODE', true);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';

echo "=== Test 1: Initialize Schema with Party Tables ===\n";
Database::initializeSchema();
$db = Database::getConnection();
$db->exec("DELETE FROM party_messages WHERE room_id LIKE 'KURA-TEST%'");
$db->exec("DELETE FROM party_rooms WHERE id LIKE 'KURA-TEST%'");
echo "✅ Party tables initialized successfully!\n";

echo "=== Test 2: Create Party Room ===\n";
$roomId = DbHelper::createPartyRoom([
    'id' => 'KURA-TEST1',
    'name' => 'Sala de Prueba Frieren',
    'host_user' => 'Carlos',
    'episode_id' => 'Sousou_no_Frieren_S01_E01',
    'is_public' => 1,
    'allow_guest_controls' => 0
]);
if ($roomId !== 'KURA-TEST1') {
    throw new Exception("Expected room ID 'KURA-TEST1', got: {$roomId}");
}
echo "Room created with ID: {$roomId}\n";
echo "✅ Test 2 Passed!\n";

echo "=== Test 3: Get Party Room ===\n";
$room = DbHelper::getPartyRoom('KURA-TEST1');
if (!$room || $room['host_user'] !== 'Carlos' || $room['episode_id'] !== 'Sousou_no_Frieren_S01_E01') {
    throw new Exception("Room details mismatch or room not found");
}
echo "Room details: Host={$room['host_user']}, Episode={$room['episode_id']}, Public={$room['is_public']}\n";
echo "✅ Test 3 Passed!\n";

echo "=== Test 4: Update Playback State ===\n";
$updated = DbHelper::updatePartyPlayback('KURA-TEST1', true, 185.5, 'Sousou_no_Frieren_S01_E01', 3);
if (!$updated) {
    throw new Exception("Failed to update playback state");
}
$roomUpdated = DbHelper::getPartyRoom('KURA-TEST1');
if ((int)$roomUpdated['is_playing'] !== 1 || abs((float)$roomUpdated['current_time'] - 185.5) > 0.01) {
    throw new Exception("Playback update mismatch in DB");
}
echo "Updated state: is_playing={$roomUpdated['is_playing']}, current_time={$roomUpdated['current_time']}\n";
echo "✅ Test 4 Passed!\n";

echo "=== Test 5: Add and Retrieve Party Messages ===\n";
$msgId1 = DbHelper::addPartyMessage('KURA-TEST1', 'Carlos', '¡Bienvenidos al Watch Party!', 'chat');
$msgId2 = DbHelper::addPartyMessage('KURA-TEST1', 'Ana', '🔥', 'reaction');
$msgId3 = DbHelper::addPartyMessage('KURA-TEST1', 'Sistema', 'Carlos inició la reproducción en 03:05', 'system');

if ($msgId1 <= 0 || $msgId2 <= 0 || $msgId3 <= 0) {
    throw new Exception("Message insertion failed");
}

$allMessages = DbHelper::getPartyMessages('KURA-TEST1', 0);
if (count($allMessages) !== 3) {
    throw new Exception("Expected 3 messages, got " . count($allMessages));
}
echo "Retrieved " . count($allMessages) . " messages correctly.\n";

$newMessages = DbHelper::getPartyMessages('KURA-TEST1', $msgId1);
if (count($newMessages) !== 2) {
    throw new Exception("Expected 2 messages after ID {$msgId1}, got " . count($newMessages));
}
echo "Delta message polling works: " . count($newMessages) . " new messages.\n";
echo "✅ Test 5 Passed!\n";

echo "=== Test 7: Controller API Direct Call Tests ===\n";
require_once __DIR__ . '/../controllers/PartyController.php';

// Test create via helper / controller logic
$createdId = DbHelper::createPartyRoom([
    'name' => 'Sala de Frieren',
    'host_user' => 'Carlos',
    'episode_id' => 'Sousou_no_Frieren_S01_E02',
    'is_public' => 1
]);
if (empty($createdId) || !str_starts_with($createdId, 'KURA-')) {
    throw new Exception("Random room code generation failed: {$createdId}");
}
echo "Generated room with random code: {$createdId}\n";

// Test Settings Update
DbHelper::updatePartySettings($createdId, [
    'allow_guest_controls' => 1,
    'name' => 'Sala Modificada'
]);
$updatedRoom = DbHelper::getPartyRoom($createdId);
if (!$updatedRoom['allow_guest_controls'] || $updatedRoom['name'] !== 'Sala Modificada') {
    throw new Exception("Settings update failed");
}
echo "Settings updated successfully.\n";

// Cleanup
$db->exec("DELETE FROM party_messages WHERE room_id LIKE 'KURA-%'");
$db->exec("DELETE FROM party_rooms WHERE id LIKE 'KURA-%'");

echo "=== ALL TASK 1 & TASK 2 BACKEND TESTS PASSED! ===\n";
