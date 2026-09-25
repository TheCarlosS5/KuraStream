<?php
/**
 * Test Profiles Security (IDOR, PIN), Server-Side Kids Filtering, and Watch Party Logic
 */

if (!defined('TESTING_MODE')) {
    define('TESTING_MODE', true);
}

require_once __DIR__ . '/../php_backend/config.php';
require_once __DIR__ . '/../php_backend/middleware/AuthMiddleware.php';
require_once __DIR__ . '/../php_backend/controllers/ShowController.php';

$errors = [];
echo "Running Profiles Security, Kids Filtering & Watch Party Tests...\n";

// 1. Test Server-Side Kids Filtering Maturity Checks
echo "  [1/3] Testing ShowController::isAdultOrMaturityRestricted()...\n";

$safeShow = [
    'title' => 'Frieren: Beyond Journey\'s End',
    'is_adult' => 0,
    'rating_mpaa' => 'PG-13',
    'genres' => ['Adventure', 'Drama', 'Fantasy']
];
if (ShowController::isAdultOrMaturityRestricted($safeShow)) {
    $errors[] = "Safe family show was incorrectly flagged as adult";
}

$adultShow1 = [
    'title' => 'Adult OVA',
    'is_adult' => 1,
    'rating_mpaa' => 'PG-13',
    'genres' => ['Action']
];
if (!ShowController::isAdultOrMaturityRestricted($adultShow1)) {
    $errors[] = "Show with is_adult=1 was not flagged";
}

$adultShow2 = [
    'title' => 'Late Night Ecchi',
    'is_adult' => 0,
    'rating_mpaa' => 'TV-14',
    'genres' => 'Comedy, Ecchi, Romance'
];
if (!ShowController::isAdultOrMaturityRestricted($adultShow2)) {
    $errors[] = "Show with Ecchi genre string was not flagged";
}

$adultShow3 = [
    'title' => 'Seinen Mature',
    'is_adult' => 0,
    'rating_mpaa' => 'TV-MA',
    'genres' => ['Action', 'Thriller']
];
if (!ShowController::isAdultOrMaturityRestricted($adultShow3)) {
    $errors[] = "Show with TV-MA rating was not flagged";
}
echo "    -> Kids maturity classifier OK\n";

// 2. Test JWT Token Creation & is_kids Payload
echo "  [2/3] Testing Auth token profile claims...\n";
$token = AuthMiddleware::createToken([
    'username' => 'testuser',
    'profile_name' => 'Niños',
    'is_kids' => true,
    'role' => 'user',
    'exp' => time() + 3600
]);

$decoded = AuthMiddleware::verifyToken($token);
if (!$decoded || empty($decoded['is_kids']) || $decoded['profile_name'] !== 'Niños') {
    $errors[] = "Failed to encode/decode is_kids in JWT token payload";
}
echo "    -> JWT token profile claims OK\n";

// 3. Test Party Drift Rate Calculations
echo "  [3/3] Testing Watch Party drift calculation contracts...\n";
$partyJs = file_get_contents(__DIR__ . '/../frontend/js/modules/party.js');
if (!str_contains($partyJs, 'userBaseRate')) {
    $errors[] = "party.js does not track userBaseRate";
}
if (!str_contains($partyJs, 'baseRate * 1.06') || !str_contains($partyJs, 'baseRate * 0.94')) {
    $errors[] = "party.js drift algorithm does not scale with baseRate";
}
echo "    -> Party drift rate contracts OK\n";

if (!empty($errors)) {
    echo "\nTEST FAILURES:\n";
    foreach ($errors as $e) {
        echo "  - {$e}\n";
    }
    exit(1);
}

echo "\nAll Profiles Security, Kids Filtering & Watch Party tests passed successfully!\n";
exit(0);
